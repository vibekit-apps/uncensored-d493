// Durable JSON storage. Writes are atomic (temp file + rename), so a crash
// or a container restart mid-write can never leave a half-written file —
// the same pattern every other VibeKit starter uses. Good for up to a few
// thousand records; reach for a real database past that.
//
//   const store = require('./lib/store');
//   const items = store.read('items');            // [] if it doesn't exist yet
//   store.write('items', [...items, newItem]);    // returns what it wrote
//
// A request that is a LOOK (the agent's read-only view as the owner, lib/owner.js)
// runs inside runReadOnly: write() throws a 403 there, so nothing is saved, whatever
// the handler does, on a page load too. Reads are untouched.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const lookContext = new AsyncLocalStorage();
/** Run `fn` (and everything it awaits) with store writes refused. */
function runReadOnly(fn) {
  return lookContext.run({ readOnly: true }, fn);
}
/** True inside runReadOnly: code that saves outside this store must not save either. */
function isReadOnly() {
  return Boolean(lookContext.getStore());
}

const DATA_DIR = path.join(__dirname, 'data');
const fileFor = (name) => path.join(DATA_DIR, `${name}.json`);

// { strict: true } is for state that must never be guessed (lib/auth.js's blocks):
// a file that is there but cannot be read throws a 503 and is left in place, instead
// of reading as the fallback.
function read(name, fallback = [], { strict = false } = {}) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(name), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    if (strict) {
      console.error(`store: ${name}.json was unreadable (left in place):`, err.message);
      throw Object.assign(new Error('Unavailable for a moment: try again shortly'), { status: 503 });
    }
    // Corrupt or unreadable: quarantine it and carry on rather than
    // crash-looping the whole app over one bad file. A look moves nothing: the
    // owner's own next read quarantines it.
    if (isReadOnly()) {
      console.error(`store: ${name}.json was unreadable (left in place during a look):`, err.message);
      return fallback;
    }
    try { fs.renameSync(fileFor(name), `${fileFor(name)}.corrupt-${Date.now()}`); } catch { /* best effort */ }
    console.error(`store: ${name}.json was unreadable, quarantined it:`, err.message);
    return fallback;
  }
}

function write(name, data) {
  if (isReadOnly()) throw Object.assign(new Error('Look only: nothing is saved while the agent is looking as the owner'), { status: 403 });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Its own temp name per write, so two tasks saving the same file at once (a deploy
  // hands over between two) never write into one temp file.
  const tmp = `${fileFor(name)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, fileFor(name));
  return data;
}

module.exports = { read, write, runReadOnly, isReadOnly };
