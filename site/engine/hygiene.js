// Hygiene racks (docs/RACK_STANDARD.md): the band scope every instrument class starts from, as chain-only hook defs.
// They are standard-library defs of the hooks runtime (site and CLI): always resolvable, never in hooks.toJSON(), and a program's own
// hooks.def("hygiene-pad", ...) replaces one. A rack names its class at the head of its chain: ["hook", "hygiene-pad"]; anything the rack
// sets after it (its own lpf, hpf, envelope) wins, so the hygiene values are the widest band the class may occupy, not its tone.
// superdough runs lpf and hpf before shape / distort / crush, so this scope is pre-drive. Checked by tools/racks/audit.mjs against
// tools/racks/standard.json. Data only.
const steep = [['ftype', '24db']]; // noise sources: 24 dB/oct, their filters are scope, not tone
const scope = (hpf, lpf, more = []) => ({ chain: [...(hpf ? [['hpf', hpf]] : []), ...(lpf ? [['lpf', lpf]] : []), ...more] });
export const HYGIENE = Object.freeze({
  'hygiene-kick': scope(30, 7000),
  'hygiene-sub': scope(25, 0),
  'hygiene-bass': scope(40, 3500),
  'hygiene-snare': scope(120, 10000, steep),
  'hygiene-hat': scope(5000, 14500, steep),
  'hygiene-perc': scope(80, 8000),
  'hygiene-bell': scope(300, 8000),
  'hygiene-pluck': scope(120, 7000),
  'hygiene-stab': scope(120, 8000),
  'hygiene-pad': scope(180, 6000),
  'hygiene-lead': scope(150, 8000),
  'hygiene-keys': scope(80, 7000),
  'hygiene-arp': scope(150, 8000),
  'hygiene-supersaw': scope(100, 9000),
  'hygiene-riser': scope(150, 12500, steep),
  'hygiene-sweep': scope(150, 12500, steep),
  'hygiene-reverse': scope(200, 12000, steep),
  'hygiene-impact': scope(25, 5000),
  'hygiene-texture': scope(200, 12500, steep),
  'hygiene-vox': scope(150, 8000),
});
export const HYGIENE_DOC = { model: 1, meta: { id: 'glyphcore/core:hygiene', doc: 'Band-scope racks per instrument class (docs/RACK_STANDARD.md). Standard-library hook defs: use as .hook("hygiene-<class>") or as the first chain step of a rack.' }, defs: HYGIENE };
