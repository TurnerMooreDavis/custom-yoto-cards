// Yoto media + content HTTP calls (moved from upstream yoto-upload.js).
import fs from 'node:fs';
import path from 'node:path';
import { API } from './auth.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav', '.flac': 'audio/flac', '.ogg': 'audio/ogg' };

async function jsonOrThrow(res, label) {
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch {}
    throw new Error(`${label} failed: HTTP ${res.status} ${res.statusText}\n${body.slice(0, 500)}`);
  }
  return res.json();
}

export async function uploadAudio(token, filePath) {
  const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const got = await jsonOrThrow(await fetch(`${API}/media/transcode/audio/uploadUrl`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }), 'Request upload URL');
  const { uploadUrl, uploadId } = got.upload;
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: new Blob([fs.readFileSync(filePath)], { type: contentType }) });
  if (!put.ok) throw new Error(`Audio PUT failed: HTTP ${put.status}`);
  // loudnorm=false: prep already normalized loudness
  for (let i = 0; i < 120; i++) {
    const res = await fetch(`${API}/media/upload/${uploadId}/transcoded?loudnorm=false`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (data.transcode?.transcodedSha256) return data.transcode;
    }
    await sleep(1000);
  }
  throw new Error('Transcoding timed out');
}

// Body must be the raw image bytes, not multipart (upstream gotcha: multipart -> 400).
export async function uploadIcon(token, iconPath, iconType) {
  const name = path.basename(iconPath, path.extname(iconPath));
  const url = `${API}/media/displayIcons/user/me/upload?autoConvert=true&filename=${encodeURIComponent(name)}`;
  const data = await jsonOrThrow(await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': iconType === 'gif' ? 'image/gif' : 'image/png' },
    body: fs.readFileSync(iconPath),
  }), 'Icon upload');
  return data.displayIcon.mediaId;
}

export async function createContent(token, body) {
  return jsonOrThrow(await fetch(`${API}/content`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), 'Create content');
}
