import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir, fakePng, makeCard } from './helpers.mjs';

const CLI = path.join(import.meta.dirname, '..', 'yoto-upload.js');
const run = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8', env: { ...process.env, YOTO_CONFIG_DIR: tmpDir(), YOTO_CLIENT_ID: 'cid', ...env },
});

test('check passes a valid card by path', () => {
  const dir = makeCard(tmpDir(), { manifest: { title: 'T', tracks: [{ title: 'One', match: 'one', icon: 'a.png' }] }, audio: ['one.mp3'], icons: { 'a.png': fakePng(16, 16) } });
  const r = run(['check', dir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /1\. One/);
  assert.match(r.stdout, /OK/);
});

test('check resolves a card name under YOTO_CARDS_DIR and fails on errors', () => {
  const root = tmpDir();
  makeCard(path.join(root, 'bad'), { manifest: { title: 'T', tracks: [{ title: 'One', match: 'zzz', icon: 'a.png' }] } });
  const r = run(['check', 'bad'], { YOTO_CARDS_DIR: root });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no recording matching "zzz"/);
});

test('upload refuses a broken card before needing a login', () => {
  const dir = makeCard(tmpDir(), { manifest: { title: 'T', tracks: [{ title: 'One', match: 'zzz', icon: 'a.png' }] } });
  const r = run(['upload', dir]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /fix these before uploading/);
});

test('upload on a valid card without login exits 3', () => {
  const dir = makeCard(tmpDir(), { manifest: { title: 'T', tracks: [{ title: 'One', match: 'one', icon: 'a.png' }] }, audio: ['one.mp3'], icons: { 'a.png': fakePng(16, 16) } });
  const r = run(['upload', dir]);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /login/);
});

test('login --no-wait prints the authorize URL; unknown card name errors', () => {
  const r = run(['login', '--no-wait']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /https:\/\/login\.yotoplay\.com\/authorize\?/);
  const r2 = run(['check', 'nope'], { YOTO_CARDS_DIR: tmpDir() });
  assert.equal(r2.status, 1);
  assert.match(r2.stderr, /no card folder "nope"/);
});

test('missing client id is a clear error', () => {
  const r = run(['login', '--no-wait'], { YOTO_CLIENT_ID: '', YOTO_CLIENT_ID_FILE: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /YOTO_CLIENT_ID/);
});
