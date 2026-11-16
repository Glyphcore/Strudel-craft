/* Perform outputs (docs/PERFORM_PRESETS.md section 3): every pad and control in the Perform view is an "output" with a source expression. This module is
   DOM-free: find the code line a pad target reads or writes, and say in one line what a press does (and how many journal entries it makes). */
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const q = (s) => `['"\`]${esc(s)}['"\`]`;
const base = (ref) => String(ref).replace(/\(.*$/, '').replace(/@.*$/, '');

/* first code line that mentions the target; texts = [{ view, id, text }] (rack editor, then stack editor). -> { view, id, line, text, from, to } | null */
export function findSource(target, texts) {
  if (!target || !target.ref) return null; const ref = base(target.ref);
  const pats = {
    tap: [new RegExp(`(?:\\btap|\\.tap|publish|recall|wire)\\s*\\(\\s*${q(ref)}`), new RegExp(q(ref))],
    hook: [new RegExp(`bind\\s*\\(\\s*${target.slot ? q(target.slot) + '\\s*,\\s*' : ''}${q(ref)}`), new RegExp(`def\\s*\\(\\s*${q(ref)}`), new RegExp(q(ref))],
    var: [new RegExp(`(?:let|set|var)\\s*\\(\\s*${q(ref)}`), new RegExp(`\\$${esc(ref)}\\b`), new RegExp(q(ref))],
    component: [new RegExp(`inst\\s*\\(\\s*${q(ref)}`), new RegExp(q(ref))],
    selection: [new RegExp(q(ref))],
  }[target.kind] || [];
  for (const re of pats) for (const t of texts) { const lines = String(t.text || '').split('\n'); let off = 0; for (let i = 0; i < lines.length; i++) { if (re.test(lines[i])) return { view: t.view, id: t.id, line: i + 1, text: lines[i].trim(), from: off, to: off + lines[i].length }; off += lines[i].length + 1; } }
  return null;
}

/* one line: what the pad does when pressed, without jargon */
export function explainPad(pad, src, voice) {
  const t = pad.target, k = t.kind, mode = pad.mode || (k === 'tap' ? 'gate' : 'toggle');
  if (k === 'tap') return `Tap pad: one hit is 2 journal entries (tap on press, tap-end on release). ${src ? 'The code reads it at the line shown.' : voice ? `No code reads tap "${t.ref}", so a press plays the built-in ${voice} voice (audition) and is journaled; add tap("${t.ref}") to give it a reader.` : `No code reads tap "${t.ref}" yet, so a hit is recorded but nothing sounds; add tap("${t.ref}") or bounce a take to code.`}`;
  if (k === 'hook') return `Hook pad: ${mode === 'gate' ? 'holds' : 'toggles'} the "${base(t.ref)}" hook in slot "${t.slot || '?'}". ${src ? '' : 'No hooks.bind line names it, so the press only edits the journal.'}`.trim();
  if (k === 'var') return `Variable pad: ${mode === 'gate' ? 'holds' : 'toggles'} ${t.ref}${t.value != null ? ' = ' + t.value : ''}. ${src ? '' : 'No code reads this variable.'}`.trim();
  if (k === 'component') return `Component pad: opens the instance "${t.ref}" (hooks.inst).`;
  if (k === 'scene') return `Scene pad: launches scene "${t.ref}".`;
  if (k === 'selection') return `Selection pad: ${t.op || 'mutes'} the lane selection "${t.ref}".`;
  return `Action pad: runs "${t.ref}".`;
}
export const isOrphan = (pad, src) => !src && ['tap', 'hook', 'var'].includes(pad.target.kind);
/* a tap pad is read only by a bare tap("x") / wire(..., "x") call; the lane writer .tap("x") (night-phonk-demo) does not read pad presses */
export { readsTap } from './perform-audition.js';
