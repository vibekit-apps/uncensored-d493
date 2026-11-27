# Template: Native app (Expo)

A real phone app, written in React Native with Expo. The user runs it on their
own phone in the free **Expo Go** app, and the same code is also a website at
this app's address. It is a working app to build ON, not a placeholder.

## What's already built and wired (do NOT rebuild it)

```
app/_layout.tsx   the app's frame (Expo Router: every file in app/ is a screen)
app/(tabs)/_layout.tsx  the tab bar (Home, Settings, Account): rename a tab by its `title`, add or drop one by its file
app/(tabs)/index.tsx    the first tab, a demo ("My App" list): replace it with the user's app; keep its api() load/save/error pattern
app/(tabs)/settings.tsx  the second tab (app facts): rename, replace or delete it
app/(tabs)/account.tsx   the third tab: who is signed in, and their profile (photo, name, bio) through /api/profile
app/login.tsx     sign in / create account on the /api/auth/* routes, through useAuth() in lib/api.ts
lib/theme.ts      the colors, light and dark (useTheme()): put the user's palette here and nowhere else
components/ui.tsx Screen, Card, Row, Field, Button, PhotoField: build screens from these so the look stays one
components/WakingScreen.tsx  what the app shows while its server wakes up (see below)
lib/api.ts        how every screen talks to the server (use it, never bare fetch)
server.js         the app's server: your JSON API, the phone updates, the website. Its `/api/items` is demo data every user shares, with no sign-in: replace it
lib/store.js      durable JSON storage for the server, atomic writes
lib/auth.js       accounts for the app's users: sign up, log in, session tokens (app/login.tsx is its screen)
lib/profile.js    a signed-in user's own profile: name, bio, a small square photo (GET/POST /api/profile)
lib/owner.js      the owner's sign-in through VibeKit, and ownerOnly() in server.js (no password to invent)
lib/files.js      videos and photos as files up to 45 MB: POST /api/files, played back from /api/files/<id>
lib/shrink-photo.ts  shrinkPhoto(uri): a photo small enough to upload (expo-image-picker and expo-image-manipulator are installed)
app.json          the app's name, icon and settings
package.json      dependencies and the platform's build marker (do not remove it)
```

Import your own code as `@/components/ui` and `@/lib/api` (tsconfig.json `paths`), never `../../components/ui`: a screen in a nested folder cannot miscount the dots.

## How this app gets to the phone

- **You never build or run it here.** Never run `expo start`, `expo run`,
  `npm install`, `npx expo install` or `expo export` in this workspace. There
  are no `node_modules` here on purpose. The platform installs and builds on
  **Deploy** (about a minute), then the phone picks up the new version.
- **Every turn that changes the app publishes itself.** Right after your reply
  the platform deploys what you changed (the first build and every edit after
  it), unless the owner asked to hold. Follow AGENTS.md and the current
  `[Live-state:]`; once it is live it tells them to close and reopen the app in Expo
  Go. So end with what you changed, and never tell them to tap Deploy or to
  wait for "the next deploy". Deploy yourself only when they ask.
- **The platform hands them the phone link.** Its first-build message carries
  it (a page that opens the free Expo Go app, or helps install it), so don't
  repeat it in your reply; if they ask later, it is in AGENTS.md.
- **What you can verify:** the website (a screenshot of this app's address
  shows the same screens). You cannot see the phone; the user checks it in
  Expo Go.

## Platform contracts (do not change)

- `package.json` `"vibekit": {"build": "expo"}` and the `build` script. They
  are how the platform knows to build this as a phone app.
- `server.js`'s `/.vibekit/expo/*` handling, `currentRelease()` and `/health`.
  Expo Go loads the app from there; `/health` is how the platform knows the
  server is up.
- `lib/api.ts`'s `Accept: application/json` header and its waking retry, and
  the waking screen in `app/_layout.tsx` (`components/WakingScreen.tsx`). When
  nobody has used the app for a while its server sleeps, and waking takes up
  to a minute; `api()` waits that out while the frame covers every screen with
  the platform's waking message, then removes it the moment the server
  answers. Screens need nothing for it. Restyle `WakingScreen` to match the
  app if you like, but keep what it shows. Bare `fetch` would fail instead.
- `dist/` belongs to the platform (each build lands in `dist/releases/`).
  Never write into it.

## Adding a package

Only packages that run in Expo Go work, and the lockfile must match, so never
edit `package.json` dependencies by hand. Ask the platform to add one (see
TOOLS.md). A hand edit fails the next Deploy with "use the deps action".

## Where things go

| Adding | Put it in |
|---|---|
| A screen | a new file in `app/` (`app/detail.tsx` is `/detail`); a new tab is a file in `app/(tabs)/` plus a `Tabs.Screen` in its `_layout.tsx` |
| Colors and look | `lib/theme.ts` (light and dark); a palette the user names or sends replaces its values, and screens read them through `useTheme()`, never a hex in a screen |
| Talking to the server | `api()` from `lib/api.ts` |
| An API endpoint | the `routes` table in `server.js` |
| Saved data | `lib/store.js` via `store.read` / `store.write`, in `server.js` |
| What visitors leave for the owner (bookings, orders, messages, names, phones, emails) | a route wrapped in `ownerOnly` in `server.js`. The owner signs in in the web version (`/api/owner/me`, then a link to `/api/owner/start`); Expo Go cannot keep that sign-in, so on the phone an owner screen opens `API_ORIGIN + '/api/owner/start'` in the browser (`Linking.openURL`). Never a password or PIN you invent |
| A video (or a large photo) people pick or record | `expo-image-picker` (`mediaTypes: ['videos']`, `videoMaxDuration: 60`, `videoQuality`), then `uploadFile(asset)` from `lib/api.ts`; keep the returned `url` on the record and play it with `expo-video` (`useVideoPlayer(fileUrl(url))`). Never base64 a video into JSON. Anyone with the link can play a file, so keep who may see it on the record's route |
| A photo | `PhotoField` from `components/ui.tsx` (picks, shrinks, shows it; `camera` to take one), then send `photo.dataUrl` in JSON (or `uploadFile` it); `shrinkPhoto` from `lib/shrink-photo.ts` for a picker of your own |
| Accounts | the `/api/auth/*` routes (there) and `auth.userFor(req)`. `useAuth()` (lib/api.ts) and `app/login.tsx` are built: open it with `router.push('/login')` only if the app needs people's own data; then key each record by `user.id` and answer 401 without it, on every private route. A signed-in user already has a real profile (name, bio, photo, edited on the Account tab): extend it, never build a second or fake one |
| A way back | the header is off (`headerShown: false`): a `Pressable` with `router.back()` (`useRouter` from `expo-router`); `router.push('/detail')` to go on |
| A secret or API key | `process.env` in `server.js` only, saved through the request call (TOOLS.md §Environment); screens ship inside the app. Never a `.env` or any other new dotfile at the app's root: each one makes every build export from scratch |
| AI (a chat, a coach, a writer) | a `server.js` route that calls the built-in model (TOOLS.md §Runtime AI); screens call that route |
| An icon | `@expo/vector-icons`, one set per import: `import Ionicons from '@expo/vector-icons/Ionicons'` |
| Something to tap | a `Pressable` with `accessibilityRole="button"` (or `"link"`), plus `accessibilityLabel` when it shows only an icon. Without a role it is a plain box to VoiceOver and to the platform's page checks, which then find nothing to tap |
| The app's name and icon | `app.json` (`expo.name`, `expo.icon`) |

`lib/*.js` files run on the server (Node); `.ts`/`.tsx` files run on the phone
and in the browser. Never import a server file from a screen.

## Before you finish

- **The build is the only compiler.** One syntax error fails the whole publish and nothing new goes live. Close every tag and fragment, make every import point at a file that exists, and split a screen past ~150 lines into `components/` files so you can re-read your own JSX.
- **A phone can keep running the previous version** until the user closes and reopens Expo Go. Change the API by adding fields and routes; never rename or remove one the screens already call.
- **Expo Go limits:** photos, videos up to 45 MB, foreground location and reminders the app schedules itself work. Server push, background location and sign-in redirects need the App Store build (the owner signs in in the web version instead): say so in one line when asked, don't promise them. A live stream is not something this app can host.
- **Asked about the App Store:** it is TestFlight under the owner's own Apple Developer and Expo accounts, with the steps from `ios-ship/status` (TOOLS.md §App Store); say that in a line, never promise an approval or a date, and never ask for a key in chat.
