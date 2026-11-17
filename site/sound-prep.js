/* Sound preparation (#183): fetch and decode the sample files a program is about to play, from packs, before the first note is scheduled.
   Why: Strudel's sampler (superdough 1.3.0, loaded unmodified) fetches and decodes a file when its first note triggers and drops the note when the file
   is not there within the lookahead ("loading sound ... took too long"), so a cold orchestral recipe was silent for 4 to 5 s with its first notes skipped.
   What: plan(code) names, per pack-provided sound, the files the program can play (pitched maps: the file nearest each pitch the program names, default c3;
   other maps: the named :n indices, default 0), already-decoded ones are skipped. run(): for each file a fetch through window.fetch (service worker cache, counted by
   sound-load.js) and then superdough's own `getSampleBuffer(hapValue, bank)` (a public export), which hits that cache, decodes and stores the buffer in superdough's cache,
   so the later note finds it ready. A failed fetch never reaches superdough (its cache would keep the rejected promise).
   Bounds: only sounds the program names; 4 files at a time; at most 40 files; PREP_TIMEOUT ms (then the program starts with what it has); no fetching offline or
   when the browser reports save-data (Play then behaves as before: lazy and best effort); a second Play press releases a waiting Play (skip).
   State and events for the notice (no UI here): sc.soundPrep.state() and the window event 'sc:soundprep' (detail = state):
     { phase: 'idle'|'planning'|'loading'|'ready'|'timeout'|'skipped'|'offline'|'save-data'|'failed', reason, total, done, failed, bytes, ms, sounds: [names], program }
   Test switch: window.__scSoundPrep = false disables it (A/B measurements). */
const sc = (window.strudelCraft = window.strudelCraft || {});
const PREP_TIMEOUT = 10000, CONCURRENCY = 4, MAX_FILES = 40;
const state = { phase: 'idle', reason: '', total: 0, done: 0, failed: 0, bytes: 0, ms: 0, sounds: [], program: '' };
let run = null, waiters = new Set(), gen = 0;
const emit = (p) => { Object.assign(state, p); try { window.dispatchEvent(new CustomEvent('sc:soundprep', { detail: { ...state } })); } catch (e) { /* no DOM events */ } };
const NOTE = /(?<![\w#])([a-g])([#bs]?)(-?\d)(?![\w])/gi, SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const midi = (l, a, o) => SEMI[l.toLowerCase()] + ({ '#': 1, s: 1, b: -1 }[a] || 0) + (+o + 1) * 12;

/* what the program names: sound names with their :n indices, and the pitches in note("...") / n("...") strings (names or numbers) */
export function parse(code) {
  const text = String(code || ''), names = new Map(), notes = new Set(); let m;
  const sre = /(?:^|[^\w$])(?:s|sound)\s*\(\s*(["'`])([\s\S]*?)\1/g;
  while ((m = sre.exec(text))) for (const w of m[2].split(/[\s,\[\]<>*!@/~|()?]+/)) { const [n, i] = w.split(':'); if (!n || /^[\d.-]/.test(n)) continue; (names.get(n) || names.set(n, new Set()).get(n)).add(i != null && /^\d+$/.test(i) ? +i : 0); }
  const nre = /(?:^|[^\w$])(?:note|n)\s*\(\s*(["'`])([\s\S]*?)\1/g;
  while ((m = nre.exec(text))) { let k; const body = m[2]; NOTE.lastIndex = 0; while ((k = NOTE.exec(body))) notes.add(midi(k[1], k[2], k[3])); for (const w of body.split(/[\s,\[\]<>*!@/~|()?]+/)) if (/^\d+$/.test(w) && +w >= 12 && +w <= 127) notes.add(+w); }
  return { names, notes: [...notes].sort((a, b) => a - b) };
}

/* the pitches of a layer belong to its sounds: a program is cut at `$:` / `name:` lines and each part is planned alone (one part when there is no such line) */
const chunks = (code) => { const parts = String(code || '').split(/\n[ \t]*(?:_?\$|[A-Za-z_]\w*)[ \t]*:(?!:)/); return parts.length > 1 ? parts : [String(code || '')]; };

function plan(code) {
  const g = globalThis, P = sc.packs, sm = g.soundMap && g.soundMap.get && g.soundMap.get(); if (!P || !P.packSounds || !sm || !g.getSampleInfo || !g.getSampleBuffer) return [];
  const mine = P.packSounds(), out = [], seen = new Set();
  for (const part of chunks(code)) {
    const { names, notes } = parse(part);
    for (const [name, idx] of names) {
      const e = sm[name]; if (!mine.has(name) || !e || !e.data || e.data.type !== 'sample' || !e.data.samples) continue;
      const bank = e.data.samples, pitched = !Array.isArray(bank);
      for (const n of idx) for (const note of (pitched ? (notes.length ? notes : [48]) : [undefined])) {
        const hv = pitched ? { s: name, note, n } : { s: name, n };
        let info; try { info = g.getSampleInfo(hv, bank); } catch (err) { continue; }
        const url = info && info.url; if (!url) continue; const key = String(url).replace('#', '%23');
        if (seen.has(key) || (g.getCachedBuffer && g.getCachedBuffer(key))) continue; seen.add(key); out.push({ url, key, hv, bank, name });
        if (out.length >= MAX_FILES) return out;
      }
    }
  }
  return out;
}

async function load(f, r) {
  try {
    const res = await window.fetch(f.url); if (!res.ok) throw new Error('HTTP ' + res.status);
    r.bytes += +res.headers.get('content-length') || 0; await res.arrayBuffer();
    await globalThis.getSampleBuffer(f.hv, f.bank); // superdough's own fetch now hits the cache; it decodes and keeps the buffer
    r.done++;
  } catch (e) { r.failed++; }
  emit({ done: r.done, failed: r.failed, bytes: r.bytes });
}

/* prepare(code, { user }) -> Promise<state>: resolves when the files are ready, or on timeout, skip, offline, save-data; never rejects. A Play press while another is waiting releases it. */
export function prepare(code, opts = {}) {
  if (window.__scSoundPrep === false) return Promise.resolve({ ...state, phase: 'skipped', reason: 'disabled' });
  if (opts.user && waiters.size) skip('pressed again');
  const t0 = performance.now(), my = ++gen;
  const finish = (p) => { if (gen === my) emit({ ...p, ms: Math.round(performance.now() - t0) }); return { ...state }; };
  if (navigator.onLine === false) return Promise.resolve(finish({ phase: 'offline', reason: 'offline: files load from the device cache or stay silent', total: 0, done: 0, failed: 0, bytes: 0, sounds: [], program: '' }));
  if (navigator.connection && navigator.connection.saveData) return Promise.resolve(finish({ phase: 'save-data', reason: 'data saver is on: files load as notes need them', total: 0, done: 0, failed: 0, bytes: 0, sounds: [], program: '' }));
  const files = plan(code); const key = files.map((f) => f.key).join('|');
  if (!files.length) return Promise.resolve(finish({ phase: 'ready', reason: '', total: 0, done: 0, failed: 0, bytes: 0, sounds: [], program: key }));
  if (!run || run.key !== key) { // a new plan: start; the same plan already loading is joined
    const r = run = { key, done: 0, failed: 0, bytes: 0, finished: false, promise: null };
    emit({ phase: 'loading', reason: '', total: files.length, done: 0, failed: 0, bytes: 0, ms: 0, sounds: [...new Set(files.map((f) => f.name))], program: key });
    const queue = files.slice(); r.promise = Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { while (queue.length) await load(queue.shift(), r); })).then(() => { r.finished = true; });
  }
  const r = run;
  return new Promise((ok) => {
    const w = { ok: (p) => { waiters.delete(w); clearTimeout(w.t); ok(finish(p)); } }; waiters.add(w);
    w.t = setTimeout(() => w.ok({ phase: 'timeout', reason: 'sounds are still loading: starting with what is ready' }), opts.timeout || PREP_TIMEOUT);
    r.promise.then(() => w.ok({ phase: r.failed ? (r.done ? 'ready' : 'failed') : 'ready', reason: r.failed ? `${r.failed} file(s) failed` : '' }));
  });
}
export function skip(why = 'skipped') { const ws = [...waiters]; ws.forEach((w) => w.ok({ phase: 'skipped', reason: why })); return ws.length; }
/* early(code): start preparing when the program becomes valid (edit settled, recipe chosen); fire and forget, same bounds */
export function early(code) { if (!/\b(?:s|sound)\s*\(/.test(code || '')) return Promise.resolve(null); return prepare(code, { early: true }); }

sc.soundPrep = { state: () => ({ ...state }), prepare, skip, early, parse, plan };
