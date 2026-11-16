// Folder and tag derivation (docs/PACKAGES.md section 4, docs/CONVENTIONS.md step 8). One module, used by tools/concepts/build.mjs for everything it
// generates and by tools/packs/taxonomy_fill.mjs for the hand-written pack files (phonk racks, atoms, presets) and the shim catalog.
// A folder comes from family, genre and role ("hiphop/trap/drums"); tags come from role, genre, feel, tempo-feel, mood, technique and status.
// Rules are code here so a new concept needs no code: it names a family, labels and a role word, and gets folder and tags.

export const ROLES = ['drums', 'bass', 'keys', 'pad', 'lead', 'vox', 'fx', 'form', 'groove', 'dovetail'];
const GENRE_OF = { 'hip-hop': 'hip-hop', 'boom-bap': 'boom-bap', trap: 'trap', hyphy: 'hyphy', cloud: 'cloud', phonk: 'phonk' };
const GENRE_FOLDER = ['trap', 'boom-bap', 'hyphy', 'cloud'];
const TEMPO_FEEL = ['half-time', 'syncopated', 'offbeat', 'four-floor', 'polyrhythm'];
const MOOD = ['dark', 'driving', 'hypnotic', 'tense', 'floaty', 'sparse', 'bright'];
const TECHNIQUE = ['sidechain', 'filter-sweep', 'automation-drift', 'call-response', 'build-drop', 'euclid', 'probability', 'delay-echo', 'phaser', 'tremolo', 'fm', 'formant', 'arpeggio', 'crescendo', 'fade-out', 'riser', 'swing', 'human-feel', 'accents', 'transition', 'reverb-big', 'dry-tight', 'stereo'];
export const uniq = (a) => [...new Set(a.filter(Boolean))];

/* the role of a recipe from its labels and id */
export function roleOfLabels(id, labels) {
  const l = new Set(labels), has = (...x) => x.some((y) => l.has(y));
  if (has('dovetail')) return 'dovetail';
  if (has('swing') || /^groove-/.test(id)) return 'groove';
  if (has('sections', 'arrangement', 'build-drop', 'layers-in', 'intro-reveal', 'breakdown')) return 'form';
  if (has('formant', 'texture-vocal-like')) return 'vox';
  if (has('riser', 'filter-sweep', 'phaser', 'tremolo', 'reverb-big', 'dry-tight', 'delay-echo', 'stereo', 'space')) return 'fx';
  if (has('bass', 'low-end') && !has('four-floor')) return 'bass';
  if (has('pad', 'drone')) return 'pad';
  if (has('bell-like', 'motif', 'arpeggio', 'pluck', 'fm')) return 'lead';
  if (has('chord-progression', 'voicing')) return 'keys';
  if (has('four-floor', 'offbeat', 'euclid', 'half-time', 'syncopated', 'polyrhythm', 'probability', 'hyphy', 'boom-bap', 'trap', 'accents')) return 'drums';
  if (has('dynamics', 'crescendo', 'fade-out', 'sidechain', 'movement', 'build')) return 'fx';
  return null;
}
export const genreOfLabels = (labels) => labels.map((x) => GENRE_OF[x]).filter(Boolean);
const subgenre = (labels) => labels.find((x) => GENRE_FOLDER.includes(x)) || null;

/* a catalog recipe -> { folder, tags } ; family comes from the concept builder ("hiphop", "dovetail", "groove", "feels") */
export function recipeTaxonomy(r) {
  const labels = r.labels || []; const fam = r.family || null; const role = roleOfLabels(r.id, labels);
  let folder;
  if (fam === 'dovetail') { const sid = r.id.replace(/^dovetail-/, ''); folder = 'dovetail/' + (/pickup/.test(sid) ? 'pickup' : /tail/.test(sid) ? 'tail' : /call/.test(sid) ? 'call-response' : /crossfade/.test(sid) ? 'crossfade' : /riser/.test(sid) ? 'riser-impact' : /duck/.test(sid) ? 'ducked' : sid); }
  else if (fam === 'groove') folder = 'groove/' + (/swing|mpc/.test(r.id) ? 'swing' : /drag|lazy/.test(r.id) ? 'push' : 'human');
  else if (fam === 'feels') folder = 'hiphop/' + (subgenre(labels) || 'general') + '/feel';
  else if (fam === 'hiphop') folder = `hiphop/${subgenre(labels) || 'general'}/${role || 'drums'}`;
  else if (r.origin === 'RECIPES.md' || r.origin === 'new' || !fam) folder = role ? `strudel/${role}` : 'strudel/misc';
  const status = [];
  if (r.verified) status.push('verified'); else status.push('unverified');
  if (r.needs_samples) status.push('needs-samples');
  if (r.lowered) status.push(r.lowered_check && r.lowered_check.approx ? 'approx' : 'lowered');
  const tags = uniq([role, ...genreOfLabels(labels), ...(fam === 'feels' ? ['feel'] : []), ...labels.filter((x) => !GENRE_OF[x]).map((x) => x), ...status]);
  return { folder, tags: tags.slice(0, 24) };
}

/* atoms (name "ns.name" inside an atoms ingredient) -> { folder, tags } */
const FORM_NAMES = /^(intro|drop|verse|hook|bridge|outro|dropBar|lastBeat|switch|bounce|stomp|no[A-Z]\w*|dark|builds?|drops?|conf|reliefs?|relief2|vac|dropB|slams|lastBar|every4)$/;
export function atomTaxonomy(ingId, ns, name, atom) {
  const n = name.replace(/^[a-z0-9]+\./, '');
  const gen = /^(boom)/.test(n) ? 'boom-bap' : /^(trap)/.test(n) ? 'trap' : /^(hyphy|stomp|bounce)/.test(n) ? 'hyphy' : /^cloud/.test(n) ? 'cloud' : null;
  const mk = (folder, role, extra = []) => ({ folder, tags: uniq([role, ...extra, atom.type === 'gate' ? 'gate' : atom.type === 'hook' ? 'rack-slot' : 'pattern']) });
  if (ns === 'dt') { const tech = /pickup/i.test(n) ? 'pickup' : /tail/i.test(n) ? 'tail' : /call|answer/i.test(n) ? 'call-response' : /xfade/i.test(n) ? 'crossfade' : /rise|hit/i.test(n) ? 'riser-impact' : n; return mk('dovetail/' + tech, 'dovetail', ['transition']); }
  if (/^feel-/.test(ingId)) { const id = ingId.replace(/^feel-/, ''); const v = n.replace(/(Vel|Rack)$/, ''); const role = /^(kick|snare|perc|hats|top)$/.test(v) ? 'drums' : v === 'bass' ? 'bass' : v === 'harmony' ? 'keys' : v === 'fx' ? 'fx' : v === 'groove' ? 'groove' : null;
    return { folder: `feels/${id}/${role || 'misc'}`, tags: uniq([role, 'feel', id === 'boombap' || id === 'lazy' ? 'boom-bap' : id, id === 'lazy' ? 'lazy' : null, /Vel$/.test(n) ? 'accents' : null, atom.type === 'hook' ? 'rack-slot' : 'pattern']) }; }
  if (FORM_NAMES.test(n) || atom.type === 'gate') return mk(`${ns === 'hh' ? 'hiphop/general' : ns === 'ph' || ns === 'ph2' ? 'phonk' : ns}/form`, 'form', ns === 'hh' ? ['hip-hop'] : ['phonk']);
  const role = /kick|snare|clap|snap|hats?|roll|perc|rim|tom|ghost|accent/i.test(n) ? 'drums' : /808|sub|bass|glide|slides/i.test(n) ? 'bass' : /chords|chops|stab|heart/i.test(n) ? 'keys' : /pad/i.test(n) ? 'pad' : /lead|counter|bell|stut/i.test(n) ? 'lead' : /tag/i.test(n) ? 'vox' : /fx|rise/i.test(n) ? 'fx' : null;
  const g = ns === 'hh' ? `hiphop/${gen || 'general'}` : 'phonk';
  return mk(`${g}/${role || 'misc'}`, role, ns === 'hh' ? ['hip-hop', gen] : ['phonk']);
}

/* hook defs (racks, grooves, moves): { folder, tags } from the def's class */
const CLASS_ROLE = { kick: 'drums', snare: 'drums', perc: 'drums', hat: 'drums', bass: 'bass', keys: 'keys', bell: 'lead', lead: 'lead', pad: 'pad', stab: 'keys', vox: 'vox', texture: 'fx', sweep: 'fx', move: 'dovetail', groove: 'groove', master: 'fx' };
export function rackTaxonomy(name, def, cls, ingId) {
  if (/^groove-/.test(name)) return { folder: 'grooves/' + (/swing|push|human/.test(name) ? 'builders' : 'presets'), tags: ['groove', 'rack-slot', 'human-feel', ...(/swing/.test(name) ? ['swing'] : [])] };
  const role = CLASS_ROLE[cls] || (cls === 'move' ? 'dovetail' : null); const gen = ingId === 'racks-hiphop' ? 'hiphop' : 'phonk';
  const move = cls === 'move' || /^(fadeOut|fadeIn|throw|tailHold|duckUnder)$/.test(name);
  return { folder: move ? 'dovetail/moves' : `racks/${role || 'misc'}`, tags: uniq([move ? 'dovetail' : role, 'rack', move ? 'transition' : null, gen === 'hiphop' ? 'hip-hop' : 'phonk']) };
}

/* the pack taxonomy: groups (styles by category), priority and the tag vocabulary with descriptions */
const GROUPS = {
  role: { title: 'Role', description: 'what the entry is in a mix: drums, bass, keys, pad, lead, vox, fx, form' },
  genre: { title: 'Genre', description: 'genre family the entry belongs to' },
  feel: { title: 'Feel', description: 'groove and attitude: boom-bap, trap, hyphy, cloud, lazy' },
  tempo: { title: 'Tempo feel', description: 'how the rhythm sits against the beat, not a speed' },
  mood: { title: 'Mood', description: 'emotional tint' },
  technique: { title: 'Technique', description: 'production move the entry shows' },
  status: { title: 'Status', description: 'measured or lowered state written by the builds' },
  form: { title: 'Form', description: 'song sections and gates' },
};
const DESC = {
  drums: 'kick, snare, clap, hats, percussion', bass: 'bass and 808 lines', keys: 'chords, stabs and chops', pad: 'sustained washes', lead: 'melody, bells, plucks', vox: 'vocal-like and word content', fx: 'risers, impacts, space, texture',
  form: 'sections, gates and arrangement', groove: 'timing: swing, push, jitter, drift', dovetail: 'how sections interlock', 'hip-hop': 'hip-hop family', trap: 'rolling hats, half-time, 808', 'boom-bap': 'dusty knock and pocket', hyphy: 'bay-area bounce and stomp', cloud: 'airy washed rap', phonk: 'night phonk kit',
  verified: 'rendered headless with sound', unverified: 'not rendered or not checked', 'needs-samples': 'needs a sample bank (network)', lowered: 'has a plain Strudel form with equal events', approx: 'plain Strudel form is approximate (grooves)', rack: 'a hook def (instrument rack or move)', 'rack-slot': 'a hook expression for a slot', gate: 'a section gate atom', pattern: 'a mini-notation pattern atom', feel: 'a feel template entry',
};
/* tag styles a pack sets itself (the rest follow the site category defaults); a palette key and an icon key, never a colour value */
const TAGSTYLE = { phonk: { color: 'violet', icon: 'genre', pattern: 'stripe', badge: 'PH' }, trap: { color: 'amber', icon: 'genre' }, 'boom-bap': { color: 'orange', icon: 'genre', pattern: 'dots' }, hyphy: { color: 'lime', icon: 'genre', pattern: 'stripe' } };
export function packTaxonomy(tagsUsed, { labels = [], extraPriority = [] } = {}) {
  const tags = {}; const labelCat = Object.fromEntries(labels.map((l) => [l.id, l.category]));
  const groupOf = (t) => ROLES.includes(t) ? t : ['hip-hop', 'trap', 'boom-bap', 'hyphy', 'cloud', 'phonk'].includes(t) ? 'genre' : ['verified', 'unverified', 'needs-samples', 'lowered', 'approx'].includes(t) ? 'status' : ['rack', 'rack-slot', 'gate', 'pattern'].includes(t) ? 'technique' : t === 'feel' ? 'feel' : TEMPO_FEEL.includes(t) ? 'tempo' : MOOD.includes(t) ? 'mood' : TECHNIQUE.includes(t) ? 'technique' : labelCat[t] || 'technique';
  for (const t of [...tagsUsed].sort()) { const g = groupOf(t); tags[t] = { group: g, ...(DESC[t] ? { description: DESC[t] } : {}), ...(TAGSTYLE[t] ? { style: TAGSTYLE[t] } : {}) }; }
  const groups = {}; for (const t of Object.values(tags)) groups[t.group] ||= GROUPS[t.group] ? { ...GROUPS[t.group] } : { title: t.group[0].toUpperCase() + t.group.slice(1) };
  return { version: 1, groups, priority: uniq([...extraPriority, ...ROLES, 'genre', 'feel', 'tempo', 'mood', 'technique', 'status']).filter((g) => groups[g] || tags[g]), tags };
}
export const folderDescriptions = {
  hiphop: 'Hip-hop, trap and hyphy components', 'hiphop/trap': 'Trap: rolling hats, half-time, held 808', 'hiphop/boom-bap': 'Boom-bap: dusty knock and pocket', 'hiphop/hyphy': 'Hyphy: bounce and stomp', 'hiphop/cloud': 'Cloud rap: airy pads',
  dovetail: 'How sections interlock', groove: 'Timing feel', grooves: 'Groove presets as hooks', feels: 'Feel templates (one import fills the slots)', racks: 'Instrument racks (hook defs)', phonk: 'Night phonk kit', strudel: 'Plain Strudel recipes',
};
