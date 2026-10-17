// raw/ phone memos -> clean/*.mp3: trim dead air at both ends, even out loudness.
import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { AUDIO_EXT } from './manifest.mjs';

// Trim the head, reverse, trim the (former) tail, reverse back; then EBU R128 loudness.
const TRIM = 'silenceremove=start_periods=1:start_duration=0.2:start_threshold=-45dB';
const FILTER = `${TRIM},areverse,${TRIM},areverse,loudnorm=I=-16:TP=-1.5:LRA=11`;

export function ffmpegArgs(inPath, outPath) {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-i', inPath, '-af', FILTER,
    '-ar', '44100', '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k', outPath];
}

export function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', args, (err, _out, stderr) => (err ? reject(new Error(`ffmpeg failed: ${stderr || err.message}`)) : resolve()));
  });
}

export function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

export async function prepCard(cardDir, { run = runFfmpeg } = {}) {
  const rawDir = path.join(cardDir, 'raw');
  if (!fs.existsSync(rawDir)) throw new Error(`no raw/ folder in ${cardDir}: put the recordings there`);
  const cleanDir = path.join(cardDir, 'clean');
  fs.mkdirSync(cleanDir, { recursive: true });
  const done = [];
  const skipped = [];
  const raws = fs.readdirSync(rawDir).sort().filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  // two sources with one stem (cave.m4a + cave.wav) would overwrite each other: refuse, encode nothing
  const byStem = new Map();
  for (const f of raws) {
    const stem = path.basename(f, path.extname(f));
    byStem.set(stem, [...(byStem.get(stem) || []), f]);
  }
  const clashes = [...byStem].filter(([, names]) => names.length > 1)
    .map(([stem, names]) => `${names.join(' and ')} would both become clean/${stem}.mp3`);
  if (clashes.length) throw new Error(`raw/: ${clashes.join('; ')}; remove or rename one`);
  for (const f of raws) {
    const src = path.join(rawDir, f);
    const out = path.join(cleanDir, path.basename(f, path.extname(f)) + '.mp3');
    const srcStat = fs.statSync(src);
    // the output carries the source's mtime, so ANY replaced source (older or newer) differs and is redone; 2ms covers fs rounding
    if (fs.existsSync(out) && Math.abs(fs.statSync(out).mtimeMs - srcStat.mtimeMs) < 2) { skipped.push(f); continue; }
    // encode to a hidden temp name, then rename: a crash never leaves a partial clean/*.mp3
    const tmp = path.join(cleanDir, '.' + path.basename(out, '.mp3') + '.tmp.mp3');
    try {
      await run(ffmpegArgs(src, tmp));
      fs.renameSync(tmp, out);
      fs.utimesSync(out, srcStat.atime, srcStat.mtime);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      throw e;
    }
    done.push(f);
  }
  return { done, skipped };
}
