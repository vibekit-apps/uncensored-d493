// A signed-in user's own profile: name, bio and a small photo. Only that user
// reads or writes it (the owner and visitors get a 401). The name lives on the
// account (lib/auth.js's `users` row) so useAuth() and /api/auth/me show the
// new one; bio and photo live in `profiles`, one row per user. The Account tab
// (app/(tabs)/account.tsx) edits it. The web starter ships this same module.
//
// The photo arrives as a JPEG data URL already cut to a small square on the
// phone (PhotoField with `square`). It is checked here (real JPEG bytes, small
// dimensions, capped size) so one profile cannot bloat the file every request
// reads or hand other screens something that is not an image.
const auth = require('./auth');
const store = require('./store');

const MAX_NAME = 80;
const MAX_BIO = 300;
const MAX_PHOTO = 150 * 1024; // characters of data URL: a 256 px JPEG is ~20-40 KB
const MAX_SIDE = 1024; // pixels; the app sends 256
const PHOTO = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+=*)$/;

const fail = (status, message) => Object.assign(new Error(message), { status });

function userOf(req) {
  const user = auth.userFor(req);
  if (!user) throw fail(401, 'Sign in first');
  return user;
}

/**
 * The width and height of a JPEG, or null when the bytes are not a whole one:
 * every header segment must fit inside the file, one frame header must give the
 * size, and a scan header must be followed by image data up to the end marker.
 * (A scan cut short inside its data still passes; only decoding can tell, and
 * the worst it does is draw a broken image on the user's own profile.)
 */
function jpegSize(buf) {
  const end = buf.length - 2; // where the end-of-image marker sits
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[end] !== 0xff || buf[end + 1] !== 0xd9) return null;
  let size = null;
  let i = 2;
  while (i + 4 <= end) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; } // fill byte
    const len = buf.readUInt16BE(i + 2);
    const next = i + 2 + len;
    if (len < 2 || next > end) return null; // a segment that runs past the image
    // A frame header (SOF0-15, minus DHT/JPG/DAC): 8 bytes plus 3 per colour component.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (size || len < 11 || len !== 8 + 3 * buf[i + 9]) return null;
      size = { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    } else if (marker === 0xda) {
      // Start of scan: 6 bytes plus 2 per component, then the image data itself.
      if (!size || len < 8 || len !== 6 + 2 * buf[i + 4] || next >= end) return null;
      return size;
    } else if (marker < 0xe0 && marker !== 0xc4 && marker !== 0xdb && marker !== 0xdd && marker !== 0xcc) {
      return null; // only tables, app data and comments belong before the scan
    }
    i = next;
  }
  return null;
}

function checkPhoto(photo) {
  if (typeof photo !== 'string') throw fail(400, 'That photo could not be read. Try another one.');
  // A 400, the same code as the web starter's copy of this module (its
  // server.js answers every 413 with the 10 MB body limit).
  if (photo.length > MAX_PHOTO) throw fail(400, 'That photo is too large. Try another one.');
  const m = PHOTO.exec(photo);
  const buf = m && Buffer.from(m[1], 'base64');
  const size = buf && buf.toString('base64') === m[1] ? jpegSize(buf) : null;
  if (!size || !size.width || !size.height) throw fail(400, 'That photo could not be read. Try another one.');
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) throw fail(400, 'That photo is too large. Try another one.');
}

function get(req) {
  const user = userOf(req);
  const p = store.read('profiles').find((r) => r.userId === user.id) || {};
  return { userId: user.id, name: user.name || '', bio: p.bio || '', photo: p.photo || null };
}

function save(req, body) {
  const user = userOf(req);
  const b = body || {};
  // A form opened for one person and sent after the browser signed in as
  // another (another tab) names its person, and is refused, never saved over
  // the new one's profile.
  if (b.userId != null && b.userId !== user.id) throw fail(409, 'You are signed in as someone else now. Reload to edit that profile.');
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const bio = typeof b.bio === 'string' ? b.bio.trim() : '';
  const photo = b.photo == null || b.photo === '' ? null : b.photo;
  if (name.length > MAX_NAME) throw fail(400, `Keep the name under ${MAX_NAME} characters`);
  if (bio.length > MAX_BIO) throw fail(400, `Keep the bio under ${MAX_BIO} characters`);
  if (photo !== null) checkPhoto(photo);

  // Two files, each written whole (store.js). The save is the user's full
  // profile every time, so trying again always lands it: bio and photo first,
  // then the name, and a failed second write says exactly what was kept.
  const rows = store.read('profiles').filter((r) => r.userId !== user.id);
  store.write('profiles', [...rows, { userId: user.id, bio, photo, updatedAt: new Date().toISOString() }]);
  try {
    store.write('users', store.read('users').map((u) => (u.id === user.id ? { ...u, name: name || null } : u)));
  } catch (e) {
    if (e.status) throw e;
    console.error('profile: name not saved:', e.message);
    throw fail(500, 'Your bio and photo were saved, but your name was not. Save again.');
  }
  return { userId: user.id, name, bio, photo };
}

module.exports = { get, save };
