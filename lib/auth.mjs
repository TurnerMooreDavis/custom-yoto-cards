// OAuth2 Authorization-Code + PKCE against login.yotoplay.com.
// Login is two-step so it works from a sandbox with no browser: `startLogin` prints a URL and
// saves the PKCE verifier; the user signs in on their own machine and pastes back the
// 127.0.0.1 redirect URL (which will not load), and `finishLogin` exchanges its code.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

export const API = 'https://api.yotoplay.com';
export const LOGIN = 'https://login.yotoplay.com';
export const REDIRECT_PORT = 8787;
export const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}/callback`;
export const SCOPE = 'user:content:manage user:icons:manage offline_access';
const PENDING_TTL_MS = 30 * 60_000;

export class NotLoggedInError extends Error {
  constructor(msg = 'Not logged in to Yoto. Run: node yoto-upload.js login') { super(msg); this.name = 'NotLoggedInError'; }
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const tokenFile = (dir) => path.join(dir, 'token.json');
const pendingFile = (dir) => path.join(dir, 'login-pending.json');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writePrivate = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(obj, null, 2), { mode: 0o600 }); };

export function configDir(env = process.env) {
  return env.YOTO_CONFIG_DIR || path.join(os.homedir(), '.config', 'yoto');
}

export function newPkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthUrl({ clientId, challenge }) {
  const u = new URL(`${LOGIN}/authorize`);
  u.search = new URLSearchParams({
    audience: API, scope: SCOPE, response_type: 'code', client_id: clientId,
    code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: REDIRECT_URI,
  }).toString();
  return u.toString();
}

// Accepts the full redirect URL or just its query string ("code=...").
export function parseRedirect(input) {
  const s = String(input).trim();
  const params = s.includes('?') ? new URL(s).searchParams : new URLSearchParams(s);
  const err = params.get('error');
  if (err) throw new Error(`${err}: ${params.get('error_description') || ''}`.trim());
  const code = params.get('code');
  if (!code) throw new Error('No code in the pasted URL. Paste the whole address the browser landed on.');
  return code;
}

export function startLogin({ clientId, dir }) {
  const { verifier, challenge } = newPkce();
  writePrivate(pendingFile(dir), { verifier, createdAt: Date.now() });
  return buildAuthUrl({ clientId, challenge });
}

export async function finishLogin({ clientId, dir, redirectUrl, fetchImpl = fetch }) {
  const pending = readJson(pendingFile(dir));
  if (!pending?.verifier) throw new Error('No login in progress: run `login` first.');
  if (Date.now() - pending.createdAt > PENDING_TTL_MS) throw new Error('Login expired (30 min): run `login` again.');
  const code = parseRedirect(redirectUrl);
  const res = await fetchImpl(`${LOGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: clientId, code_verifier: pending.verifier, code, redirect_uri: REDIRECT_URI,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Token exchange failed: HTTP ${res.status}\n${(await res.text()).slice(0, 500)}`);
  const data = await res.json();
  writePrivate(tokenFile(dir), { refresh_token: data.refresh_token });
  fs.rmSync(pendingFile(dir), { force: true });
}

// Resolves with the code if a browser on THIS machine reaches the loopback callback.
export function waitForLoopback({ port = REDIRECT_PORT, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body style="font:16px system-ui;padding:3rem;text-align:center"><h2>Login complete</h2><p>Return to your terminal.</p></body></html>');
      server.close();
      try { resolve(parseRedirect(u.toString())); } catch (e) { reject(e); }
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
    if (timeoutMs) setTimeout(() => { server.close(); reject(new Error('Timed out waiting for the browser callback')); }, timeoutMs).unref();
  });
}

export async function getAccessToken({ clientId, dir, fetchImpl = fetch }) {
  const saved = readJson(tokenFile(dir));
  if (!saved?.refresh_token) throw new NotLoggedInError();
  const res = await fetchImpl(`${LOGIN}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId, refresh_token: saved.refresh_token }).toString(),
  });
  if (!res.ok) throw new NotLoggedInError('Saved Yoto login expired. Run: node yoto-upload.js login');
  const data = await res.json();
  writePrivate(tokenFile(dir), { refresh_token: data.refresh_token || saved.refresh_token }); // refresh tokens rotate
  return data.access_token;
}

export function logout(dir) {
  fs.rmSync(tokenFile(dir), { force: true });
  fs.rmSync(pendingFile(dir), { force: true });
}
