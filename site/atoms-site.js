// Site wiring for atoms (docs/ATOMS.md; #62): loads the type registry and argument positions, and exposes the toolkit as window.strudelCraft.atoms.
// "Open in strudel.cc" and "Copy" call atoms.inline(code) first (app.js `plain`), because `atoms` does not exist outside this toolkit.
import * as A from './engine/atoms.js';
import * as M from './engine/atoms-migrate.js';

const json = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(u + ' ' + r.status))));
const sc = (window.strudelCraft = window.strudelCraft || {});
sc.atoms = { ...A, ...M, inline: (code, o) => { if (!sc.atoms.ready && /\batoms?\b/.test(code)) throw new Error('atoms data not loaded yet'); return M.inline(code, o); } };
Promise.all([json('data/atoms/types.json'), json('data/atoms/positions.json')])
  .then(([types, positions]) => { A.loadTypes(types); A.configure({ positions }); sc.atoms.ready = true; })
  .catch((e) => console.warn('atoms data failed to load:', e.message));
