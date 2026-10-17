#!/usr/bin/env node
/**
 * yoto-upload.js — build Yoto MYO playlists (linear or choose-your-own-adventure) from a card folder.
 *
 *   node yoto-upload.js login [--no-wait] [--paste <redirect-url>]   sign in once (token: ~/.config/yoto)
 *   node yoto-upload.js logout
 *   node yoto-upload.js prep <card>      raw/ memos -> clean/*.mp3 (trim silence, even loudness)
 *   node yoto-upload.js check <card>     validate playlist.json, recordings, icons, branches
 *   node yoto-upload.js upload <card>    check, then upload and create/update the playlist
 *   node yoto-upload.js <card>           same as upload (upstream usage)
 *
 * <card> is a folder path, or a folder name under $YOTO_CARDS_DIR.
 * Client id: $YOTO_CLIENT_ID, else the first line of $YOTO_CLIENT_ID_FILE.
 * Exit codes: 0 ok, 1 error, 3 not logged in. Zero npm dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { configDir, startLogin, finishLogin, waitForLoopback, getAccessToken, logout, NotLoggedInError } from './lib/auth.mjs';
import { checkCard, isInteractive } from './lib/manifest.mjs';
import { buildContent } from './lib/build.mjs';
import { prepCard } from './lib/prep.mjs';
import { uploadAudio, uploadIcon, createContent } from './lib/yoto-api.mjs';

try { process.loadEnvFile(path.join(import.meta.dirname, '.env')); } catch { /* optional */ }

const log = (...a) => console.log(...a);
class UsageError extends Error {}

function clientId() {
  if (process.env.YOTO_CLIENT_ID) return process.env.YOTO_CLIENT_ID.trim();
  const f = process.env.YOTO_CLIENT_ID_FILE;
  if (f && fs.existsSync(f)) return fs.readFileSync(f, 'utf8').split(/\r?\n/)[0].trim();
  throw new UsageError('Set YOTO_CLIENT_ID (or YOTO_CLIENT_ID_FILE): create a Public client at https://dashboard.yoto.dev,\n  redirect http://127.0.0.1:8787/callback, scopes user:content:manage user:icons:manage offline_access (saved).');
}

function resolveCard(arg) {
  if (!arg) throw new UsageError('Which card? Pass a folder path or a name under $YOTO_CARDS_DIR.');
  if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return path.resolve(arg);
  const root = process.env.YOTO_CARDS_DIR;
  if (root && fs.existsSync(path.join(root, arg))) return path.join(root, arg);
  throw new UsageError(`no card folder "${arg}"${root ? ` (looked in ${root})` : ''}`);
}

function printPlan(r) {
  log(`\nPlaylist: "${r.manifest?.title ?? '?'}"  (${r.tracks.length} tracks${isInteractive(r.manifest) ? ', interactive' : ''})`);
  for (const t of r.tracks) {
    const branch = [t.left && `left→${t.left}`, t.right && `right→${t.right}`, t.end && `end→${t.end}`].filter(Boolean).join(' ');
    log(`  ${String(t.n).padStart(2)}. ${t.title}${t.id ? ` [${t.id}]` : ''}  ←  ${t.audioPath ? path.basename(t.audioPath) : '?'}${branch ? '   ' + branch : ''}`);
  }
  for (const w of r.warnings) log(`  ⚠ ${w}`);
}

async function cmdLogin(flags) {
  const id = clientId();
  const dir = configDir();
  if (flags.paste) { await finishLogin({ clientId: id, dir, redirectUrl: flags.paste }); log('✓ Logged in to Yoto.'); return; }
  const url = startLogin({ clientId: id, dir });
  log('\nOpen this URL in a browser and sign in to Yoto:\n\n' + url + '\n');
  log('Afterwards the browser lands on a http://127.0.0.1:8787/callback?code=... page that may not load.');
  if (flags.noWait) { log('Copy that address and run:  node yoto-upload.js login --paste \'<address>\''); return; }
  log('Paste that address here (or, if this machine ran the browser, just wait):');
  const rl = readline.createInterface({ input: process.stdin });
  const pasted = new Promise((resolve) => rl.once('line', resolve));
  const loopback = waitForLoopback({ timeoutMs: 30 * 60_000 }).then((code) => 'code=' + code).catch(() => new Promise(() => {}));
  const redirectUrl = await Promise.race([pasted, loopback]);
  rl.close();
  await finishLogin({ clientId: id, dir, redirectUrl });
  log('✓ Logged in to Yoto.');
  process.exit(0); // the loopback server may still be listening
}

function cmdCheck(card) {
  const r = checkCard(card);
  printPlan(r);
  if (r.errors.length) { for (const e of r.errors) console.error(`  ✖ ${e}`); return r; }
  log('\n✓ OK');
  return r;
}

async function cmdUpload(card) {
  const r = checkCard(card);
  printPlan(r);
  if (r.errors.length) {
    console.error('\n✖ fix these before uploading:');
    for (const e of r.errors) console.error(`  ✖ ${e}`);
    process.exit(1);
  }
  const token = await getAccessToken({ clientId: clientId(), dir: configDir() });
  const uploads = [];
  for (const t of r.tracks) {
    log(`\n[${t.n}/${r.tracks.length}] ${t.title}`);
    log('   ↑ audio + transcoding…');
    const transcode = await uploadAudio(token, t.audioPath);
    log('   ↑ icon…');
    const mediaId = await uploadIcon(token, t.iconPath, t.iconType);
    uploads.push({ transcode, mediaId });
  }
  const body = buildContent({ manifest: r.manifest, tracks: r.tracks, uploads, interactive: isInteractive(r.manifest) });
  const existing = r.manifest.cardId || null;
  log(existing ? `\nUpdating playlist ${existing}…` : '\nCreating playlist…');
  const created = await createContent(token, body);
  const newId = created.cardId || created.card?.cardId || created.contentId || null;
  if (!existing && newId) saveCardId(r.manifestPath, newId);
  log(`\n✅ ${existing ? 'Updated' : 'Created'} "${r.manifest.title}" (cardId ${existing || newId || 'see Yoto app'}).`);
  log(existing ? 'A card already linked to it now plays the new version.' : 'Next: Yoto app → Library → this playlist → "Link to a card".');
}

// persist a new cardId into playlist.json, preserving its formatting (upstream behaviour)
function saveCardId(manifestPath, cardId) {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const safe = String(cardId).replace(/"/g, '');
  const next = /"cardId"\s*:/.test(raw)
    ? raw.replace(/"cardId"\s*:\s*(?:null|"[^"]*")/, `"cardId": "${safe}"`)
    : raw.replace(/^\s*{/, `{\n  "cardId": "${safe}",`);
  fs.writeFileSync(manifestPath, next);
}

async function main() {
  const argv = process.argv.slice(2);
  const flags = { noWait: argv.includes('--no-wait'), resetAuth: argv.includes('--reset-auth') };
  const pi = argv.indexOf('--paste');
  if (pi >= 0) flags.paste = argv[pi + 1];
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--paste');
  const [cmd, arg] = pos;
  if (flags.resetAuth) logout(configDir());
  switch (cmd) {
    case 'login': return cmdLogin(flags);
    case 'logout': logout(configDir()); return log('✓ Logged out.');
    case 'prep': {
      const res = await prepCard(resolveCard(arg));
      return log(`✓ prep: ${res.done.length} cleaned, ${res.skipped.length} already up to date → clean/`);
    }
    case 'check': { const r = cmdCheck(resolveCard(arg)); if (r.errors.length) process.exit(1); return; }
    case 'upload': return cmdUpload(resolveCard(arg));
    case undefined:
      if (flags.resetAuth) return cmdLogin(flags);
      return cmdUpload(resolveCard(process.env.YOTO_PLAYLIST_DIR || 'my-playlist'));
    default: return cmdUpload(resolveCard(cmd)); // upstream: node yoto-upload.js <folder>
  }
}

main().catch((e) => {
  console.error('\n✖ ' + (e.message || String(e)));
  process.exit(e instanceof NotLoggedInError ? 3 : 1);
});
