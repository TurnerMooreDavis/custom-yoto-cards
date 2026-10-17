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
  for (const f of fs.readdirSync(rawDir).sort()) {
    if (!AUDIO_EXT.has(path.extname(f).toLowerCase())) continue;
    const src = path.join(rawDir, f);
    const out = path.join(cleanDir, path.basename(f, path.extname(f)) + '.mp3');
    if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) { skipped.push(f); continue; }
    await run(ffmpegArgs(src, out));
    done.push(f);
  }
  return { done, skipped };
}
