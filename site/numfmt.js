/* Stable live-number formatting (no layout jitter). Rule: a live number never changes its decimal count and never
   drops a trailing ".0"; clocks are zero-padded with a stable minute/hour width. Width is reserved in CSS with the
   .num utility (tabular figures, monospace, right-aligned, fixed min-width in ch) - see workspace.css and docs/WORKSPACE.md.
   API (also window.strudelCraft.num): fix(v, d), cyc(v), clock(sec, {tenths}), ms(v), db(v) */
const ok = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
/* fixed decimals; "-0.0" becomes "0.0" */
export const fix = (v, d = 1) => { const s = ok(+v).toFixed(d); return /^-0(\.0+)?$/.test(s) ? s.slice(1) : s; };
export const cyc = (v) => fix(v, 1);
/* mm:ss under an hour, h:mm:ss from an hour on; tenths -> mm:ss.s. Rounds first, so 59.96 s shows 01:00 (never 0:60). */
export function clock(sec, { tenths = false } = {}) {
  const neg = ok(sec) < 0; let t = Math.abs(ok(sec));
  t = tenths ? Math.round(t * 10) / 10 : Math.round(t);
  const h = Math.floor(t / 3600), m = Math.floor((t - h * 3600) / 60), s = t - h * 3600 - m * 60;
  const ss = tenths ? s.toFixed(1).padStart(4, '0') : String(s).padStart(2, '0');
  return (neg ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + ss;
}
export const ms = (v) => fix(v, 1);
export const db = (v) => (ok(v) <= -60 ? '-inf' : (v > 0 ? '+' : '') + fix(v, 1));
/* <span class="num" style="--w:Nch"> wrapper for innerHTML templates */
export const span = (text, w, cls = '') => `<span class="num${cls ? ' ' + cls : ''}" style="--w:${w}ch">${text}</span>`;
const sc = (window.strudelCraft = window.strudelCraft || {});
sc.num = { fix, cyc, clock, ms, db, span };
