import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  configDir, newPkce, buildAuthUrl, parseRedirect, startLogin, finishLogin,
  getAccessToken, NotLoggedInError, logout, SCOPE, REDIRECT_URI,
} from '../lib/auth.mjs';
import { tmpDir } from './helpers.mjs';

const okJson = (obj) => async () => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });
const fail = async () => ({ ok: false, status: 400, statusText: 'Bad', json: async () => ({}), text: async () => 'bad' });

test('configDir honours YOTO_CONFIG_DIR, else ~/.config/yoto', () => {
  assert.equal(configDir({ YOTO_CONFIG_DIR: '/x/y' }), '/x/y');
  assert.equal(configDir({}), path.join(os.homedir(), '.config', 'yoto'));
});

test('newPkce challenge is base64url sha256 of verifier', () => {
  const { verifier, challenge } = newPkce();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(verifier, challenge);
});

test('buildAuthUrl carries client, scope, redirect, S256 challenge', () => {
  const u = new URL(buildAuthUrl({ clientId: 'cid', challenge: 'chal' }));
  assert.equal(u.origin + u.pathname, 'https://login.yotoplay.com/authorize');
  assert.equal(u.searchParams.get('client_id'), 'cid');
  assert.equal(u.searchParams.get('scope'), SCOPE);
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT_URI);
  assert.equal(u.searchParams.get('code_challenge'), 'chal');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('audience'), 'https://api.yotoplay.com');
});

test('parseRedirect extracts code, accepts bare query, rejects errors', () => {
  assert.equal(parseRedirect('http://127.0.0.1:8787/callback?code=abc&state=1'), 'abc');
  assert.equal(parseRedirect('  code=xyz  '), 'xyz');
  assert.throws(() => parseRedirect('http://127.0.0.1:8787/callback?error=access_denied&error_description=nope'), /access_denied: nope/);
  assert.throws(() => parseRedirect('http://127.0.0.1:8787/callback'), /no code/i);
});

test('startLogin saves pending verifier; finishLogin exchanges code and saves refresh token', async () => {
  const dir = tmpDir();
  const url = startLogin({ clientId: 'cid', dir });
  assert.ok(url.startsWith('https://login.yotoplay.com/authorize?'));
  const pending = JSON.parse(fs.readFileSync(path.join(dir, 'login-pending.json'), 'utf8'));
  assert.ok(pending.verifier && pending.createdAt);

  let sentBody;
  const fetchImpl = async (u, opts) => { sentBody = new URLSearchParams(opts.body); return okJson({ access_token: 'A', refresh_token: 'R' })(); };
  await finishLogin({ clientId: 'cid', dir, redirectUrl: 'http://127.0.0.1:8787/callback?code=C1', fetchImpl });
  assert.equal(sentBody.get('grant_type'), 'authorization_code');
  assert.equal(sentBody.get('code'), 'C1');
  assert.equal(sentBody.get('code_verifier'), pending.verifier);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'token.json'), 'utf8')).refresh_token, 'R');
  assert.equal(fs.existsSync(path.join(dir, 'login-pending.json')), false);
});

test('finishLogin refuses an expired or missing pending login', async () => {
  const dir = tmpDir();
  await assert.rejects(finishLogin({ clientId: 'cid', dir, redirectUrl: 'code=x', fetchImpl: okJson({}) }), /run `login` first/);
  fs.writeFileSync(path.join(dir, 'login-pending.json'), JSON.stringify({ verifier: 'v', createdAt: Date.now() - 31 * 60_000 }));
  await assert.rejects(finishLogin({ clientId: 'cid', dir, redirectUrl: 'code=x', fetchImpl: okJson({}) }), /expired/);
});

test('getAccessToken refreshes and rotates; throws NotLoggedInError without a usable token', async () => {
  const dir = tmpDir();
  await assert.rejects(getAccessToken({ clientId: 'cid', dir, fetchImpl: okJson({}) }), NotLoggedInError);
  fs.writeFileSync(path.join(dir, 'token.json'), JSON.stringify({ refresh_token: 'R1' }));
  const tok = await getAccessToken({ clientId: 'cid', dir, fetchImpl: okJson({ access_token: 'A2', refresh_token: 'R2' }) });
  assert.equal(tok, 'A2');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'token.json'), 'utf8')).refresh_token, 'R2');
  await assert.rejects(getAccessToken({ clientId: 'cid', dir, fetchImpl: fail }), NotLoggedInError);
});

test('logout removes token and pending login', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'token.json'), '{}');
  fs.writeFileSync(path.join(dir, 'login-pending.json'), '{}');
  logout(dir);
  assert.deepEqual(fs.readdirSync(dir), []);
});
