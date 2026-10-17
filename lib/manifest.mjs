// Load a card folder's playlist.json and resolve + validate everything before any upload.
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg']);
const BRANCH_FIELDS = ['id', 'left', 'right', 'end'];

export function iconInfo(buf) {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString('ascii', 12, 16) === 'IHDR') {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return { type: 'gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  return null;
}

export function isInteractive(manifest) {
  return (manifest?.tracks || []).some((t) => BRANCH_FIELDS.slice(1).some((f) => t[f] != null));
}

function audioDir(cardDir) {
  const clean = path.join(cardDir, 'clean');
  return fs.existsSync(clean) ? clean : cardDir;
}

export function checkCard(cardDir) {
  const manifestPath = path.join(cardDir, 'playlist.json');
  const errors = [];
  const warnings = [];
  if (!fs.existsSync(manifestPath)) {
    return { manifest: null, manifestPath, errors: [`no playlist.json in ${cardDir}`], warnings, tracks: [] };
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    return { manifest: null, manifestPath, errors: [`playlist.json is not valid JSON: ${e.message}`], warnings, tracks: [] };
  }
  if (!manifest.title) errors.push('playlist.json: missing "title"');
  if (!Array.isArray(manifest.tracks) || !manifest.tracks.length) errors.push('playlist.json: "tracks" must be a non-empty list');

  const dir = audioDir(cardDir);
  const files = fs.readdirSync(dir).filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  const tracks = (manifest.tracks || []).map((t, i) => {
    const label = t.title || `track ${i + 1}`;
    let audioPath = null;
    const m = String(t.match || '').normalize('NFC').toLowerCase();
    const hits = m ? files.filter((f) => f.normalize('NFC').toLowerCase().includes(m)) : [];
    if (!m) errors.push(`${label}: missing "match"`);
    else if (hits.length === 0) errors.push(`${label}: no recording matching "${t.match}" in ${path.relative(cardDir, dir) || '.'}`);
    else if (hits.length > 1) errors.push(`${label}: "${t.match}" matched ${hits.length} recordings: ${hits.join(', ')}`);
    else audioPath = path.join(dir, hits[0]);

    let iconPath = null;
    let iconType = null;
    const ip = path.join(cardDir, 'icons', String(t.icon || ''));
    if (!t.icon || !fs.existsSync(ip)) errors.push(`${label}: missing icon icons/${t.icon || '(none)'}`);
    else {
      const info = iconInfo(fs.readFileSync(ip));
      if (!info) errors.push(`${label}: icon ${t.icon} is not a PNG or GIF`);
      else if (info.w !== 16 || info.h !== 16) errors.push(`${label}: icon ${t.icon} is ${info.w}x${info.h}, needs 16x16`);
      else { iconPath = ip; iconType = info.type; }
    }
    return { n: i + 1, title: label, id: t.id ?? null, left: t.left ?? null, right: t.right ?? null, end: t.end ?? null, audioPath, iconPath, iconType };
  });

  if (isInteractive(manifest)) {
    const ids = new Set();
    for (const t of tracks) {
      if (t.id == null) continue;
      if (ids.has(t.id)) errors.push(`duplicate id "${t.id}"`);
      ids.add(t.id);
    }
    const reached = new Set();
    for (const t of tracks) {
      for (const f of ['left', 'right']) {
        if (t[f] == null) continue;
        if (!ids.has(t[f])) errors.push(`${t.title}: ${f} -> "${t[f]}" is not a track id`);
        else reached.add(t[f]);
      }
      if (t.end != null && t.end !== 'stop' && t.end !== 'repeat') {
        if (!ids.has(t.end)) errors.push(`${t.title}: end must be stop, repeat or a track id (got "${t.end}")`);
        else reached.add(t.end);
      }
    }
    // the player's behavior with no onEnd is unmeasured: make the author say what happens
    for (const t of tracks) if (t.end == null) warnings.push(`${t.title}: no end set (use repeat at a choice, stop at an ending)`);
    tracks.slice(1).forEach((t) => {
      if (!t.id || !reached.has(t.id)) warnings.push(`${t.title}: nothing leads here (unreachable passage)`);
    });
  }
  return { manifest, manifestPath, errors, warnings, tracks };
}
