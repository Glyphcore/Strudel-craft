// CraftCues (docs/CRAFTCUES.md, schemas/craftcues.v1.json; issue #162): terse, timed score annotations in bars, scoped to the track, a section,
// layers or relations between layers, pointing to the KB by id. One pure ES module (imports only ./comments.js), no DOM, no Node API:
// the site (cues-ui.js) and the CLI (tools/craftcues/cues.mjs, suno-track-lab engine/craftcues/run.sh) share it.
//   parse(text) / print(doc)           sidecar .craftcues text <-> canonical JSON (text -> JSON -> text is exact on canonical text)
//   parseLine(line)                    one cue line `TIME [KIND] [@SCOPE] [: BODY] [| TOKENS]...` (shared by sidecar and inline //@ comments)
//   extract(code, { header })          inline //@ and /*@ */ cues of a Craft program (found with the #142 comment ranges, so never in strings)
//   lint(doc, { kb }) / merge(...docs) / toVTT(doc) / toSRT(doc) / spanOf(at, header) / activeAt(doc, bar)
import { commentRanges } from './comments.js';

export const VERSION = 1;
export const KINDS = ['section', 'layer-role', 'concept', 'motif', 'tension', 'release', 'transition', 'dovetail', 'call-response', 'clash', 'resolution',
  'density', 'feel', 'mix-note', 'todo', 'lesson', 'foreshadow', 'callback', 'note'];
export const RELS = ['resolves', 'echoes', 'prepares', 'contrasts', 'answers', 'varies'];
export const SOURCES = ['author', 'inferred', 'analysis'];
export const META_KEYS = ['conf', 'src', 'method', 'tool', 'motif', 'more', 'lane', 'line'];
export const BODY_MAX = 140;
const RANK = { author: 3, analysis: 2, inferred: 1 };
const NUM_HEAD = ['bars', 'bpm', 'beats', 'offset'];
const ID = /^[A-Za-z_][\w.-]*$/;
const EP = String.raw`(?:\d+(?:\.\d+)?s|\d+:\d{1,2}(?:\.\d+)?|\d+(?:\.\d+)?)`;
const RANGE = new RegExp(`^(${EP})(?:-(${EP}))?$`);
const err = (code, msg, extra = {}) => ({ level: 'error', code, msg, ...extra });
const warn = (code, msg, extra = {}) => ({ level: 'warn', code, msg, ...extra });
export const slug = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// ---------------------------------------------------------------- time
const isSec = (e) => /s$|:/.test(e);
const secOfEp = (e) => (/:/.test(e) ? e.split(':').reduce((a, x) => a * 60 + +x, 0) : parseFloat(e));
const normEp = (e) => (isSec(e) ? e : e.split('.').map((x) => String(+x)).join('.'));
export function normTime(t) { // canonical time text, or null when it is not a time
  t = String(t || '').trim(); if (t === '*') return '*';
  if (/^sec:[a-z0-9][\w-]*$/i.test(t)) return 'sec:' + slug(t.slice(4));
  const m = RANGE.exec(t); if (!m) return null; const a = normEp(m[1]), b = m[2] ? normEp(m[2]) : null;
  if (b && isSec(a) !== isSec(b)) return null; if (!isSec(a) && a.split('.').length > 2) return null; if (b && !isSec(b) && b.split('.').length > 2) return null;
  return b && b !== a ? `${a}-${b}` : a;
}
const barsPerSec = (h) => (h && +h.bpm > 0 ? +h.bpm / 60 / (+h.beats || 4) : 0);
/* spanOf(at, header) -> [from, to) in bar positions (bar 17 = [17, 18)); null when it cannot be placed (no bpm for seconds, unknown section) */
export function spanOf(at, h = {}) {
  const beats = +h.beats || 4; const t = normTime(at); if (!t) return null;
  if (t === '*') return [1, (+h.bars || 0) + 1 > 1 ? +h.bars + 1 : Infinity];
  if (t.startsWith('sec:')) { const s = (h.sections || []).find((x) => slug(x.name) === t.slice(4)); return s ? [s.from, s.to + 1] : null; }
  const [a, b = a] = t.split(/-(?=\d)/);
  if (isSec(a)) { const k = barsPerSec(h); if (!k) return null; const off = +h.offset || 0; return [1 + (secOfEp(a) - off) * k, 1 + (secOfEp(b) - off) * k]; }
  const ep = (e, end) => { const [bar, beat] = e.split('.').map(Number); if (beat === undefined) return end ? bar + 1 : bar; return bar + (end ? beat : beat - 1) / beats; };
  return [ep(a, false), ep(b, true)];
}
export const secOfBar = (p, h) => (+h.offset || 0) + (p - 1) / barsPerSec(h);
export function barText(p, h = {}) { const beats = +h.beats || 4; const bar = Math.floor(p + 1e-9); const beat = Math.round((p - bar) * beats) + 1; return beat === 1 ? String(bar) : `${bar}.${beat}`; }

// ---------------------------------------------------------------- one cue line
const unesc = (s) => s.replace(/\\\|/g, '|');
const splitBars = (s) => { const out = []; let cur = ''; for (let i = 0; i < s.length; i++) { if (s[i] === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; } if (s[i] === '|') { out.push(cur); cur = ''; continue; } cur += s[i]; } out.push(cur); return out; };
const tokens = (s) => { const out = []; const re = /([a-z][\w-]*)="((?:\\.|[^"\\])*)"|\S+/g; let m; while ((m = re.exec(s))) out.push(m[1] ? { k: m[1], v: m[2].replace(/\\(.)/g, '$1') } : m[0]); return out; };
export function normScope(s) {
  s = String(s || '').trim().replace(/^@/, ''); if (!s || s === 'track') return 'track';
  if (/^sec:/.test(s)) return 'sec:' + slug(s.slice(4));
  return s.replace(/\s+/g, '');
}
const SCOPE = /^@(?:track|sec:[\w-]+|(?:(?:tag:|bus:)?[A-Za-z_$][\w$.-]*)(?:(?:,|->|\+|~)(?:tag:|bus:)?[A-Za-z_$][\w$.-]*)*)$/;
/* scopeParts('bell->lead') -> { op: '->', items: [{ lane: 'bell' }, { lane: 'lead' }] } (op: null | ',' | '->' | '+' | '~'; mixed ops keep the first) */
export function scopeParts(sc) {
  sc = normScope(sc); if (sc === 'track') return { track: true, items: [] }; if (sc.startsWith('sec:')) return { section: sc.slice(4), items: [] };
  const op = (/->|\+|~|,/.exec(sc) || [null])[0]; const items = sc.split(/->|\+|~|,/).filter(Boolean).map((x) => (x.startsWith('tag:') ? { tag: x.slice(4) } : x.startsWith('bus:') ? { bus: x.slice(4) } : { lane: x }));
  return { op, items };
}
export const scopeLanes = (sc) => scopeParts(sc).items.filter((x) => x.lane).map((x) => x.lane);
/* parseLine(line) -> { cue, problems } ; cue has no id unless the tokens carry id=... */
export function parseLine(line, o = {}) {
  const problems = []; const segs = splitBars(String(line)); let head = segs.shift().trim();
  const cue = { at: null, kind: null, scope: null, body: '', refs: [], rel: [], meta: {} };
  const sugar = /^([A-Za-z]\w*)@(\S+?)\s*->\s*(?:\1)?@(\S+)(?=\s|:|$)/.exec(head);
  if (sugar) { cue.at = normTime(sugar[2]); cue.pair = normTime(sugar[3]); cue.meta.motif = sugar[1]; head = head.slice(sugar[0].length).trim(); if (!cue.at || !cue.pair) problems.push(err('E_TIME', `bad callback times in "${sugar[0]}"`)); }
  else {
    const pm = /^(\S+?)\s*=>\s*(\S+?)(?=\s|:\s|:$|$)/.exec(head); const tm = pm || /^(\S+?)(?=\s|:\s|:$|$)/.exec(head);
    const a = tm && normTime(tm[1]); if (!a) { problems.push(err('E_TIME', `a cue line starts with a time (17, 17-24, 17.3-18.1, 0:12-0:20, *, sec:name): "${head.slice(0, 40)}"`)); if (!o.lenient) return { cue: null, problems }; }
    else { cue.at = a; if (pm) { cue.pair = normTime(pm[2]); if (!cue.pair) problems.push(err('E_TIME', `bad pair time "${pm[2]}"`)); } head = head.slice(tm[0].length).trim(); }
  }
  let w = /^([a-z][\w-]*)(?=\s|:|$)/.exec(head); if (w && KINDS.includes(w[1])) { cue.kind = w[1]; head = head.slice(w[0].length).trim(); }
  w = /^(@\S+?)(?=\s|:\s|:$|$)/.exec(head); if (w) { if (!SCOPE.test(w[1])) problems.push(err('E_SCOPE', `bad scope "${w[1]}"`)); cue.scope = normScope(w[1]); head = head.slice(w[0].length).trim(); }
  w = /^([A-Za-z_$][\w$-]*(?:\s*(?:,|\+|->|~)\s*[A-Za-z_$][\w$-]*)*)\s+lanes?(?=\s*:|\s*$)/.exec(head);
  if (w && !cue.scope) { cue.scope = normScope(w[1]); head = head.slice(w[0].length).trim(); }
  if (head.startsWith(':')) head = head.slice(1).trim();
  cue.body = unesc(head);
  for (const seg of segs) for (const t of tokens(seg)) {
    if (typeof t === 'object') { cue.meta[t.k] = t.v; continue; }
    const r = /^([a-z]+):(.+)$/.exec(t); if (r && RELS.includes(r[1])) { cue.rel.push({ type: r[1], target: r[2] }); continue; }
    const kv = /^([a-z][\w-]*)=(.*)$/.exec(t); if (kv) { cue.meta[kv[1]] = kv[2]; continue; }
    cue.refs.push(t);
  }
  if ('conf' in cue.meta) { const c = +cue.meta.conf; if (!(c >= 0 && c <= 1)) problems.push(err('E_META', `conf must be 0..1, got ${cue.meta.conf}`)); else cue.meta.conf = c; }
  if (cue.meta.src && !SOURCES.includes(cue.meta.src)) problems.push(err('E_META', `src must be one of ${SOURCES.join(' | ')}`));
  if (cue.meta.id !== undefined) { cue.id = cue.meta.id; delete cue.meta.id; if (!ID.test(cue.id)) problems.push(err('E_ID', `bad id "${cue.id}" (letters, digits, _ . -; starts with a letter)`)); }
  return { cue, problems };
}
const q = (v) => { v = String(v); return /[\s|"]/.test(v) || v === '' ? `"${v.replace(/(["\\])/g, '\\$1')}"` : v; };
function tokenLine(c, withId) {
  const g = []; if (c.refs && c.refs.length) g.push(c.refs.join(' ')); if (c.rel && c.rel.length) g.push(c.rel.map((r) => `${r.type}:${r.target}`).join(' '));
  const m = Object.keys(c.meta || {}).sort().map((k) => `${k}=${q(c.meta[k])}`); if (withId && c.id) m.unshift(`id=${c.id}`); if (m.length) g.push(m.join(' '));
  return g.map((x) => '| ' + x).join(' ');
}
const timeText = (c) => (c.pair ? `${c.at} => ${c.pair}` : c.at);
/* printLine(cue) -> the one-line form used inside //@ comments (body newlines become " / ") */
export function printLine(c) { const b = String(c.body || '').replace(/\n/g, ' / ').replace(/\|/g, '\\|'); const t = tokenLine(c, true); return `${timeText(c)} ${c.kind} @${c.scope}${b ? ': ' + b : ''}${t ? ' ' + t : ''}`; }

// ---------------------------------------------------------------- sidecar document
function parseHeaderValue(k, v) {
  if (NUM_HEAD.includes(k)) return +v;
  if (k === 'sections') return v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => { const m = /^(.+?)\s+(\d+)-(\d+)$/.exec(s) || /^(.+?)\s+(\d+)$/.exec(s); return m ? { name: slug(m[1]), from: +m[2], to: +(m[3] || m[2]) } : { name: slug(s), from: NaN, to: NaN }; });
  return v;
}
const printHeaderValue = (k, v) => (k === 'sections' ? v.map((s) => `${s.name} ${s.from === s.to ? s.from : s.from + '-' + s.to}`).join(', ') : String(v));
export function parse(text, o = {}) {
  const lines = String(text ?? '').replace(/^\uFEFF/, '').split(/\r\n|\r|\n/); const problems = []; const doc = { format: 'craftcues@1', header: {}, notes: [], cues: [] };
  let i = 0; if (!/^CRAFTCUES(?:\s+1)?(?:\s.*)?$/.test(lines[0] || '')) problems.push(err('E_MAGIC', 'the first line is "CRAFTCUES 1"', { line: 1 })); else i = 1;
  for (; i < lines.length && lines[i].trim() !== ''; i++) { const m = /^([a-z][\w-]*)\s*:\s*(.*)$/.exec(lines[i]); if (!m) { problems.push(err('E_HEADER', `header lines are "key: value": "${lines[i].slice(0, 40)}"`, { line: i + 1 })); continue; } doc.header[m[1]] = parseHeaderValue(m[1], m[2].trim()); }
  let n = 0;
  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++; if (i >= lines.length) break;
    const block = []; const start = i; while (i < lines.length && lines[i].trim() !== '') block.push(lines[i++]);
    if (/^NOTE(\s|$)/.test(block[0])) { doc.notes.push(block.join('\n').replace(/^NOTE\s?/, '')); continue; }
    let id = null; let k = 0; if (ID.test(block[0].trim()) && !normTime(block[0].trim()) && block.length > 1) { id = block[0].trim(); k = 1; }
    const tl = [block[k]]; const body = [];
    for (let j = k + 1; j < block.length; j++) { const l = block[j]; if (/^\s*\|/.test(l)) tl.push(l.trim()); else body.push(l.replace(/^\\\|/, '|')); }
    const { cue, problems: pr } = parseLine(tl.join(' '), o); for (const p of pr) problems.push({ ...p, line: start + k + 1 });
    if (!cue) continue; n++;
    if (body.length) cue.body = cue.body ? cue.body + '\n' + body.join('\n') : body.join('\n');
    if (id) { if (cue.id && cue.id !== id) problems.push(warn('W_ID', `id line "${id}" and id=${cue.id} differ; the id line wins`, { line: start + 1 })); cue.id = id; }
    doc.cues.push(finish(cue, doc.header, o.defaultSrc, n, start + 1));
  }
  return { doc, problems };
}
/* canonical body: no blank lines (a blank line ends a sidecar block), no trailing spaces, trimmed */
const normBody = (b) => String(b || '').split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim()).join('\n').trim();
function finish(c, h, src, n, line) {
  if (!c.kind) c.kind = c.scope && c.scope !== 'track' && !c.scope.startsWith('sec:') ? 'layer-role' : 'note';
  if (!c.scope) c.scope = 'track'; if (!c.id) c.id = `c${n}`; if (src && !c.meta.src) c.meta.src = src;
  const out = { id: c.id, at: c.at, ...(c.pair ? { pair: c.pair } : {}), kind: c.kind, scope: c.scope, body: normBody(c.body), refs: c.refs || [], rel: c.rel || [], meta: Object.fromEntries(Object.keys(c.meta || {}).sort().map((k) => [k, c.meta[k]])) };
  Object.defineProperty(out, '_line', { value: line, enumerable: false, writable: true });
  return out;
}
export function print(doc) {
  const h = doc.header || {}; const out = ['CRAFTCUES 1'];
  for (const k of Object.keys(h)) if (h[k] !== undefined && h[k] !== null && h[k] !== '') out.push(`${k}: ${printHeaderValue(k, h[k])}`);
  for (const nt of doc.notes || []) out.push('', 'NOTE ' + nt);
  for (const c of doc.cues || []) {
    out.push('', c.id, `${timeText(c)} ${c.kind} @${c.scope}`);
    if (c.body) for (const l of String(c.body).split('\n')) out.push(/^\s*\|/.test(l) ? '\\' + l.replace(/^\s*/, '') : l);
    const t = tokenLine({ ...c, id: null }, false); if (t) out.push(t);
  }
  return out.join('\n') + '\n';
}
/* canonical JSON: plain data with the derived span (null when it cannot be placed) */
export function toJSON(doc) {
  return { format: 'craftcues@1', header: { ...doc.header }, notes: [...(doc.notes || [])], cues: (doc.cues || []).map((c) => ({ ...c, span: fin(spanOf(c.at, doc.header)), ...(c.pair ? { pspan: fin(spanOf(c.pair, doc.header)) } : {}) })) };
}
const fin = (s) => (s && s.every(Number.isFinite) ? s.map((x) => Math.round(x * 1e6) / 1e6) : s ? [s[0], null] : null);
export function fromJSON(j) { const doc = { format: 'craftcues@1', header: { ...(j.header || {}) }, notes: [...(j.notes || [])], cues: [] }; (j.cues || []).forEach((c, i) => { const { span, pspan, ...rest } = c; doc.cues.push(finish({ refs: [], rel: [], meta: {}, ...rest }, doc.header, null, i + 1, c.line)); }); return doc; }

// ---------------------------------------------------------------- inline //@ cues in a Craft program
const lineStarts = (s) => { const a = [0]; for (let i = 0; i < s.length; i++) if (s[i] === '\n') a.push(i + 1); return a; };
const lineOf = (starts, off) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
/* header facts a program states: // @daw bars=N, setcpm(X / 4) or setcps(x), a section map comment "intro 1-8 | build 9-16 | ...", //@! key: value lines */
export function programHeader(code) {
  const src = String(code ?? ''); const h = {};
  const daw = /\/\/\s*@daw\b([^\n]*)/.exec(src); if (daw) for (const m of daw[1].matchAll(/(\w+)=(\S+)/g)) if (NUM_HEAD.includes(m[1])) h[m[1]] = +m[2];
  const cpm = /\bsetcpm\s*\(\s*([\d.]+)\s*(?:\/\s*([\d.]+))?\s*\)/.exec(src); if (cpm) { h.bpm = +cpm[1]; h.beats = +(cpm[2] || 1) > 1 ? +cpm[2] : 4; if (!cpm[2]) h.bpm = +cpm[1] * 4; }
  const cps = /\bsetcps\s*\(\s*([\d.]+)\s*\)/.exec(src); if (!cpm && cps) { h.beats = 4; h.bpm = +cps[1] * 60 * 4; }
  const bars = /\b(\d{1,4})\s+bars\b/.exec(src.slice(0, 2000)); if (!h.bars && bars) h.bars = +bars[1];
  for (const m of src.matchAll(/^[ \t]*\/\/(?!@)[^\n]*\|[^\n]*$/gm)) { const parts = m[0].replace(/^[ \t]*\/\/\s*/, '').split('|').map((x) => x.trim()); const secs = parts.map((p) => /^(.*?)\s*(\d+)-(\d+)$/.exec(p)).filter(Boolean); if (secs.length >= 2 && secs.length === parts.length) { h.sections = secs.map((s) => ({ name: slug(s[1].replace(/.*>/, '')) || 's' + s[2], from: +s[2], to: +s[3] })); break; } }
  for (const m of src.matchAll(/^[ \t]*\/\/@!\s*([a-z][\w-]*)\s*:\s*(.*)$/gm)) h[m[1]] = parseHeaderValue(m[1], m[2].trim());
  if (!h.bars && h.sections && h.sections.length) h.bars = Math.max(...h.sections.map((s) => s.to));
  return h;
}
/* arrange([N, pat], [M, pat]...) segments -> [{ from, to (offsets), a, b (bars) }] */
function arrangeSegments(src) {
  const out = [];
  for (const m of src.matchAll(/\barrange\s*\(/g)) {
    let i = m.index + m[0].length, depth = 0, bar = 1, segStart = -1, str = null;
    for (; i < src.length; i++) {
      const c = src[i]; if (str) { if (c === '\\') i++; else if (c === str) str = null; continue; } if (c === '"' || c === "'" || c === '`') { str = c; continue; }
      if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1 && c === '[') segStart = i; continue; }
      if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; if (depth === 1 && c === ']' && segStart >= 0) { const n = /^\[\s*([\d.]+)/.exec(src.slice(segStart, i)); if (n) { const len = +n[1]; out.push({ from: segStart, to: i + 1, a: bar, b: bar + len - 1 }); bar += len; } segStart = -1; } depth--; }
    }
  }
  return out;
}
export function extract(code, o = {}) {
  const raw = String(code ?? ''); const header = { ...programHeader(raw), ...(o.header || {}) }; const problems = []; const cues = [];
  const starts = lineStarts(raw); const rs = commentRanges(raw); const lines = raw.split('\n');
  const codeLine = (ln) => { // the code of line ln with comments removed
    const a = starts[ln - 1], b = ln < starts.length ? starts[ln] - 1 : raw.length; let s = ''; let k = a;
    for (const [x, y] of rs) { if (y <= a || x >= b) continue; s += raw.slice(k, Math.max(k, x)); k = Math.max(k, y); } s += raw.slice(k, b); return s;
  };
  const laneOn = (ln) => { const m = /^\s*([A-Za-z_$][\w$]*)\s*:(?!:)\s*\S/.exec(codeLine(ln)); return m && !/^(https?|sec|case|default)$/.test(m[1]) ? m[1] : null; };
  const laneFor = (ln, alone) => {
    const same = laneOn(ln); if (same && !alone) return same;
    for (let k = ln + 1; k <= lines.length; k++) { const c = codeLine(k).trim(); if (!c) { if (!lines[k - 1].trim()) break; continue; } return laneOn(k); }
    return null;
  };
  const markers = []; for (const [a, b] of rs) { const t = raw.slice(a, b); const m = /^\/\/\s*==+\s*(.*?)\s+(\d+)-(\d+)\s*(?:==+.*)?$/.exec(t); if (m) markers.push({ line: lineOf(starts, a), a: +m[2], b: +m[3] }); }
  const segs = arrangeSegments(raw.replace(/\/\/[^\n]*/g, (x) => ' '.repeat(x.length)));
  let n = 0;
  for (const [a, b] of rs) {
    const t = raw.slice(a, b); let bodies;
    if (/^\/\/@(?!!)/.test(t)) bodies = [[t.slice(3), a]];
    else if (/^\/\*@/.test(t)) { bodies = []; let off = a + 3; for (const l of t.slice(3).replace(/\*\/$/, '').split('\n')) { const s = l.replace(/^\s*\*?\s?/, ''); if (s.trim()) bodies.push([s, off]); off += l.length + 1; } }
    else continue;
    for (const [body, off] of bodies) {
      const ln = lineOf(starts, off); const alone = !codeLine(ln).trim(); let text = body.trim(); if (!text) continue;
      let def = null; const seg = segs.find((s) => off >= s.from && off < s.to); if (seg) def = seg.a === seg.b ? String(seg.a) : `${seg.a}-${seg.b}`;
      else { const mk = markers.filter((m) => m.line <= ln).pop(); if (mk) def = `${mk.a}-${mk.b}`; }
      if (!normTime(text.split(/[\s:]/)[0]) && !/^[A-Za-z]\w*@\d/.test(text)) text = (def || '*') + ' ' + text;
      const { cue, problems: pr } = parseLine(text); for (const p of pr) problems.push({ ...p, line: ln });
      if (!cue) continue; n++;
      if (!cue.scope) { const lane = laneFor(ln, alone); if (lane) cue.scope = lane; }
      if (!cue.meta.src) cue.meta.src = 'author';
      const c = finish(cue, header, null, n, ln); if (/^c\d+$/.test(c.id)) c.id = `L${ln}`; c._line = ln; cues.push(c);
    }
  }
  return { doc: { format: 'craftcues@1', header, notes: [], cues }, problems };
}
/* lineOfCue(doc, id): the program line an inline cue came from (for "Go to code"), or null */
export const lineOfCue = (doc, id) => { const c = (doc.cues || []).find((x) => x.id === id); return c && c._line ? c._line : null; };

// ---------------------------------------------------------------- merge, lint, query
const key = (c) => [c.kind, c.scope, c.at, c.pair || '', c.body].join('\u0001');
export function hashId(prefix, s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return `${prefix}-${h.toString(16).padStart(8, '0')}`; }
/* merge(a, b, ...) -> one doc: by id (author > analysis > inferred, ties keep the first), exact duplicates dropped, header keys filled left to right */
export function merge(...docs) {
  const out = { format: 'craftcues@1', header: {}, notes: [], cues: [] }; const byId = new Map(); const seen = new Map();
  for (const d of docs.filter(Boolean)) {
    for (const [k, v] of Object.entries(d.header || {})) if (out.header[k] === undefined) out.header[k] = v;
    for (const nt of d.notes || []) if (!out.notes.includes(nt)) out.notes.push(nt);
    for (const c of d.cues || []) {
      const r = RANK[c.meta && c.meta.src] || RANK.author; const prev = byId.get(c.id);
      if (prev) { if (r > (RANK[prev.meta && prev.meta.src] || RANK.author)) { out.cues[out.cues.indexOf(prev)] = c; byId.set(c.id, c); seen.set(key(c), c); } continue; }
      const dup = seen.get(key(c)); if (dup) continue;
      out.cues.push(c); byId.set(c.id, c); seen.set(key(c), c);
    }
  }
  return out;
}
const overlaps = (a, b) => a && b && a[0] < b[1] && b[0] < a[1];
const CONFLICT = [['tension', 'release'], ['clash', 'resolution']];
/* lint(doc, { kb, problems }) -> diagnostics [{ level, code, msg, id?, line? }] (parse problems passed in are included) */
export function lint(doc, o = {}) {
  const out = [...(o.problems || [])]; const h = doc.header || {}; const ids = new Map(); const sp = new Map();
  const at = (c) => ({ id: c.id, ...(c._line ? { line: c._line } : {}) });
  for (const c of doc.cues || []) {
    if (ids.has(c.id)) out.push(err('E_DUP_ID', `duplicate id ${c.id}`, at(c))); ids.set(c.id, c);
    if (!KINDS.includes(c.kind)) out.push(err('E_KIND', `unknown kind "${c.kind}" (${KINDS.join(', ')})`, at(c)));
    const s = spanOf(c.at, h); sp.set(c, s);
    if (!s) out.push(warn('W_UNPLACED', `cannot place "${c.at}" (seconds need bpm; sec:name needs sections)`, at(c)));
    else if (!(s[0] < s[1])) out.push(err('E_TIME', `empty or reversed span "${c.at}"`, at(c)));
    const beats = +h.beats || 4; for (const t of [c.at, c.pair].filter(Boolean)) for (const m of String(t).matchAll(/(?:^|-)\d+\.(\d+)(?=$|-)/g)) if (+m[1] < 1 || +m[1] > beats) out.push(err('E_TIME', `beat ${m[1]} outside 1..${beats} in "${t}"`, at(c)));
    const bars = +h.bars; for (const [t, ss] of [[c.at, s], [c.pair, c.pair && spanOf(c.pair, h)]]) if (t && ss && bars && Number.isFinite(ss[1]) && (ss[0] < 1 || ss[1] > bars + 1 + 1e-9)) out.push(warn('W_OUTSIDE', `"${t}" is outside the track (1-${bars})`, at(c)));
    if (String(c.body || '').length > BODY_MAX) out.push(warn('W_LONG', `body is ${String(c.body).length} chars (terse limit ${BODY_MAX}); move detail to a KB card or more=URL`, at(c)));
    if (c.scope.startsWith('sec:') && h.sections && !h.sections.some((x) => slug(x.name) === c.scope.slice(4))) out.push(warn('W_SECTION', `unknown section ${c.scope}`, at(c)));
    if (o.lanes) for (const l of scopeLanes(c.scope)) if (!o.lanes.includes(l)) out.push(warn('W_LANE', `scope names lane "${l}", not in the program`, at(c)));
    if (o.kb) for (const r of c.refs || []) { const card = o.kb(r); if (!card || card.status === 'unknown') out.push(warn('W_KB', `unknown KB id ${r}`, at(c))); }
  }
  for (const c of doc.cues || []) for (const r of c.rel || []) { const t = ids.get(r.target); if (!t) out.push(err('E_ORPHAN', `${r.type}:${r.target} points at no cue`, at(c))); else if (r.type === 'resolves' || r.type === 'answers') { const a = sp.get(c), b = sp.get(t); if (a && b && b[0] > a[0]) out.push(warn('W_REL_ORDER', `${c.id} ${r.type} ${t.id}, which starts later`, at(c))); } }
  const cs = doc.cues || [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j]; if (!overlaps(sp.get(a), sp.get(b))) continue;
    if (a.kind === 'section' && b.kind === 'section' && a.scope === b.scope) out.push(warn('W_OVERLAP', `sections ${a.id} and ${b.id} overlap`, at(b)));
    for (const [x, y] of CONFLICT) if (a.scope === b.scope && ((a.kind === x && b.kind === y) || (a.kind === y && b.kind === x))) out.push(warn('W_CONFLICT', `${a.kind} ${a.id} and ${b.kind} ${b.id} overlap on @${a.scope}`, at(b)));
  }
  return out;
}
/* activeAt(doc, bar) -> cues whose span (or pair span) holds bar position p (1-based, fractional) */
export function activeAt(doc, p) { const h = doc.header || {}; return (doc.cues || []).filter((c) => { const s = spanOf(c.at, h); const t = c.pair && spanOf(c.pair, h); return (s && p >= s[0] && p < s[1]) || (t && p >= t[0] && p < t[1]); }); }

// ---------------------------------------------------------------- captions: WebVTT and SRT
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ts = (s, comma) => { s = Math.max(0, s); const ms = Math.round(s * 1000); const H = Math.floor(ms / 3600000), M = Math.floor(ms / 60000) % 60, S = Math.floor(ms / 1000) % 60, f = ms % 1000; const p = (x, n = 2) => String(x).padStart(n, '0'); return `${p(H)}:${p(M)}:${p(S)}${comma ? ',' : '.'}${p(f, 3)}`; };
export function captionText(c, { html = true, refs = true } = {}) {
  const e = html ? esc : (x) => x; let b = e(String(c.body || '').replace(/\n/g, ' ')); b = html ? b.replace(/\*([^*\n]+)\*/g, '<b>$1</b>') : b.replace(/\*([^*\n]+)\*/g, '$1');
  const sc = c.scope === 'track' ? '' : ' @' + c.scope; const r = refs && c.refs && c.refs.length ? ` (${e(c.refs.join(', '))})` : '';
  return `[${c.kind}${e(sc)}] ${b}${r}`.replace(/-->/g, '->');
}
function timed(doc, o) {
  const h = doc.header || {}; if (!barsPerSec(h)) throw Object.assign(new Error('E_NO_BPM: captions need bpm in the header'), { code: 'E_NO_BPM' });
  const end = +h.bars ? secOfBar(+h.bars + 1, h) : Infinity; const items = []; const whole = [];
  for (const c of doc.cues || []) {
    if (c.kind === 'todo' && !o.todo) continue;
    if (c.at === '*' && !o.all) { whole.push(c); continue; }
    const add = (t, id, pre) => { const s = spanOf(t, h); if (!s || !Number.isFinite(s[1])) return; items.push({ id, a: secOfBar(s[0], h), b: Math.min(end, secOfBar(s[1], h)), text: pre + captionText(c, o) }); };
    add(c.at, c.id, ''); if (c.pair) add(c.pair, c.id + '.2', o.html === false ? '-> ' : '&#8594; ');
  }
  items.sort((x, y) => x.a - y.a || y.b - x.b); /* WebVTT text track cue order: start time, then the later end first */ return { items: items.filter((x) => x.b > x.a), whole };
}
export function toVTT(doc, o = {}) {
  const { items, whole } = timed(doc, { html: true, ...o }); const h = doc.header || {};
  const out = ['WEBVTT' + (h.track ? ' - ' + String(h.track).replace(/-->/g, '') : ''), ''];
  out.push(`NOTE CraftCues ${VERSION}: bars at ${h.bpm} bpm, ${h.beats || 4} beats per bar, bar 1 at ${+h.offset || 0} s` + (whole.length ? '\n' + whole.map((c) => captionText(c, { html: false })).join('\n').replace(/-->/g, '->') : ''), '');
  for (const x of items) out.push(x.id, `${ts(x.a)} --> ${ts(x.b)}`, x.text, '');
  return out.join('\n');
}
export function toSRT(doc, o = {}) { const { items } = timed(doc, { html: false, ...o }); return items.map((x, i) => `${i + 1}\n${ts(x.a, true)} --> ${ts(x.b, true)}\n${x.text.replace(/<[^>]+>/g, '')}\n`).join('\n'); }
/* fromVTT(text, header): captions back into cues (kind / scope / refs from the "[kind @scope] body (refs)" payload, times in seconds) */
export function fromVTT(text, header = {}) {
  const doc = { format: 'craftcues@1', header: { ...header }, notes: [], cues: [] }; const blocks = String(text).replace(/\r/g, '').split(/\n\n+/); let n = 0;
  for (const b of blocks) { const ls = b.split('\n'); const ti = ls.findIndex((l) => /-->/.test(l)); if (ti < 0) continue; const m = /([\d:.]+)\s+-->\s+([\d:.]+)/.exec(ls[ti]); if (!m) continue;
    const sec = (t) => t.split(':').reduce((a, x) => a * 60 + +x, 0); const fmt = (s) => { const x = Math.round(s * 1000) / 1000; return `${x}s`; };
    const pay = ls.slice(ti + 1).join(' ').replace(/<\/?b>/g, '*').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const pm = /^(?:&#8594;\s*|\u2192\s*|->\s*)?\[([\w-]+)(?:\s+@(\S+))?\]\s*(.*?)(?:\s+\(([^)]*)\))?$/.exec(pay.trim()); n++;
    doc.cues.push(finish({ id: ti > 0 && ID.test(ls[0]) ? ls[0] : `v${n}`, at: `${fmt(sec(m[1]))}-${fmt(sec(m[2]))}`, kind: pm && KINDS.includes(pm[1]) ? pm[1] : 'note', scope: pm && pm[2] ? normScope(pm[2]) : 'track', body: pm ? pm[3] : pay, refs: pm && pm[4] ? pm[4].split(/,\s*/) : [], rel: [], meta: {} }, doc.header, null, n)); }
  return doc;
}

// ---------------------------------------------------------------- form bank records -> cues (docs/FORM_BANK.md; provenance carried)
const BANK_SRC = { 'inferred-from-project-data': 'inferred', 'pieced-together': 'inferred', 'analysed-from-audio': 'analysis', 'project-rendered-then-analysed': 'analysis' };
/* fromBank(records, { match }) -> doc: one section cue per record (picked.bars, labels.form_role), refs [record id, form:<role>], meta src / method / conf */
export function fromBank(records, o = {}) {
  const cues = []; let n = 0;
  for (const r of records || []) {
    if (!r || !r.picked || !Array.isArray(r.picked.bars) || (o.match && !o.match(r))) continue; const [a, b] = r.picked.bars; const role = (r.labels && r.labels.form_role) || 'other'; n++;
    const meta = { src: BANK_SRC[r.method] || 'inferred', method: String(r.method || 'bank'), tool: 'form-bank' }; if (Number.isFinite(+r.confidence)) meta.conf = Math.round(+r.confidence * 100) / 100;
    cues.push(finish({ id: 'g-bank-' + String(r.id || n).replace(/^fb-/, ''), at: normTime(a === b ? String(a) : `${a}-${b}`), kind: r.picked.stage === 'tension' ? 'tension' : 'section', scope: 'track',
      body: (role + (r.evidence && r.evidence.length ? ': ' + r.evidence.slice(0, 2).join('; ') : '')).slice(0, BODY_MAX), refs: [r.id, 'form:' + role].filter((x) => x && /^(fb-[0-9a-f]{16}|form:[\w-]+)$/.test(x)), rel: [], meta }, {}, null, n));
  }
  return { format: 'craftcues@1', header: { ...(o.header || {}) }, notes: [], cues };
}

// ---------------------------------------------------------------- editor completion inside //@ comments (site intellisense source, CLI `complete`)
/* completeCue(before, { ids, lanes }) -> { from (offset into before), options: [{ label, detail }] } | null; before = the line text up to the caret */
export function completeCue(before, o = {}) {
  const m = /\/\/@\s?(.*)$/.exec(before); if (!m) return null; const rest = m[1]; const start = before.length - rest.length;
  const w = /[^\s|]*$/.exec(rest)[0]; const from = before.length - w.length; const head = rest.slice(0, rest.length - w.length);
  const opt = (label, detail) => ({ label, detail });
  if (/\|/.test(head)) { const ids = o.ids || []; return { from, options: [...ids.map((x) => opt(x.id || x, x.title || 'KB')), ...RELS.map((r) => opt(r + ':', 'relation to a cue id')), ...META_KEYS.map((k) => opt(k + '=', 'meta'))].filter((x) => x.label.toLowerCase().startsWith(w.toLowerCase())) }; }
  const words = head.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { from, options: [opt('17-24', 'bars (inclusive)'), opt('17.3-18.1', 'bar.beat'), opt('*', 'whole track'), opt('M9@17 -> M9@49', 'callback pair')].filter((x) => x.label.startsWith(w)) };
  if (w.startsWith('@')) return { from, options: ['@track', ...(o.sections || []).map((s) => '@sec:' + s), ...(o.lanes || []).map((l) => '@' + l)].filter((x) => x.startsWith(w)).map((x) => opt(x, 'scope')) };
  if (words.length === 1 || (words.length === 3 && words[1] === '=>')) return { from, options: KINDS.filter((k) => k.startsWith(w)).map((k) => opt(k, 'cue kind')) };
  void start; return null;
}
