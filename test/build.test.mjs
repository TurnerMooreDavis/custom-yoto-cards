import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContent, stableKey, gotoParams } from '../lib/build.mjs';

const info = { format: 'aac', duration: 10, fileSize: 1000, channels: 'mono' };
const up = (sha, media) => ({ transcode: { transcodedSha256: sha, transcodedInfo: info }, mediaId: media });
const tr = (n, title, extra = {}) => ({ n, title, id: null, left: null, right: null, end: null, ...extra });

test('stableKey is upstream-compatible: same title -> same key, no collisions', () => {
  const used = new Set();
  const k1 = stableKey('Track One', used);
  assert.match(k1, /^\d\d$/);
  assert.equal(stableKey('Track One', new Set()), k1);
  assert.notEqual(stableKey('Track One', used), k1);
});

test('linear build matches upstream shape exactly', () => {
  const body = buildContent({
    manifest: { cardId: null, title: 'T' },
    tracks: [tr(1, 'One'), tr(2, 'Two')],
    uploads: [up('s1', 'm1'), up('s2', 'm2')],
    interactive: false,
  });
  assert.equal(body.cardId, undefined);
  assert.equal(body.title, 'T');
  assert.equal(body.content.playbackType, undefined);
  const [c1] = body.content.chapters;
  const used = new Set();
  assert.deepEqual(c1, {
    key: stableKey('One', used), title: 'One', overlayLabel: '1', display: { icon16x16: 'yoto:#m1' },
    tracks: [{ key: '01', title: 'One', trackUrl: 'yoto:#s1', type: 'audio', format: 'aac', duration: 10,
      fileSize: 1000, channels: 'mono', overlayLabel: '1', display: { icon16x16: 'yoto:#m1' } }],
  });
  assert.deepEqual(body.metadata.media, { duration: 20, fileSize: 2000, readableFileSize: 0 });
});

test('cardId present -> update', () => {
  const body = buildContent({ manifest: { cardId: 'abc', title: 'T' }, tracks: [tr(1, 'One')], uploads: [up('s', 'm')], interactive: false });
  assert.equal(body.cardId, 'abc');
});

test('interactive build sets playbackType and goto/stop/repeat events by chapter key', () => {
  const tracks = [
    tr(1, 'Start', { id: 'start', left: 'cave', right: 'river', end: 'repeat' }),
    tr(2, 'Cave', { id: 'cave', end: 'stop' }),
    tr(3, 'River', { id: 'river', end: 'start' }),
  ];
  const body = buildContent({ manifest: { title: 'T' }, tracks, uploads: tracks.map((_, i) => up('s' + i, 'm' + i)), interactive: true });
  assert.equal(body.content.playbackType, 'interactive');
  const keyOf = Object.fromEntries(body.content.chapters.map((c, i) => [tracks[i].id, c.key]));
  const ev = body.content.chapters.map((c) => c.tracks[0].events);
  assert.deepEqual(ev[0], { onLhb: { cmd: 'goto', params: gotoParams(keyOf.cave) }, onRhb: { cmd: 'goto', params: gotoParams(keyOf.river) }, onEnd: { cmd: 'repeat' } });
  assert.deepEqual(ev[1], { onEnd: { cmd: 'stop' } });
  assert.deepEqual(ev[2], { onEnd: { cmd: 'goto', params: gotoParams(keyOf.start) } });
});
