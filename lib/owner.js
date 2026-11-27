// The app's owner signs in through VibeKit, never with a password you invent.
// Only the account that owns this app can finish this, so being "the owner" here
// means the platform said so. An owner-only route checks isOwner(req) and nothing
// else: a visitor, or an account the app made, is never the owner.
//
// /api/owner/start keeps a random verifier in an HttpOnly cookie and sends the
// owner to VibeKit; they come back to exactly /vk-owner with a code in the hash,
// which public/vk-owner.html posts to /api/owner/redeem. This works on the app's
// own VibeKit address only (<name>.vibekit.bot or <name>.vibekit.page), never a
// custom domain.
//
// A LOOK session is what the agent's screenshot of an owner-only page gets (VIBE-476):
// the owner's view, read only. The platform hands a look code only to a server that
// sends accept_look on the redeem (below), and this module marks the session look.
// server.js then refuses every write for that session: non-GET requests are answered
// 403, and store.write throws while the request is a look (lib/store.js). Any other
// write the app makes while a page loads (another database, email, payments) is not
// stopped by this module: that code must check isLook(req) itself.
// A look session also ends after LOOK_MINUTES. isOwner stays true, so reads work.
//
// The cookies carry the __Host- prefix because every app on a VibeKit address is a
// sibling of this one: the prefix stops a sibling from setting them, and sameOrigin()
// stops a sibling's page from using them, which SameSite does not (they count as one site).
const crypto = require('crypto');
const store = require('./store');

const START_URL = 'https://app.vibekit.bot/auth/app/owner';
const SESSION_DAYS = 7;
const LOOK_MINUTES = 15;
const sha256 = (t) => crypto.createHash('sha256').update(t).digest();
const base64url = (b) => b.toString('base64url');

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const VERIFIER = '__Host-vk_owner_verifier';
const SESSION = '__Host-vk_owner';
const cookie = (name, value, sameSite, maxAge) => `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=${sameSite}; Max-Age=${maxAge}`;

/** False when another site's page sent this request. Browsers always say on a write. */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.vibekit\.(?:bot|page)$/i;

/** Where to send the owner, and the cookie that proves this browser started it. Null off the app's own address. */
function start(req) {
  if (!HOST.test(req.headers.host || '')) return null;
  const verifier = base64url(crypto.randomBytes(32));
  const returnTo = `https://${req.headers.host}/vk-owner`;
  const location = `${START_URL}?return_to=${encodeURIComponent(returnTo)}&code_challenge=${base64url(sha256(verifier))}`;
  return { location, setCookie: cookie(VERIFIER, verifier, 'Lax', 600) };
}

/** Trade the code for an owner session. Returns the cookies to set, or throws. */
async function redeem(req, code) {
  const verifier = cookies(req)[VERIFIER];
  if (!verifier || !code) throw Object.assign(new Error('Open the owner link again'), { status: 400 });
  if (!process.env.VIBEKIT_SIGN_IN_URL) throw Object.assign(new Error('Owner sign-in is not set up yet. Redeploy the app.'), { status: 503 });
  const r = await fetch(process.env.VIBEKIT_SIGN_IN_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.VIBEKIT_AI_TOKEN}`, 'Content-Type': 'application/json' },
    // accept_look: this server keeps a look session read-only (see the top). Without it
    // the platform does not hand a look code over at all.
    body: JSON.stringify({ code: String(code), code_verifier: verifier, accept_look: true }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok || !body.user || body.user.owner !== true) throw Object.assign(new Error('That sign-in is not the owner of this app'), { status: 403 });
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const look = body.user.look === true;
  const ttl = look ? LOOK_MINUTES * 60e3 : SESSION_DAYS * 864e5;
  const sessions = store.read('owner-sessions').filter((s) => s.expiresAt > now);
  sessions.push({ hash: sha256(token).toString('hex'), expiresAt: now + ttl, ...(look ? { look: true } : {}) });
  store.write('owner-sessions', sessions);
  return [cookie(SESSION, token, 'Lax', Math.floor(ttl / 1000)), cookie(VERIFIER, '', 'Lax', 0)];
}

function sessionFor(req) {
  const token = cookies(req)[SESSION];
  if (!token) return null;
  const hash = sha256(token).toString('hex');
  return store.read('owner-sessions').find((s) => s.hash === hash && s.expiresAt > Date.now()) || null;
}

function isOwner(req) {
  return !!sessionFor(req);
}

/** True for the agent's read-only look at the owner's view; never for a person's own sign-in. */
function isLook(req) {
  const s = sessionFor(req);
  return !!s && s.look === true;
}

function signOut(req) {
  const token = cookies(req)[SESSION];
  if (token) {
    const hash = sha256(token).toString('hex');
    store.write('owner-sessions', store.read('owner-sessions').filter((s) => s.hash !== hash));
  }
  return cookie(SESSION, '', 'Lax', 0);
}

module.exports = { start, redeem, isOwner, isLook, signOut, sameOrigin };
