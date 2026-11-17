/* Engine and trial flags (docs/AUDIO_ENGINE.md sections 4, 7, 8): one validator per flag, shared by bgplay.js and tests/site/flags.mjs (no DOM). A flag value is read from the URL query,
   then from localStorage `sc.flag.<name>`; a value that does not validate is dropped (never applied, never persisted, never listed as in force) and the site behaves as with no flag.
   A stored value that does not validate (an older build, a hand-typed key) is removed on read. */
const num = (min, max) => (v) => /^[0-9]+(\.[0-9]+)?$/.test(v) && +v >= min && +v <= max; /* plain decimal only: no blanks, signs, exponents, NaN */
const oneOf = (...l) => (v) => l.includes(v);
export const VALID = {
  engine: oneOf('page', 'worker'), resync: oneOf('on', 'off'), sched: oneOf('strudel', 'batch'), late: oneOf('reanchor', 'drop'), vis: oneOf('cache', 'requery', 'every'),
  hint: (v) => ['interactive', 'balanced', 'playback'].includes(v) || num(0, 10)(v), /* AudioContext latencyHint: a category or seconds */
  session: oneOf('auto', 'playback', 'transient', 'transient-solo', 'ambient', 'play-and-record'), /* navigator.audioSession.type */
  lookahead: num(0.2, 1), scrollla: oneOf('on', 'off'), poly: (v) => /^\d+$/.test(v) && +v >= 1 && +v <= 256,
};
export const isValid = (name, v) => !!VALID[name] && typeof v === 'string' && VALID[name](v);
/* the value in force: URL first, then storage; '' when none is valid */
export function readFlag(name, search, storage) {
  try { const u = new URLSearchParams(search).get(name); if (u != null && isValid(name, u)) return u; } catch (e) { /* bad query */ }
  try { const s = storage && storage.getItem('sc.flag.' + name); if (s != null) { if (isValid(name, s)) return s; storage.removeItem('sc.flag.' + name); } } catch (e) { /* private mode */ }
  return '';
}
/* ?persist=1 keeps the valid flags named in this URL; ?persist=clear removes every stored flag. Returns the names it stored. */
export function persistFlags(search, storage) {
  const stored = [];
  try { const u = new URLSearchParams(search), P = u.get('persist');
    if (P === 'clear') for (const k of Object.keys(VALID)) storage.removeItem('sc.flag.' + k);
    else if (P) for (const k of Object.keys(VALID)) { const v = u.get(k); if (v != null && isValid(k, v)) { storage.setItem('sc.flag.' + k, v); stored.push(k); } } } catch (e) { /* private mode */ }
  return stored;
}
/* removes every stored flag that does not validate (a value from an older build or typed by hand), whether or not anything reads it this session */
export function sweepFlags(storage) {
  const gone = [];
  try { for (const k of Object.keys(VALID)) { const v = storage.getItem('sc.flag.' + k); if (v != null && !isValid(k, v)) { storage.removeItem('sc.flag.' + k); gone.push(k); } } } catch (e) { /* private mode */ }
  return gone;
}
