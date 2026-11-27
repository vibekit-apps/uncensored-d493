// Talk to this app's own server (server.js) from the phone and from the web.
//
//   import { api } from '@/lib/api';
//   const items = await api<Item[]>('GET', '/api/items');
//   await api('POST', '/api/items', { text: 'Milk' });
//
// Who is signed in: const { user, signIn, signOut } = useAuth();  (below; the
// sign-in screen is app/login.tsx)
//
// Videos and photos people pick (expo-image-picker) go up as files, never as
// JSON or base64, and come back as a url to keep on your record:
//   const { url } = await uploadFile(asset);          // asset from the picker
//   <VideoView player={useVideoPlayer(fileUrl(url))} />  // expo-video
//
// Why this exists instead of bare fetch(): the app's server SLEEPS when nobody
// has used it for a while, and waking it takes up to a minute. While it wakes,
// the platform answers for it with `503 {"placeholder":"waking","retryAfter":5}`.
// That answer means the request never reached the app, so it is always safe to
// send again, and api() does, for up to a minute. Meanwhile the app's frame
// (app/_layout.tsx) covers the screen with components/WakingScreen.tsx, using
// the words the platform sent, and takes it away the moment the server
// answers; screens do nothing. A network error is different: a write may have
// landed before the connection dropped, so a write is not repeated and the
// error says to try again.
//
// The session token (from /api/auth/login or /signup) is kept in the phone's
// secure storage (localStorage on the web) and sent on every call. It is
// cleared only when THIS app's server answers 401, never because the server
// was asleep.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** The app's server. On a phone it is the address Expo Go opened the app from
 *  (the platform puts it in the config it serves); on the web, this page's own. */
export const API_ORIGIN =
  Platform.OS === 'web' ? '' : String((Constants.expoConfig?.extra as { apiOrigin?: string } | undefined)?.apiOrigin || '');

const TOKEN_KEY = 'session';

export async function getToken(): Promise<string | null> {
  await tokenWrites; // a read never sees a token a pending write is about to replace
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

// Bumped whenever the session changes, so a slow answer about the old one
// (a profile lookup, a 401, a sign-out) is dropped instead of undoing a newer
// sign-in. Token writes run one after another for the same reason.
let sessionEpoch = 0;
let tokenWrites: Promise<unknown> = Promise.resolve();

export function setToken(token: string | null): Promise<void> {
  sessionEpoch++;
  if (!token) setAuthUser(null);
  const write = async () => {
    if (Platform.OS === 'web') {
      if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
      else globalThis.localStorage?.removeItem(TOKEN_KEY);
    } else if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  };
  const done = tokenWrites.then(write, write);
  tokenWrites = done.catch(() => {});
  return done;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

const WAKE_BUDGET_MS = 60_000;

/** What the platform says while the app's server is not up yet: its sentence,
 *  and (while it wakes) the offer to keep it always on. The words come from
 *  the platform, the same ones its web waking page shows. */
export type WakingState = {
  message: string;
  upsell: { text: string; label: string; url: string } | null;
} | null;

let current: WakingState = null;
const listeners = new Set<(w: WakingState) => void>();
function setWaking(next: WakingState) {
  current = next;
  for (const l of listeners) l(next);
}

/** Non-null while api() is waiting for the app's server to come up. */
export function useWakingState(): WakingState {
  const [state, set] = useState<WakingState>(current);
  useEffect(() => {
    listeners.add(set);
    set(current);
    return () => { listeners.delete(set); };
  }, []);
  return state;
}

/** True while api() is waiting for the app's server to come up. */
export function useWaking(): boolean {
  return useWakingState() !== null;
}

export type AuthUser = { id: string; email: string; name: string | null };

// Who is signed in, shared by every screen that asks (undefined: not known yet).
let authUser: AuthUser | null | undefined;
let authAsked = false;
let signingOut = false;
const authListeners = new Set<(u: AuthUser | null | undefined) => void>();
function setAuthUser(u: AuthUser | null) {
  authUser = u;
  for (const l of authListeners) l(u);
}

/** Who is signed in, and how to sign in, up and out (the /api/auth/* routes in
 *  server.js; the screen is app/login.tsx). `user` is undefined while it is
 *  being checked, null when nobody is signed in.
 *
 *    const { user, signOut } = useAuth();
 *    if (user === null) router.push('/login');
 *
 *  `reload()` asks the server again, after something changes the user's name
 *  (the Account tab's profile save does).
 */
export function useAuth() {
  const [user, set] = useState(authUser);
  useEffect(() => {
    authListeners.add(set);
    set(authUser);
    if (!authAsked) {
      authAsked = true;
      const epoch = sessionEpoch;
      getToken()
        .then((t) => (t ? api<{ user: AuthUser }>('GET', '/api/auth/me').then((r) => r.user) : null))
        .then((u) => { if (epoch === sessionEpoch) setAuthUser(u); }, (e) => {
          if (epoch !== sessionEpoch) return; // the person signed in or out meanwhile
          // Not signed in (401) is an answer; anything else is asked again next time.
          if (!(e instanceof ApiError && e.status === 401)) authAsked = false;
          setAuthUser(null);
        });
    }
    return () => { authListeners.delete(set); };
  }, []);

  const enter = async (path: string, body: object) => {
    const r = await api<{ token: string; user: AuthUser }>('POST', path, body);
    const saved = setToken(r.token);
    const epoch = sessionEpoch;
    await saved;
    if (epoch === sessionEpoch) setAuthUser(r.user); // not if they signed out meanwhile
  };
  return {
    user,
    reload: async () => {
      const epoch = sessionEpoch;
      const r = await api<{ user: AuthUser }>('GET', '/api/auth/me');
      if (epoch === sessionEpoch) setAuthUser(r.user); // not if they signed in or out meanwhile
    },
    signIn: (email: string, password: string) => enter('/api/auth/login', { email, password }),
    signUp: (email: string, password: string, name?: string) => enter('/api/auth/signup', { email, password, name }),
    signOut: async () => {
      if (signingOut) return;
      signingOut = true;
      const epoch = sessionEpoch;
      try {
        try { await api('POST', '/api/auth/logout'); } catch { /* the token goes either way */ }
        if (epoch === sessionEpoch) await setToken(null); // not if they signed in again meanwhile
      } finally {
        signingOut = false;
      }
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A JSON request to this app's server. Resolves with the parsed body;
 *  throws ApiError with a message fit to show the user. */
export function api<T = unknown>(method: Method, path: string, body?: unknown): Promise<T> {
  return send<T>(method, path, body === undefined ? undefined : { data: JSON.stringify(body), type: 'application/json' });
}

export type UploadedFile = { id: string; url: string; type: string; size: number };

const TYPE_BY_EXT: Record<string, string> = {
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

/** Upload a video or photo the person picked (an expo-image-picker asset, or
 *  any { uri }). Up to 45 MB: pick videos with videoMaxDuration (about 60 s)
 *  and videoQuality so they fit. Resolves with { url } to store on a record. */
export async function uploadFile(file: { uri: string; mimeType?: string | null }): Promise<UploadedFile> {
  const ext = (/\.([a-z0-9]+)(?:\?|#|$)/i.exec(file.uri)?.[1] || '').toLowerCase();
  const type = file.mimeType || TYPE_BY_EXT[ext] || '';
  let data: Blob;
  try {
    data = await (await fetch(file.uri)).blob();
  } catch {
    throw new ApiError('Could not read that file. Pick it again.', 0);
  }
  return send<UploadedFile>('POST', '/api/files', { data, type: type || data.type });
}

/** The full address of an uploaded file's url, for a player or <Image>. */
export function fileUrl(url: string): string {
  return /^https?:/.test(url) ? url : API_ORIGIN + url;
}

async function send<T>(method: Method, path: string, body?: { data: string | Blob; type: string }): Promise<T> {
  const deadline = Date.now() + WAKE_BUDGET_MS;
  const epoch = sessionEpoch;
  const token = await getToken();
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(API_ORIGIN + path, {
        method,
        headers: {
          // Asking for JSON is what makes the platform answer a sleeping
          // app with JSON too, instead of its HTML "Waking up" page.
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': body.type }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body?.data,
      });
    } catch {
      res = null;
    }

    let wait: number;
    if (res) {
      const data: any = await res.json().catch(() => null);
      if (!(data && typeof data.placeholder === 'string')) {
        // The app itself answered.
        setWaking(null);
        // Only the session this request began under: a slow 401 must not end a newer sign-in.
        if (res.status === 401 && epoch === sessionEpoch) await setToken(null);
        if (!res.ok) throw new ApiError((data && (data.error || data.message)) || `Request failed (${res.status})`, res.status);
        return data as T;
      }
      // The platform answered for the app. Only waking, deploying and
      // restarting come with retryAfter; anything else will not fix itself.
      if (!data.retryAfter) {
        setWaking(null);
        throw new ApiError(data.error || 'This app is not available right now.', res.status);
      }
      wait = data.retryAfter * 1000;
      const u = data.upsell;
      setWaking({
        message: String(data.error || 'Starting up…'),
        upsell: u && u.text && u.label && u.url ? { text: String(u.text), label: String(u.label), url: String(u.url) } : null,
      });
    } else {
      if (method !== 'GET') {
        setWaking(null);
        throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
      }
      // No answer at all (offline, or a connection that dropped): retried
      // quietly; the full-screen state is only for the platform saying so.
      wait = Math.min(1000 * 2 ** attempt, 5000);
    }
    if (Date.now() + wait > deadline) {
      setWaking(null);
      throw new ApiError('The server is taking a while to wake up. Try again in a moment.', 503);
    }
    await sleep(wait);
  }
}
