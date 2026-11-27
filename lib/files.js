// Videos and photos people upload, saved as files in lib/data/files and played
// back from GET /api/files/<id>. Zero npm dependencies, like the rest of the
// server.
//
// The phone sends the file itself as the request body (uploadFile in
// lib/api.ts), never JSON or base64, so a 40 MB video costs 40 MB, streams to
// disk as it arrives and never sits in memory. Store the returned `url` on
// your record (a booking, a post, a lesson) and play it with fileUrl(url).
//
// Playback answers Range requests (206), which video players need to start
// fast and to seek. Files never change once saved, so they cache forever.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, 'data', 'files');
// Under the platform's 50 MB request limit, with room for headers.
const MAX_BYTES = 45 * 1024 * 1024;
const TYPES = {
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/x-m4v': '.m4v',
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};
const CONTENT_TYPES = Object.fromEntries(Object.entries(TYPES).map(([type, ext]) => [ext, type]));
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|m4v|jpg|png|webp)$/;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Save the request body as a file. Resolves { id, url, type, size }. */
function save(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[type];
    if (!ext) { req.resume(); return reject(fail(415, 'Send a video (MP4 or MOV) or a photo (JPEG, PNG or WebP).')); }
    const declared = Number(req.headers['content-length']);
    if (declared > MAX_BYTES) { req.resume(); return reject(fail(413, 'Too large: the limit is 45 MB. Try a shorter video.')); }

    fs.mkdirSync(DIR, { recursive: true });
    const id = crypto.randomUUID() + ext;
    const part = path.join(DIR, `.part-${id}`);
    const out = fs.createWriteStream(part, { flags: 'wx' });
    let size = 0;
    let done = false;
    const stop = (err) => {
      if (done) return;
      done = true;
      req.unpipe(out);
      out.destroy();
      fs.rm(part, { force: true }, () => {});
      req.resume();
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) stop(fail(413, 'Too large: the limit is 45 MB. Try a shorter video.'));
    });
    req.on('close', () => { if (!req.complete) stop(fail(400, 'The upload was cut off. Try again.')); });
    req.on('error', () => stop(fail(400, 'The upload was cut off. Try again.')));
    out.on('error', () => stop(fail(500, 'Could not save the file. Try again.')));
    out.on('finish', () => {
      if (done) return;
      if (size === 0) return stop(fail(400, 'The file was empty.'));
      fs.rename(part, path.join(DIR, id), (err) => {
        if (err) return stop(fail(500, 'Could not save the file. Try again.'));
        done = true;
        resolve({ id, url: `/api/files/${id}`, type, size });
      });
    });
    req.pipe(out);
  });
}

/** Play back a saved file, with Range support. Ends the response itself. */
function serve(req, res, id) {
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"error":"Not found"}'); };
  if (!id || !ID_RE.test(id)) return notFound();
  const file = path.join(DIR, id);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound();
    const headers = {
      'Content-Type': CONTENT_TYPES[path.extname(id)],
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    };
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    // One range ("bytes=0-1", "bytes=100-", "bytes=-500"). Anything else is
    // ignored and the whole file is sent, which every player accepts.
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), st.size - 1) : st.size - 1; }
      else { start = Math.max(0, st.size - Number(m[2])); }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` });
        return res.end();
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = st.size === 0 ? 0 : end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || st.size === 0) return res.end();
    fs.createReadStream(file, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

/** Delete a saved file (when its record is deleted). Unknown ids do nothing. */
function remove(id) {
  if (id && ID_RE.test(id)) fs.rm(path.join(DIR, id), { force: true }, () => {});
}

module.exports = { save, serve, remove, MAX_BYTES };
