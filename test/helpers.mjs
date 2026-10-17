import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yoto-test-'));
}

// Minimal PNG: signature + IHDR (width/height big-endian at byte 16/20). CRC not checked by us.
export function fakePng(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

// Minimal GIF header: "GIF89a" + width/height little-endian at byte 6/8.
export function fakeGif(w, h) {
  const b = Buffer.alloc(13);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

// Build a card folder. audio = files at the card root, raw/clean = files in those subdirs,
// icons = { 'name.png': Buffer }.
export function makeCard(dir, { manifest, audio = [], raw = [], clean = [], icons = {} }) {
  fs.mkdirSync(path.join(dir, 'icons'), { recursive: true });
  if (manifest) fs.writeFileSync(path.join(dir, 'playlist.json'), JSON.stringify(manifest, null, 2));
  for (const f of audio) fs.writeFileSync(path.join(dir, f), 'audio');
  for (const [sub, list] of [['raw', raw], ['clean', clean]]) {
    if (!list.length) continue;
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    for (const f of list) fs.writeFileSync(path.join(dir, sub, f), 'audio');
  }
  for (const [name, buf] of Object.entries(icons)) fs.writeFileSync(path.join(dir, 'icons', name), buf);
  return dir;
}
