import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ffmpegArgs, prepCard, hasFfmpeg, runFfmpeg } from '../lib/prep.mjs';
import { tmpDir, makeCard } from './helpers.mjs';

test('ffmpegArgs trims both ends and loudness-normalizes to mp3', () => {
  const a = ffmpegArgs('in.m4a', 'out.mp3');
  const af = a[a.indexOf('-af') + 1];
  assert.match(af, /^silenceremove=.*areverse,silenceremove=.*areverse,loudnorm=I=-16/);
  assert.deepEqual(a.slice(0, 4), ['-hide_banner', '-loglevel', 'error', '-y']);
  assert.equal(a.at(-1), 'out.mp3');
  assert.ok(a.includes('libmp3lame'));
});

test('prepCard converts raw/ audio into clean/*.mp3 and skips up-to-date outputs', async () => {
  const dir = makeCard(tmpDir(), { raw: ['Grandma Cave.m4a', 'notes.txt', 'river.wav'] });
  const calls = [];
  const run = async (args) => { calls.push(args); fs.writeFileSync(args.at(-1), 'mp3'); };
  const first = await prepCard(dir, { run });
  assert.deepEqual(first.done.sort(), ['Grandma Cave.m4a', 'river.wav']);
  assert.ok(fs.existsSync(path.join(dir, 'clean', 'Grandma Cave.mp3')));
  const second = await prepCard(dir, { run });
  assert.deepEqual(second.done, []);
  assert.deepEqual(second.skipped.sort(), ['Grandma Cave.m4a', 'river.wav']);
  assert.equal(calls.length, 2);
});

test('prepCard errors without raw/', async () => {
  await assert.rejects(prepCard(tmpDir(), { run: async () => {} }), /no raw\/ folder/);
});

test('real ffmpeg: trims leading silence', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
  const dir = makeCard(tmpDir(), {});
  fs.mkdirSync(path.join(dir, 'raw'));
  const src = path.join(dir, 'raw', 'tone.wav');
  // 2s silence + 1s tone
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-filter_complex', '[0][1]concat=n=2:v=0:a=1', src]);
  await prepCard(dir, { run: runFfmpeg });
  const out = path.join(dir, 'clean', 'tone.mp3');
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString());
  assert.ok(dur < 1.6, `expected trimmed (<1.6s), got ${dur}`);
});

test('prepCard never leaves a partial clean/ file when ffmpeg dies mid-encode', async () => {
  const dir = makeCard(tmpDir(), { raw: ['memo.m4a'] });
  const run = async (args) => { fs.writeFileSync(args.at(-1), 'partial'); throw new Error('ffmpeg killed'); };
  await assert.rejects(prepCard(dir, { run }), /ffmpeg killed/);
  assert.equal(fs.existsSync(path.join(dir, 'clean', 'memo.mp3')), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'clean')), []);
  // a retry after the failure must redo the file, not skip it
  const ok = await prepCard(dir, { run: async (args) => fs.writeFileSync(args.at(-1), 'mp3') });
  assert.deepEqual(ok.done, ['memo.m4a']);
});

test('prepCard redoes a replaced source even when its mtime is older than the clean output', async () => {
  const dir = makeCard(tmpDir(), { raw: ['cave.m4a'] });
  const run = async (args) => fs.writeFileSync(args.at(-1), 'mp3');
  await prepCard(dir, { run });
  // a copy that keeps the original (older) Date modified
  const old = new Date(Date.now() - 3 * 86400_000);
  fs.writeFileSync(path.join(dir, 'raw', 'cave.m4a'), 'take 2');
  fs.utimesSync(path.join(dir, 'raw', 'cave.m4a'), old, old);
  const again = await prepCard(dir, { run });
  assert.deepEqual(again.done, ['cave.m4a']);
  // and the output now carries the source's mtime, so a further run skips
  const third = await prepCard(dir, { run });
  assert.deepEqual(third.skipped, ['cave.m4a']);
});

test('prepCard refuses same-stem sources and encodes nothing', async () => {
  const dir = makeCard(tmpDir(), { raw: ['cave.m4a', 'cave.wav', 'river.m4a', 'river.mp3', 'solo.wav'] });
  const calls = [];
  const run = async (args) => { calls.push(args); fs.writeFileSync(args.at(-1), 'mp3'); };
  await assert.rejects(prepCard(dir, { run }), (e) => e.message.includes('cave.m4a and cave.wav would both become clean/cave.mp3')
    && e.message.includes('river.m4a and river.mp3 would both become clean/river.mp3'));
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'clean')), []);
});
