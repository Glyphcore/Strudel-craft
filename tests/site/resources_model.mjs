// Resources model unit test (no browser): buildModel / available / insertPlan from site/engine/resources.js on the night phonk v2 pack program, a synthetic program with
// an unresolved atom / rack / bus / tap / vox bank / pack, comment-safety, and the CLI twin (`strudel refs IN --json`) giving the same references.
// Usage: node tests/site/resources_model.mjs [--no-cli]
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { loadHost } from '../lib/refs_host.mjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const V2 = path.join(ROOT, 'docs/tracks/night-phonk-demo/track.v2.strudel.js'); const code = fs.readFileSync(V2, 'utf8');
let fails = 0; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };
const { R, host } = await loadHost(code); const m = R.buildModel(code, host); const by = (k) => m.refs.filter((r) => r.kind === k);
check('night phonk v2: atoms.import of both phonk atom sets resolved with pack, version and licence', by('import').length === 2 && by('import').every((r) => r.status.includes('resolved') && r.source.pack === 'glyphcore/phonk' && r.source.version && r.source.license), JSON.stringify(by('import').map((r) => r.source)));
check('night phonk v2: 36 atoms used, each with source pack and a line', by('atom').length === 36 && by('atom').every((r) => r.source && r.source.pack === 'glyphcore/phonk' && r.line > 0), `${by('atom').length}`);
check('night phonk v2: racks (hooks.bind) resolved from the pack, slots listed with their binds', by('hook').some((r) => r.name === 'kick808' && r.status.includes('resolved') && r.source.pack === 'glyphcore/phonk') && by('slot').some((r) => r.name === 'tone' && r.binds >= 5), `${by('hook').length} hooks, ${by('slot').length} slots`);
check('night phonk v2: lanes, buses (verb, glue send+ret), controls with ranges, vox banks and words', by('lane').length >= 20 && by('bus').every((r) => r.status.includes('resolved')) && by('control').find((r) => r.name === 'macro').range.max === 1 && ['ljspeech', 'sung', 'call-me-baby', 'vocalset'].every((b) => by('vox').some((r) => r.name === b && r.status.includes('resolved'))) && by('vox').some((r) => r.word), '');
check('night phonk v2: packs row for glyphcore/phonk and glyphcore/vox with versions', ['glyphcore/phonk', 'glyphcore/vox'].every((p) => by('pack').some((r) => r.name === p && r.version)), '');
check('night phonk v2: nothing unresolved', m.missing.length === 0, JSON.stringify(m.missing));

// unresolved and status chips
const bad = ['atoms.import("pack:glyphcore/edm:atoms-dubstep")', '// atoms.import("pack:x/y:hidden")', '$: note(atoms.ph.kick).s("sine").tap("k").send("verb", 0.3)', 'hooks.bind("kick", "nopeRack")', "await voxBank('nobank')", 'ctl("a", { min: 0, max: 2, default: 1 })', 'hooks.map("ghost", "lpf", { range: [0, 1] })', 'tap("pad1")'].join('\n');
const b = await loadHost(bad); const mb = b.R.buildModel(bad, b.host); const get = (k, n) => mb.refs.find((r) => r.kind === k && r.name === n);
check('comment-safe: a commented import is not a reference', !mb.refs.some((r) => r.name.includes('hidden')));
check('unresolved atom names the pack to import', get('atom', 'ph.kick').status.includes('unresolved') && /import pack:glyphcore\/phonk:atoms/.test(get('atom', 'ph.kick').fix) && get('atom', 'ph.kick').fixLine === 'atoms.import("pack:glyphcore/phonk:atoms")');
check('unused import chip', get('import', 'pack:glyphcore/edm:atoms-dubstep').status.includes('unused'));
check('unresolved rack, slot without .use, bus without ret, vox bank, undeclared control', get('hook', 'nopeRack').status.includes('unresolved') && get('slot', 'kick').status.includes('unresolved') && get('bus', 'verb').status.includes('unresolved') && get('vox', 'nobank').status.includes('unresolved') && get('control', 'ghost').status.includes('unresolved'));
check('unread tap chip and pad reader info', get('tap', 'k').status.includes('unread') && get('tap', 'pad1').status.includes('info'));
check('missing list carries a fix for each unresolved reference', mb.missing.length >= 5 && mb.missing.every((x) => x.fix), `${mb.missing.length}`);
// shadow and alias chips from a resolution
const sh = JSON.parse(JSON.stringify(host)); sh.packs = { ...host.packs, resolution: { hooks: { ...host.packs.resolution.hooks, kick808: { winner: 'glyphcore/phonk:kick808', shadowed: ['someone/else:kick808'] } } } };
check('shadowed chip (#143) when another pack also defines the name', R.buildModel('hooks.bind("kick", "kick808")', sh).refs.find((r) => r.name === 'kick808').status.includes('shadowed'));

// available + insert plan
const av = R.available(host); const ph = av.find((p) => p.id === 'glyphcore/phonk'); const atomsK = ph.kinds.find((k) => k.kind === 'atoms'); const it = atomsK.ingredients.flatMap((g) => g.items).find((x) => x.name === 'ph.kick');
check('available: packs -> kinds -> items with description, snippet, insert line', !!ph && atomsK.count >= 22 && it && it.insert.text === 'atoms.import("pack:glyphcore/phonk:atoms")' && /atoms\.ph\.kick/.test(it.snippet) && it.play.includes('$:'));
check('available: search filters', R.available(host, { q: 'cowbell' }).flatMap((p) => p.kinds).flatMap((k) => k.ingredients).flatMap((g) => g.items).every((x) => /cowbell/i.test(`${x.name} ${x.desc} ${x.folder} ${x.tags}`)));
const base = 'setcpm(32)\nawait voxBank(\'sung\')\n// notes\n\n$: s("bd*4")\n$: s("hh*8")\n'; const plan = R.insertPlan(base, it); const out = R.applyPlan(base, plan);
check('insert plan: the import goes after the header run and nothing else changes', out.replace(/atoms\.import\("pack:glyphcore\/phonk:atoms"\)\n/, '') === base && out.split('\n')[2].startsWith('atoms.import') , JSON.stringify(out.split('\n').slice(0, 4)));
check('insert plan: already present is a no-op', R.insertPlan(out, it).noop === true);
check('insert plan: block goes after the caret line, empty program gets the text', R.applyPlan('$: a\n$: b', R.insertPlan('$: a\n$: b', { insert: { type: 'block', text: '$: c' } }, 3)) === '$: a\n$: c\n$: b' && R.applyPlan('', R.insertPlan('', it)) === it.insert.text + '\n');

// #131 lazy recipe bodies: an indexed recipe row has no code until its family file is read; applyBody puts the body on the entry
const amen = R.available(host, { q: 'amen-chops' }).flatMap((p) => p.kinds).flatMap((k) => k.ingredients).flatMap((g) => g.items).find((x) => x.name === 'amen-chops');
const bodies = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/recipes/dnb.json'), 'utf8')).bodies;
check('available: an indexed recipe row is lazy (body file named, no snippet, nothing to insert yet)', amen && amen.lazy === true && amen.body === 'bodies-dnb' && !amen.snippet && !amen.insert.text && !amen.play, JSON.stringify(amen && { lazy: amen.lazy, body: amen.body }));
check('applyBody: snippet, Play text and a block to insert (whole programs are kept as written), lowered fields copied', R.applyBody(amen, bodies['amen-chops']) && amen.snippet === bodies['amen-chops'].code && amen.play === amen.snippet && amen.insert.text === amen.snippet && amen.lazy === false && (amen.lowered === undefined || typeof amen.lowered === 'string'));
check('blockText: a bare expression gets "$: ", programs with labels / setcpm do not, empty stays empty', R.blockText('s("bd")') === '$: s("bd")' && R.blockText('$: s("bd")\n') === '$: s("bd")' && R.blockText('kick: s("bd")') === 'kick: s("bd")' && R.blockText('setcpm(30)\n$: s("bd")').startsWith('setcpm') && R.blockText('') === '');
const ins = R.insertPlan('$: a\n$: b', amen, 3); check('insert plan: a recipe block goes after the caret line and nothing else moves', ins && R.applyPlan('$: a\n$: b', ins) === '$: a\n' + amen.insert.text + '\n$: b');
check('renderAvailable lists packs, kinds and items', /amen-chops/.test(R.renderAvailable(R.available(host, { q: 'amen' }))));

// one search scope (pane and CLI): index fields by default; recipe body text (intent, notes) only with deep
const idsOf = (q, o = {}) => R.availableIds(R.available(host, { q, ...o }));
const dub = Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/recipes/dubstep.json'), 'utf8')).bodies).find(([id, b]) => /amen/i.test(b.intent || '') && !/amen/i.test(id));
check('search scope: a recipe whose body text (not its index fields) holds the word is not found by default', !!dub && !idsOf('amen').some((i) => i.endsWith(':' + dub[0])), dub && dub[0]);
const bmap = new Map([['glyphcore/shim|bodies-dubstep', JSON.parse(fs.readFileSync(path.join(ROOT, 'site/data/recipes/dubstep.json'), 'utf8')).bodies]]);
check('search scope: loaded bodies do not change the default result (display only)', JSON.stringify(idsOf('amen')) === JSON.stringify(idsOf('amen', { bodies: bmap })));
check('search scope: deep (with the family files) finds it, and only adds ids', idsOf('amen', { deep: true, bodies: bmap }).some((i) => i.endsWith(':' + dub[0])) && idsOf('amen').every((i) => idsOf('amen', { deep: true, bodies: bmap }).includes(i)));
check('available: shipped vox banks are items of glyphcore/vox (same list in the pane and the CLI)', idsOf('ljspeech').some((i) => /^glyphcore\/vox:banks:ljspeech$/.test(i)));
check('lazyFiles lists each family body file once', R.lazyFiles(host).length >= 5 && new Set(R.lazyFiles(host).map((f) => f.pack + '|' + f.body)).size === R.lazyFiles(host).length);
// CLI twin
if (!process.argv.includes('--no-cli')) {
  const CLI = path.join(process.env.STRUDEL_CLI || '/home/user/suno-track-lab/engine/strudel-cli', 'strudel');
  if (!fs.existsSync(CLI)) console.log('SKIP  CLI twin (no CLI at ' + CLI + ')');
  else {
    const run = (f) => JSON.parse(execFileSync(CLI, ['refs', f, '--json'], { env: { ...process.env, STRUDEL_CRAFT: ROOT }, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
    const key = (mm) => mm.refs.map((r) => `${r.kind}|${r.name}|${r.status.join('+')}|${r.source ? r.source.pack + '@' + r.source.version : ''}|${r.uses.map((u) => u.line).join(',')}`).sort();
    const cli = run(V2); const A = key(cli), B = key(m);
    check('CLI twin: `strudel refs --json` equals the site model on night phonk v2 (kind, name, status, source, lines)', A.length === B.length && A.every((x, i) => x === B[i]), `cli ${A.length}, model ${B.length}, first diff ${A.find((x, i) => x !== B[i])} vs ${B.find((x, i) => x !== A[i])}`);
    fs.writeFileSync('/tmp/refs_unit_bad.strudel.js', bad); let code1 = 0; try { execFileSync(CLI, ['refs', '/tmp/refs_unit_bad.strudel.js'], { env: { ...process.env, STRUDEL_CRAFT: ROOT }, stdio: 'ignore' }); } catch (e) { code1 = e.status; }
    check('CLI twin: exit 1 on unresolved references', code1 === 1);
    const av = JSON.parse(execFileSync(CLI, ['refs', V2, '--available', '--q', 'amen-chops', '--json'], { env: { ...process.env, STRUDEL_CRAFT: ROOT }, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] })).available;
    const ca = av.flatMap((p) => p.kinds).flatMap((k) => k.ingredients).flatMap((g) => g.items).find((x) => x.name === 'amen-chops');
    check('CLI twin: `refs --available` reads the recipe body through the Strudel-craft loader (code present, nothing lazy), same code as the body file', ca && !ca.lazy && ca.snippet === bodies['amen-chops'].code, ca && JSON.stringify({ lazy: ca.lazy, n: (ca.snippet || '').length }));
  }
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
