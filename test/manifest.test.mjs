import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { checkCard, iconInfo, isInteractive } from '../lib/manifest.mjs';
import { tmpDir, fakePng, fakeGif, makeCard } from './helpers.mjs';

const icon = fakePng(16, 16);

test('iconInfo reads PNG and GIF dimensions, null otherwise', () => {
  assert.deepEqual(iconInfo(fakePng(16, 16)), { type: 'png', w: 16, h: 16 });
  assert.deepEqual(iconInfo(fakeGif(16, 16)), { type: 'gif', w: 16, h: 16 });
  assert.equal(iconInfo(Buffer.from('nope')), null);
});

test('linear upstream manifest resolves audio at card root', () => {
  const dir = makeCard(tmpDir(), {
    manifest: { cardId: null, title: 'T', tracks: [{ title: 'One', match: 'one', icon: 'a.png' }] },
    audio: ['01-one.mp3'], icons: { 'a.png': icon },
  });
  const r = checkCard(dir);
  assert.deepEqual(r.errors, []);
  assert.equal(r.tracks[0].audioPath, path.join(dir, '01-one.mp3'));
  assert.equal(isInteractive(r.manifest), false);
});

test('clean/ is preferred over the card root when it exists', () => {
  const dir = makeCard(tmpDir(), {
    manifest: { title: 'T', tracks: [{ title: 'One', match: 'one', icon: 'a.png' }] },
    audio: ['one.mp3'], clean: ['one.mp3'], icons: { 'a.png': icon },
  });
  assert.equal(checkCard(dir).tracks[0].audioPath, path.join(dir, 'clean', 'one.mp3'));
});

test('reports zero/multiple matches, missing and wrong-size icons', () => {
  const dir = makeCard(tmpDir(), {
    manifest: { title: 'T', tracks: [
      { title: 'A', match: 'zzz', icon: 'a.png' },
      { title: 'B', match: 'dup', icon: 'missing.png' },
      { title: 'C', match: 'cee', icon: 'big.png' },
    ] },
    audio: ['dup-1.mp3', 'dup-2.m4a', 'cee.wav'], icons: { 'a.png': icon, 'big.png': fakePng(32, 32) },
  });
  const { errors } = checkCard(dir);
  assert.ok(errors.some((e) => /A: no recording matching "zzz"/.test(e)));
  assert.ok(errors.some((e) => /B: "dup" matched 2 recordings/.test(e)));
  assert.ok(errors.some((e) => /B: missing icon icons\/missing.png/.test(e)));
  assert.ok(errors.some((e) => /C: icon big.png is 32x32, needs 16x16/.test(e)));
});

test('interactive: unknown targets, duplicate ids, bad end, unreachable warning', () => {
  const t = (id, extra = {}) => ({ id, title: id, match: id, icon: 'i.png', ...extra });
  const dir = makeCard(tmpDir(), {
    manifest: { title: 'T', tracks: [
      t('start', { left: 'cave', right: 'nowhere' }),
      t('cave', { end: 'explode' }),
      t('cave'),
      t('island'),
    ] },
    audio: ['start.mp3', 'cave-a.mp3', 'island.mp3'], icons: { 'i.png': icon },
  });
  const r = checkCard(dir);
  assert.equal(isInteractive(r.manifest), true);
  assert.ok(r.errors.some((e) => /start: right -> "nowhere" is not a track id/.test(e)));
  assert.ok(r.errors.some((e) => /duplicate id "cave"/.test(e)));
  assert.ok(r.errors.some((e) => /cave: end must be stop, repeat or a track id \(got "explode"\)/.test(e)));
  assert.ok(r.warnings.some((w) => /island: nothing leads here/.test(w)));
});

test('missing playlist.json is an error', () => {
  const dir = tmpDir();
  assert.match(checkCard(dir).errors[0], /no playlist.json/);
});
