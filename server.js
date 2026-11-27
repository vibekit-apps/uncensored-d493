// This app's server. Zero npm dependencies (it boots before, and without, any
// install), and it does three jobs:
//
//   1. Your JSON API: the `routes` table below. Data lives in lib/data via
//      lib/store.js; accounts via lib/auth.js (each user's own name, bio and
//      photo via lib/profile.js); the owner's sign-in via
//      lib/owner.js; uploaded videos and photos via lib/files.js.
//   2. The phone app. Expo Go opens exps://<this app>/.vibekit/expo/manifest
//      and downloads the latest build from here. PLATFORM CONTRACT: keep the
//      /.vibekit/expo/* handling as it is.
//   3. The web version of the same app, at this app's address.
//
// Builds are made by the platform on Deploy (never here): each one lands in
// dist/releases/<id>/, and dist/CURRENT names the live one. This server reads
// CURRENT on every request and then reads only inside that release folder,
// which never changes once written, so a deploy switches over in one step.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const auth = require('./lib/auth');
const profile = require('./lib/profile');
const owner = require('./lib/owner');
const files = require('./lib/files');

const PORT = process.env.PORT || 3000;
const DIST = path.join(__dirname, 'dist');
const RELEASES = path.join(DIST, 'releases');
const EXPO = '/.vibekit/expo';
const RELEASE_ID_RE = /^r\d{14}-[0-9a-f]{8}$/;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

// ── API routes ────────────────────────────────────────────────────────
// Key is "METHOD /path". Handlers get (req, res) and may be async.
//
// What visitors leave for the owner (bookings, orders, messages, their names,
// phones and emails) is for the owner's eyes only: wrap the route that lists it
// in ownerOnly.
//   'GET /api/bookings': ownerOnly((req, res) => json(res, store.read('bookings'))),
// The owner signs in through VibeKit (no password to invent) in the web
// version: GET /api/owner/me says { owner: false } until they do, and the
// screen links to /api/owner/start. Expo Go cannot keep that sign-in, so in
// the phone app an owner screen opens the web version instead.
const PRIVATE = { 'Cache-Control': 'private, no-store' };
const routes = {
  'GET /health': (req, res) => json(res, { status: 'ok', uptime: process.uptime(), release: currentRelease() }),

  // Example data. Replace with your app's own.
  'GET /api/items': (req, res) => json(res, store.read('items')),
  'POST /api/items': async (req, res) => {
    const { text } = await readBody(req);
    if (!text || !String(text).trim()) return json(res, { error: 'Write something first' }, 400);
    const item = { id: crypto.randomUUID(), text: String(text).trim().slice(0, 500), createdAt: new Date().toISOString() };
    store.write('items', [item, ...store.read('items')]);
    json(res, item, 201);
  },

  // Accounts (lib/auth.js). The app keeps the returned token (lib/api.ts).
  'POST /api/auth/signup': async (req, res) => {
    try { json(res, auth.signup(await readBody(req)), 201); } catch (e) { json(res, { error: e.message }, e.status || 400); }
  },
  'POST /api/auth/login': async (req, res) => {
    try { json(res, auth.login(await readBody(req))); } catch (e) { json(res, { error: e.message }, e.status || 401); }
  },
  'POST /api/auth/logout': (req, res) => { auth.logout(req); json(res, { ok: true }); },
  'GET /api/auth/me': (req, res) => {
    const user = auth.userFor(req);
    return user ? json(res, { user }) : json(res, { error: 'Not signed in' }, 401);
  },
  // The signed-in user's own profile (lib/profile.js): name, bio, photo. The
  // Account tab edits it; never cached, since it is one person's own. Both
  // answers name whose profile it is, and a save naming someone other than
  // the signed-in user (a form left open in a tab while another tab signed in
  // as someone else) is refused here, before lib/profile.js writes anything,
  // so the check holds even for an app that kept an older lib/profile.js.
  'GET /api/profile': (req, res) => json(res, { ...profile.get(req), userId: auth.userFor(req).id }, 200, PRIVATE),
  'POST /api/profile': async (req, res) => {
    const body = await readBody(req);
    const user = auth.userFor(req);
    if (user && body && body.userId != null && body.userId !== user.id) {
      return json(res, { error: 'You are signed in as someone else now. Reload to edit that profile.' }, 409, PRIVATE);
    }
    const saved = profile.save(req, body); // throws 401 when nobody is signed in
    return json(res, { ...saved, userId: user.id }, 200, PRIVATE);
  },

  // Upload a video or photo (lib/files.js): the file itself is the body, sent
  // by uploadFile() in lib/api.ts. Returns { id, url, type, size }; save the
  // url on your record. Anyone signed in may upload; for "only I upload",
  // wrap it in ownerOnly instead. Played back from GET /api/files/<id>.
  'POST /api/files': async (req, res) => {
    if (!auth.userFor(req) && !(owner.isOwner(req) && owner.sameOrigin(req))) {
      req.resume();
      return json(res, { error: 'Sign in first' }, 401, { Connection: 'close' });
    }
    json(res, await files.save(req), 201);
  },

  // The owner signs in through VibeKit (lib/owner.js). Only on the app's own
  // VibeKit address, never a custom domain.
  'GET /api/owner/start': (req, res) => {
    const started = owner.start(req);
    if (!started) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Owner sign-in works on this app\'s own VibeKit address (the one ending in .vibekit.page). Open the app there and try again.');
    }
    res.writeHead(302, { Location: started.location, 'Set-Cookie': started.setCookie });
    res.end();
  },
  // The platform returns the owner to exactly this path, code in the hash.
  'GET /vk-owner': (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(OWNER_PAGE);
  },
  'POST /api/owner/redeem': async (req, res) => {
    if (!owner.sameOrigin(req)) return json(res, { error: 'Open the owner link again' }, 403);
    const { code } = await readBody(req);
    json(res, { ok: true }, 200, { 'Set-Cookie': await owner.redeem(req, code) });
  },
  // `look` is true for the agent's read-only look (lib/owner.js); the platform reads it
  // to confirm a look screenshot really was signed in.
  'GET /api/owner/me': (req, res) => json(res, { owner: owner.isOwner(req), look: owner.isLook(req) }),
  'POST /api/owner/signout': ownerOnly((req, res) => json(res, { ok: true }, 200, { 'Set-Cookie': owner.signOut(req) })),
};

/** Only the app's owner, as VibeKit confirmed them; anyone else gets a 403. */
function ownerOnly(handler) {
  return (req, res) => {
    if (!owner.isOwner(req) || !owner.sameOrigin(req)) return json(res, { error: 'Only the owner can see this' }, 403);
    return handler(req, res);
  };
}

// Clear the hash, post the code to this app's own server, go home. Nothing
// else runs here, because the code must reach nothing else.
const OWNER_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<title>Owner sign-in</title>
<style>body{font-family:system-ui,sans-serif;padding:3rem 1.5rem;text-align:center}</style>
</head>
<body>
<p id="status">Signing you in…</p>
<script>
(async () => {
  const status = document.getElementById('status');
  const code = new URLSearchParams(location.hash.slice(1)).get('vk_sign_in');
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch('/api/owner/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (r.ok) return location.replace('/');
    status.textContent = (await r.json()).error || 'That did not work. Open the owner link again.';
  } catch {
    status.textContent = 'That did not work. Check your connection and open the owner link again.';
  }
  const back = document.createElement('p');
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Back to the app';
  back.append(link);
  document.body.append(back);
})();
</script>
</body>
</html>
`;

function json(res, data, status = 200, headers = {}) {
  const payload = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers });
  res.end(payload);
}

const MAX_BODY_BYTES = 10 * 1024 * 1024;

/** Parse a JSON request body: `const data = await readBody(req)`. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      if (tooLarge) return;
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        tooLarge = true;
        raw = '';
        reject(Object.assign(new Error('Too large: the limit is 10 MB.'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(Object.assign(new Error('Invalid JSON body'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function safeDecode(p) {
  try { return decodeURIComponent(p); } catch { return null; }
}

// ── Releases (PLATFORM CONTRACT) ──────────────────────────────────────
/** The live release id, or null before the first deploy. */
function currentRelease() {
  try {
    const id = fs.readFileSync(path.join(DIST, 'CURRENT'), 'utf8').trim();
    return RELEASE_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** A file inside a release, or null if the path would leave it. */
function releaseFile(id, rel) {
  const root = path.join(RELEASES, id);
  const file = path.join(root, rel);
  return file.startsWith(root + path.sep) ? file : null;
}

/** The address this request came in on. The platform passes the public host
 *  in X-Forwarded-Host (the Host header here is the container's own). */
function publicOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const local = /^(localhost|127\.|\[::1\])/.test(host);
  const proto = String(req.headers['x-forwarded-proto'] || (local ? 'http' : 'https')).split(',')[0].trim();
  return { host, origin: `${proto}://${host}` };
}

const uuidFrom = (s) => {
  const h = crypto.createHash('sha256').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function releaseTime(id) {
  const m = /^r(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(id);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
}

/**
 * The update manifest Expo Go asks for (expo-updates protocol 1). What each
 * rule is for, all learned on a real phone (docs/mobile-apps-plan.md):
 * - extra.scopeKey is required, or Expo Go refuses to parse the manifest. It
 *   is stable per app address, so the phone keeps this app's storage.
 * - the id is derived from the whole manifest, so ANY change is a new id:
 *   Expo Go caches by id, and a manifest fixed under an old id stays broken.
 * - asset URLs name the release, so a phone that fetched this manifest can
 *   still download them after the next deploy goes live.
 */
function buildManifest(req, platform) {
  const id = currentRelease();
  // Expo Go shows this raw. True whether the first build is still running
  // (gets-8e63, 2026-10-20) or has not started: not "ask its agent".
  if (!id) return { status: 404, error: 'This app is not ready to open yet. When its chat says it is live, open it again.' };
  const meta = JSON.parse(fs.readFileSync(path.join(RELEASES, id, 'metadata.json'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync(path.join(RELEASES, id, 'expo-config.json'), 'utf8'));
  const fm = meta.fileMetadata && meta.fileMetadata[platform];
  if (!fm) return { status: 404, error: `This app has no ${platform} build.` };
  const runtime = `exposdk:${cfg.sdkVersion}`;
  const wants = req.headers['expo-runtime-version'];
  if (wants && wants !== runtime) {
    // Say which side is behind: when Expo Go is the newer one, updating it
    // cannot help, and the platform moves the app to the new SDK itself.
    const major = (v) => parseInt(String(v).replace('exposdk:', ''), 10);
    if (major(wants) > major(cfg.sdkVersion)) {
      return { status: 404, error: `This app is on Expo SDK ${major(cfg.sdkVersion)}; your Expo Go runs a newer SDK ${major(wants)}. VibeKit is updating it; try again in a little while.` };
    }
    return { status: 404, error: `This app is built for Expo SDK ${cfg.sdkVersion}, and this Expo Go runs ${String(wants).replace('exposdk:', 'SDK ')}. Update Expo Go from the App Store.` };
  }
  const { host, origin } = publicOrigin(req);
  const asset = (rel, ext, isLaunch) => {
    const buf = fs.readFileSync(path.join(RELEASES, id, rel));
    return {
      hash: b64url(crypto.createHash('sha256').update(buf).digest()),
      key: crypto.createHash('md5').update(buf).digest('hex'),
      fileExtension: isLaunch ? '.bundle' : `.${ext}`,
      contentType: isLaunch ? 'application/javascript' : (MIME[`.${ext}`] || 'application/octet-stream'),
      url: `${origin}${EXPO}/r/${id}/${rel}`,
    };
  };
  const body = {
    runtimeVersion: runtime,
    launchAsset: asset(fm.bundle, 'js', true),
    assets: fm.assets.map((a) => asset(a.path, a.ext, false)),
    metadata: {},
    extra: {
      expoClient: { ...cfg, runtimeVersion: runtime, extra: { ...(cfg.extra || {}), apiOrigin: origin } },
      scopeKey: `@anonymous/${cfg.slug}-${uuidFrom(`scope:${host}`)}`,
      eas: {},
    },
  };
  const manifest = { id: uuidFrom(JSON.stringify(body) + platform), createdAt: releaseTime(id), ...body };
  if (!manifest.launchAsset.url || !manifest.extra.scopeKey || !manifest.extra.expoClient.sdkVersion) {
    return { status: 500, error: 'This build is incomplete. Deploy it again.' };
  }
  return { status: 200, manifest };
}

function serveManifest(req, res, url) {
  const common = { 'expo-protocol-version': '1', 'expo-sfv-version': '0', 'Cache-Control': 'private, max-age=0' };
  const platform = req.headers['expo-platform'] || url.searchParams.get('platform') || 'ios';
  const r = buildManifest(req, platform === 'android' ? 'android' : 'ios');
  if (r.status !== 200) return json(res, { error: r.error, message: r.error }, r.status, common);
  const body = JSON.stringify(r.manifest);
  if (/multipart\/mixed/.test(req.headers.accept || '')) {
    const b = `vk${crypto.randomBytes(8).toString('hex')}`;
    const part = (name, content) => `--${b}\r\ncontent-disposition: form-data; name="${name}"\r\ncontent-type: application/json; charset=utf-8\r\n\r\n${content}\r\n`;
    const out = part('manifest', body) + part('extensions', JSON.stringify({ assetRequestHeaders: {} })) + `--${b}--\r\n`;
    res.writeHead(200, { ...common, 'Content-Type': `multipart/mixed; boundary=${b}` });
    return res.end(out);
  }
  res.writeHead(200, { ...common, 'Content-Type': 'application/json' });
  res.end(body);
}

function serveReleaseAsset(res, id, rel) {
  if (!RELEASE_ID_RE.test(id)) return json(res, { error: 'Not found' }, 404);
  const file = releaseFile(id, rel);
  if (!file) return json(res, { error: 'Not found' }, 404);
  fs.readFile(file, (err, data) => {
    if (err) return json(res, { error: 'Not found' }, 404);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' });
    res.end(data);
  });
}

// Shown at this app's address until its first build is live, in the visitor's
// language (the eight VibeKit ships), with VibeKit's look. It reloads itself,
// so the app appears the moment it is built.
const BUILDING_WORDS = {
  en: ['First build in progress', 'This app appears here, and on your phone in Expo Go, once its first version is built. This page updates by itself.'],
  de: ['Die erste Version wird gebaut', 'Diese App erscheint hier und auf deinem Handy in Expo Go, sobald ihre erste Version fertig ist. Diese Seite aktualisiert sich von selbst.'],
  es: ['Creando la primera versión', 'Esta app aparecerá aquí, y en tu teléfono en Expo Go, cuando su primera versión esté lista. Esta página se actualiza sola.'],
  fr: ['Première version en préparation', 'Cette app s’affichera ici, et sur ton téléphone dans Expo Go, dès que sa première version sera prête. Cette page se met à jour toute seule.'],
  ja: ['最初のバージョンを作成中', '最初のバージョンが完成すると、このアプリがここと、スマホの Expo Go に表示されます。このページは自動で更新されます。'],
  'pt-BR': ['Criando a primeira versão', 'Este app aparece aqui, e no seu celular pelo Expo Go, assim que a primeira versão ficar pronta. Esta página se atualiza sozinha.'],
  ru: ['Собираем первую версию', 'Приложение появится здесь и на телефоне в Expo Go, как только будет готова его первая версия. Страница обновится сама.'],
  'zh-Hans': ['正在构建第一个版本', '第一个版本完成后，这个应用会出现在这里，也会出现在你手机上的 Expo Go 里。此页面会自动刷新。'],
};

// The browser's languages by preference (q), skipping refused ones (q=0):
// the first we have words for, else English.
function pageLanguage(req) {
  const tags = String(req.headers['accept-language'] || '').split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1, i };
  }).filter((t) => t.tag && t.q > 0).sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of tags) {
    const base = tag.split('-')[0];
    if (base === 'zh') { if (/-(hant|tw|hk|mo)\b/.test(tag)) continue; return 'zh-Hans'; }
    if (base === 'pt') return 'pt-BR';
    if (Object.hasOwn(BUILDING_WORDS, base)) return base;
  }
  return 'en';
}

function buildingPage(lang) {
  const [title, body] = BUILDING_WORDS[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><meta name="theme-color" content="#0e0e13"><title>${title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;600;700&display=swap">
<style>*{margin:0;box-sizing:border-box}
body{min-height:100vh;display:flex;flex-direction:column;font-family:"Golos Text",system-ui,-apple-system,sans-serif;background:#0e0e13;color:#f0f0f3;padding:22px 16px;-webkit-font-smoothing:antialiased}
body::before{content:'';position:fixed;inset:0;z-index:-2;background:url(https://vibekit.bot/public/bg2-screen.webp) center/cover}
body::after{content:'';position:fixed;inset:0;z-index:-1;background:rgba(14,14,19,.82)}
header img{display:block;height:26px}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;max-width:480px;margin:0 auto;padding:32px 0}
.tile{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;background:rgba(167,139,250,.1);border:1px solid rgba(167,139,250,.2);color:#c4b5fd}
h1{font-size:clamp(28px,7vw,40px);line-height:1.12;letter-spacing:-.035em;text-wrap:balance;margin-bottom:14px}
p{font-size:17px;line-height:1.55;color:#c9c9d1;text-wrap:balance;margin-bottom:26px}
.bar{position:relative;width:100%;max-width:300px;height:6px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}
.bar i{position:absolute;top:0;bottom:0;width:40%;border-radius:99px;background:linear-gradient(90deg,#7c3aed,#a78bfa,#c4b5fd);animation:slide 1.6s cubic-bezier(.22,1,.36,1) infinite}
@keyframes slide{from{left:-40%}to{left:100%}}
@media (prefers-reduced-motion:reduce){.bar i{animation:none;left:30%}}</style></head>
<body><header><a href="https://vibekit.bot"><img src="https://vibekit.bot/public/img/brand/vibekit-logo.svg" alt="VibeKit" width="122" height="26"></a></header>
<main><div class="tile"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></div>
<h1>${title}</h1><p>${body}</p><div class="bar"><i></i></div></main></body></html>`;
}

/** The web version: files from the live release, index.html for app routes. */
function serveWeb(req, res, pathname) {
  const id = currentRelease();
  if (!id) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(buildingPage(pageLanguage(req)));
  }
  const decoded = pathname === '/' ? 'index.html' : safeDecode(pathname);
  if (decoded === null) return json(res, { error: 'Bad request' }, 400);
  const rel = decoded.replace(/^\/+/, '');
  // The build's own bookkeeping is not part of the website.
  if (rel === 'metadata.json' || rel === 'expo-config.json') return json(res, { error: 'Not found' }, 404);
  const file = releaseFile(id, rel);
  if (!file) return json(res, { error: 'Not found' }, 404);
  fs.readFile(file, (err, data) => {
    if (!err) {
      const immutable = rel.startsWith('_expo/static/') || rel.startsWith('assets/');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' });
      return res.end(data);
    }
    if (path.extname(rel)) return json(res, { error: 'Not found' }, 404);
    fs.readFile(path.join(RELEASES, id, 'index.html'), (e, html) => {
      if (e) return json(res, { error: 'Not found' }, 404);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(html);
    });
  });
}

// A look (the agent's read-only view as the owner, lib/owner.js) never writes: every
// request that is not a GET or HEAD is refused, and store.write throws inside the rest,
// so even a page that saves something as it loads changes nothing. Data kept outside
// lib/store.js (another database, an outside API) is yours to guard: check
// owner.isLook(req) before writing to it.
http.createServer((req, res) => {
  if (owner.isLook(req)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: 'Look only: this request was refused while the agent is looking as the owner' }, 403);
    return store.runReadOnly(() => handle(req, res));
  }
  return handle(req, res);
}).listen(PORT, () => console.log(`Listening on port ${PORT}`));

async function handle(req, res) {
  let pathname = req.url || '/';
  try {
    const url = new URL(req.url, 'http://localhost');
    pathname = url.pathname;
    const handler = routes[`${req.method} ${pathname}`];
    if (handler) return await handler(req, res);
    if (pathname === `${EXPO}/manifest`) return serveManifest(req, res, url);
    if (pathname.startsWith(`${EXPO}/r/`)) {
      const rest = safeDecode(pathname.slice(`${EXPO}/r/`.length));
      if (rest === null) return json(res, { error: 'Bad request' }, 400);
      const slash = rest.indexOf('/');
      if (slash < 1) return json(res, { error: 'Not found' }, 404);
      return serveReleaseAsset(res, rest.slice(0, slash), rest.slice(slash + 1));
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && pathname.startsWith('/api/files/')) {
      return files.serve(req, res, safeDecode(pathname.slice('/api/files/'.length)));
    }
    if (pathname.startsWith(`${EXPO}/`) || pathname.startsWith('/api/')) return json(res, { error: 'Not found' }, 404);
    serveWeb(req, res, pathname);
  } catch (err) {
    console.error(`${req.method} ${pathname} failed:`, err.message);
    if (res.headersSent) return;
    // A thrown error with a status (400, 403, 413, 415, 503...) carries words
    // meant for the person; anything else is a bug and says only "Server error".
    if (err.status >= 400 && err.status < 600 && err.status !== 500) json(res, { error: err.message }, err.status, err.status === 413 ? { Connection: 'close' } : {});
    else json(res, { error: 'Server error' }, 500);
  }
}
