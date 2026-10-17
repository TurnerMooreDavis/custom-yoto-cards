// Turn resolved tracks + upload results into the POST /content body.
// Linear output is upstream's exact shape; interactive adds playbackType + per-track events.
import crypto from 'node:crypto';

// ---- derive a stable per-track chapter key (verbatim from upstream yoto-upload.js) ----
// The player caches downloaded chapter audio by key; hashing a stable seed (the title, or the
// passage id for interactive cards) keeps a track's key fixed across reorders/add/remove.
export function stableKey(seed, used) {
  const hash = crypto.createHash('sha256').update(seed).digest();
  let n = hash[0] % 99;
  let key = String(n + 1).padStart(2, '0');
  for (let offset = 1; used.has(key); offset++) {
    n = (n + hash[offset % hash.length] + offset) % 99;
    key = String(n + 1).padStart(2, '0');
  }
  used.add(key);
  return key;
}

// goto target shape, as measured in docs/interactive-events.md. Every chapter has one track, key '01'.
export function gotoParams(chapterKey) {
  return { chapterKey, trackKey: '01' };
}

function eventFor(target, keyById) {
  if (target === 'stop' || target === 'repeat') return { cmd: target };
  return { cmd: 'goto', params: gotoParams(keyById.get(target)) };
}

export function buildContent({ manifest, tracks, uploads, interactive }) {
  const used = new Set();
  const keys = tracks.map((t) => stableKey(interactive && t.id ? t.id : t.title, used));
  const keyById = new Map(tracks.map((t, i) => [t.id, keys[i]]));
  let totalDuration = 0;
  let totalFileSize = 0;
  const chapters = tracks.map((t, i) => {
    const { transcode, mediaId } = uploads[i];
    const info = transcode.transcodedInfo || {};
    const disp = { icon16x16: `yoto:#${mediaId}` };
    const track = {
      key: '01', title: t.title, trackUrl: `yoto:#${transcode.transcodedSha256}`, type: 'audio',
      format: info.format, duration: info.duration, fileSize: info.fileSize, channels: info.channels,
      overlayLabel: String(t.n), display: disp,
    };
    if (interactive) {
      const events = {};
      if (t.left) events.onLhb = eventFor(t.left, keyById);
      if (t.right) events.onRhb = eventFor(t.right, keyById);
      if (t.end) events.onEnd = eventFor(t.end, keyById);
      if (Object.keys(events).length) track.events = events;
    }
    totalDuration += info.duration || 0;
    totalFileSize += info.fileSize || 0;
    return { key: keys[i], title: t.title, overlayLabel: String(t.n), display: disp, tracks: [track] };
  });
  return {
    ...(manifest.cardId ? { cardId: manifest.cardId } : {}),
    title: manifest.title,
    content: { ...(interactive ? { playbackType: 'interactive' } : {}), chapters },
    metadata: { media: { duration: totalDuration, fileSize: totalFileSize, readableFileSize: Math.round((totalFileSize / 1024 / 1024) * 10) / 10 } },
  };
}
