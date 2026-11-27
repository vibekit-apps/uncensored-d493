// Accounts for this app's users (runs in server.js, Node only; no npm packages).
//
// A phone app cannot rely on browser cookies, so a signed-in user holds a
// random session token that the app keeps in secure storage and sends as
// `Authorization: Bearer <token>` (lib/api.ts does this). Only a SHA-256 of
// each token is stored, so a leaked data file does not hand out sessions.
// Passwords use scrypt with a per-user salt.
//
//   const auth = require('./lib/auth');
//   const user = auth.userFor(req);           // null when not signed in
//   if (!user) return json(res, { error: 'Sign in first' }, 401);
const crypto = require('crypto');
const store = require('./store');

const SESSION_DAYS = 180;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const hashPassword = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name || null, createdAt: u.createdAt });

// Each account's block lives in its own file, written only by setBlocked:
// { gen, blockedAt }. gen is a fresh random value for every block or unblock, and every
// session carries the gen its account had when it was issued: a session from any other
// gen is dead. So a block holds even if another write (a sign-in on a second server
// during a deploy) puts back a deleted session or an older users file, and two decisions
// saved at once on two servers never share a gen. No file = never blocked (gen 0, what
// sessions from before blocks existed carry); a file that cannot be read, or does not
// hold a record setBlocked wrote, refuses the request (503) rather than guess.
// The file is named by a hash of the id, so any id makes a safe file name.
const blockFile = (id) => `block-${hashToken(String(id)).slice(0, 32)}`;
const NEVER = { gen: 0, blockedAt: null };
const unsure = () => Object.assign(new Error('Unavailable for a moment: try again shortly'), { status: 503 });
function blockOf(id) {
  const b = store.read(blockFile(id), NEVER, { strict: true });
  if (b === NEVER) return b;
  const ok = b && typeof b === 'object' && typeof b.gen === 'string' && /^[0-9a-f]{32}$/.test(b.gen)
    && (b.blockedAt === null || (typeof b.blockedAt === 'string' && !Number.isNaN(Date.parse(b.blockedAt))));
  if (!ok) {
    console.error(`auth: ${blockFile(id)}.json does not hold a block record (left in place)`);
    throw unsure();
  }
  return b;
}

function issue(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const sessions = store.read('sessions').filter((s) => s.expiresAt > now);
  sessions.push({ hash: hashToken(token), userId: user.id, gen: blockOf(user.id).gen, createdAt: now, expiresAt: now + SESSION_DAYS * 864e5 });
  store.write('sessions', sessions);
  return { token, user: publicUser(user) };
}

/** Create an account and sign it in. Throws an Error whose message is safe to show. */
function signup({ email, password, name }) {
  const e = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('Enter a valid email address');
  if (String(password || '').length < 8) throw new Error('Use a password of at least 8 characters');
  const users = store.read('users');
  if (users.some((u) => u.email === e)) throw new Error('An account with that email already exists');
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { id: crypto.randomUUID(), email: e, name: name ? String(name).slice(0, 80) : null, salt, passwordHash: hashPassword(String(password), salt), createdAt: new Date().toISOString() };
  store.write('users', [...users, user]);
  return issue(user);
}

/** Sign in. Throws an Error whose message is safe to show. */
function login({ email, password }) {
  const e = String(email || '').trim().toLowerCase();
  const user = store.read('users').find((u) => u.email === e);
  const given = Buffer.from(hashPassword(String(password || ''), user ? user.salt : 'no-such-user'), 'hex');
  if (!user || !crypto.timingSafeEqual(given, Buffer.from(user.passwordHash, 'hex'))) throw new Error('Wrong email or password');
  if (blockOf(user.id).blockedAt) throw Object.assign(new Error('This account has been blocked'), { status: 403 });
  return issue(user);
}

function tokenOf(req) {
  const m = /^Bearer\s+([0-9a-f]{64})$/i.exec(req.headers.authorization || '');
  return m ? m[1] : null;
}

/** The signed-in user for a request, or null. */
function userFor(req) {
  const token = tokenOf(req);
  if (!token) return null;
  const s = store.read('sessions').find((x) => x.hash === hashToken(token) && x.expiresAt > Date.now());
  if (!s) return null;
  const b = blockOf(s.userId);
  if (b.blockedAt || (s.gen === undefined ? 0 : s.gen) !== b.gen) return null;
  const u = store.read('users').find((x) => x.id === s.userId);
  return u ? publicUser(u) : null;
}

/** End the request's session (no-op if there is none). */
function logout(req) {
  const token = tokenOf(req);
  if (!token) return;
  const h = hashToken(token);
  store.write('sessions', store.read('sessions').filter((s) => s.hash !== h));
}

// For the owner's screen only: server.js wraps the routes that call these in
// ownerOnly. Never hand them to an app user's route.
const MAX_LISTED = 500;

/** The app's accounts, newest first (at most 500): what the owner's list shows. */
function accounts() {
  return store.read('users').slice(-MAX_LISTED).reverse()
    .map((u) => ({ ...publicUser(u), blocked: !!blockOf(u.id).blockedAt }));
}

/**
 * Block or unblock an account. Either way its gen is replaced by a fresh random one, so
 * every session issued before (even one another server writes back) is dead; an unblocked
 * user signs in again.
 * Its sessions are deleted after, only to keep the sessions file small.
 */
function setBlocked(id, blocked) {
  const user = store.read('users').find((u) => u.id === id);
  if (!user) throw Object.assign(new Error('No such account'), { status: 404 });
  const was = blockOf(id);
  const next = { gen: crypto.randomBytes(16).toString('hex'), blockedAt: blocked ? (was.blockedAt || new Date().toISOString()) : null };
  store.write(blockFile(id), next);
  store.write('sessions', store.read('sessions').filter((s) => s.userId !== id));
  return { ...publicUser(user), blocked: !!next.blockedAt };
}

module.exports = { signup, login, logout, userFor, accounts, setBlocked };
