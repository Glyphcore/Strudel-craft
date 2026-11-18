/* Phone report on #199 / #215 (390 px, slow CPU): (a) two sources audible at once, (b) seek flapping, (c) old recipe kept after a recipe switch, (d) "<" then Play continues the old position,
   (e) Stop pressed while the restart's play() loads is ignored. 390x844, real clicks, CDP CPU throttling (PHONE_CPU, default 6); PHONE_AHEAD=1 (default) buffer playback, 0 live.
   Usage: PHONE_CPU=6 node tests/site/phone_throttle.mjs   (wrap in engine/load/gate.sh heavy) */
import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(process.env.PLAYWRIGHT_DIR || '/opt/node-tools/node_modules/playwright')); }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'); const SITE = path.join(ROOT, 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/json' };
const server = http.createServer((req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(SITE, p); if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
let fails = 0; const errors = []; const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); };

const RATE = +(process.env.PHONE_CPU || 6), AH = process.env.PHONE_AHEAD || '1', SETTLE = +(process.env.PHONE_SETTLE || 15000);
const HEAVY = process.env.PHONE_HEAVY ? ['a: s("sawtooth*16").note("<c2 eb2 g2 bb2>").lpf(sine.range(300, 3000).slow(4)).room(0.4).gain(0.03)', 'b: note("c4 eb4 g4 bb4 c5 bb4 g4 eb4").fast(2).s("triangle").delay(0.4).room(0.5).gain(0.03)', 'd: s("white*16").decay(0.03).hpf(6000).gain(0.02)', ''].join('\n') : '';
const A = 'setcpm(120/4)\nvoiceA: note("a3 a3 a3 a3").s("sine").release(3).sustain(1).gain(0.4)\n';
const B = 'setcpm(120/4)\nvoiceB: note("e5 ~ e5 ~").s("triangle").release(0.1).gain(0.2)\n';
const SEEKC = 'setcpm(120/4)\ntone: note("<a3 a3 a3 a3 e5 e5 e5 e5>").struct("x*8").s("sine").release(0.2).gain(0.3)\n';
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const c2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }); await c2.route(/api\.github\.com/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' }));
const p2 = await c2.newPage(); p2.on('pageerror', (e) => errors.push(e.message)); const T2 = (f, a) => p2.evaluate(f, a), w2 = (ms) => p2.waitForTimeout(ms); const cdp = await c2.newCDPSession(p2);
await p2.goto(`http://127.0.0.1:${server.address().port}/index.html?ahead=${AH}#rack`); await p2.waitForSelector('#list li[data-id]', { timeout: 60000 }); await p2.waitForFunction(() => window.strudelCraft.timeline && window.strudelCraft.bg, null, { timeout: 30000 });
await T2(async ([a, b, h]) => { const sc = window.__sc; const rs = sc.S.filtered.slice(0, 2); for (const r of rs) await sc.hydrate(r); sc.S.edits[rs[0].id] = a + h; sc.S.edits[rs[1].id] = b + h; sc.select(0, { audition: false }); }, [A, B, HEAVY]);
const tapRow = async (i) => { const r = p2.locator('#list li[data-id]').nth(i).locator('.row'); await r.evaluate((el) => el.scrollIntoView({ block: 'center' })); await r.click({ position: { x: 24, y: 12 } }); };
const playing = () => p2.waitForFunction(() => window.__sc.S.playing && window.__sc.Engine.started && !window.__sc.S.busy, null, { timeout: 120000 });
await cdp.send('Emulation.setCPUThrottlingRate', { rate: RATE });
/* audio-thread meter (a main-thread analyser reads stale values while the page is stalled): Goertzel of 220 / 659 Hz per 4096 frames on the master gain, stamped with the audio clock; pos is the shown position at message time */
const sampler = () => T2(async () => { window.__smp = []; const B = window.__sc.Bus, c = B.ctx;
  const js = `const G=(x,w)=>{const k=2*Math.cos(w);let a=0,b=0;for(let i=0;i<x.length;i++){const n=x[i]+k*a-b;b=a;a=n}return (a*a+b*b-k*a*b)/(x.length*x.length)*4};
  class M extends AudioWorkletProcessor{constructor(){super();this.b=new Float32Array(4096);this.n=0}process(i){const l=i[0]&&i[0][0];for(let k=0;k<128;k++)this.b[this.n++]=l?l[k]:0;if(this.n>=4096){this.n=0;const w=2*Math.PI/sampleRate;this.port.postMessage({t:currentTime,a:10*Math.log10(G(this.b,220*w)+1e-14),b:10*Math.log10(G(this.b,659.26*w)+1e-14)})}return true}}registerProcessor('sc-ph-meter',M)`;
  await c.audioWorklet.addModule(URL.createObjectURL(new Blob([js], { type: 'application/javascript' }))); const w = new AudioWorkletNode(c, 'sc-ph-meter', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: 'explicit' });
  B.gain.connect(w); w.port.onmessage = (e) => { const t = window.strudelCraft.timeline.state(); window.__smp.push({ ...e.data, pos: t.t }); }; });
const mark = () => T2(() => window.__smp.length), since = (n) => T2((n) => window.__smp.slice(n), n), ctxT = () => T2(() => window.__sc.Bus.ctx.currentTime);
const srcOf = () => T2(() => window.strudelCraft.ahead ? window.strudelCraft.ahead.state().source : 'live');
/* (c)+(a) recipe switch while A plays */
await p2.click('#playBtn'); await playing(); await sampler(); await w2(SETTLE);
const src0 = await srcOf(); const pre = await since(Math.max(0, await mark() - 60)); check('A is audible before the switch', pre.some((s) => s.a > -55), `source ${src0}, 220 Hz max ${Math.max(...pre.map((s) => s.a)).toFixed(0)} dB`);
const n0 = await mark(), tC = await ctxT(); await tapRow(1); await w2(22000); const sw = await since(n0);
const t0 = (s) => s.t - tC, aOn = (s) => s.a > -55, bOn = (s) => s.b > -55;
if (process.env.PHONE_DEBUG) console.log(sw.filter((_, i) => i % 3 === 0).slice(0, 80).map((s) => `${t0(s).toFixed(1)}:${s.a.toFixed(0)}/${s.b.toFixed(0)}`).join(' '));
const lastA = sw.filter(aOn).map(t0).pop() ?? -1, firstB = sw.filter(bOn).map(t0)[0] ?? 99, both = sw.filter((s) => aOn(s) && bOn(s)).length * 0.1;
check(`(c) recipe switch under CPU x${RATE}: old recipe A is silent within 3 s of the click and stays silent`, lastA < 3, `last A energy ${lastA.toFixed(1)} s after the click; B first heard ${firstB.toFixed(1)} s`);
check('(c) the new recipe B is heard within 12 s of the click', firstB < 12, `first B ${firstB.toFixed(1)} s`);
check('(a) A and B are never audible together for more than 0.6 s', both <= 0.6, `${both.toFixed(1)} s with both above -55 dB; source ${await srcOf()}`);
/* (c2) rapid switching while renders are in flight: A -> B -> A -> B with 700 ms between clicks, final B: A must be gone */
await tapRow(0); await w2(700); await tapRow(1); await w2(700); await tapRow(0); await w2(700); const n1 = await mark(), tD = await ctxT(); await tapRow(1); await w2(20000); const rp = await since(n1);
const lastA2 = rp.filter(aOn).map((s) => s.t - tD).pop() ?? -1, firstB2 = rp.filter(bOn).map((s) => s.t - tD)[0] ?? 99, endA = rp.slice(-30).filter(aOn).length;
check('(c2) four quick recipe switches under throttling ending on B: A silent within 3 s and stays silent, B heard within 12 s', lastA2 < 3 && firstB2 < 12 && endA === 0, `last A ${lastA2.toFixed(1)} s, first B ${firstB2.toFixed(1)} s, A samples in the last 3 s: ${endA}; source ${await srcOf()}`);
/* seek program */
await p2.click('#playBtn'); await w2(1500); await tapRow(0); await T2((c) => { window.__sc.setView('rack'); const ta = document.getElementById('code'); const v = ta.cmView; if (v) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: c } }); else { ta.value = c; ta.dispatchEvent(new Event('input', { bubbles: true })); } }, SEEKC); await w2(800);
await T2(() => { const t = window.strudelCraft.timeline; t.setMode('off'); t.seek(0); t.setZoom(60); document.getElementById('tlScroll').scrollLeft = 0; });
await p2.click('#playBtn'); await playing(); await w2(SETTLE / 2);
const ruler = (cyc) => T2((cyc) => { const s = window.strudelCraft.timeline.state(), r = document.getElementById('lanes').getBoundingClientRect(); return { x: r.left + s.gutter + cyc * s.ppb - s.scrollLeft, y: r.top + s.ruler / 2 }; }, cyc);
const domOf = (arr) => arr.map((s) => (s.a < -55 && s.b < -55 ? '-' : s.b > s.a ? 'B' : 'A')).join('').replace(/(.)\1+/g, '$1').replace(/-/g, '').replace(/(.)\1+/g, '$1');
let s0 = await mark(); let p = await ruler(4); await p2.mouse.click(p.x, p.y); await w2(9000); const sk = await since(s0);
const seq = domOf(sk), back = sk.slice(1).filter((s, i) => s.pos < sk[i].pos - 0.3).length;
check('(b) seek under throttling: audio goes old tone -> new tone (no new -> old -> new flap)', /^A?B(A)?$/.test(seq) && !/BAB/.test(seq), `tone sequence ${seq || 'none'}`);
check('(b) the position readout never steps back over 0.3 s after the seek', back <= 1, `${back} backward steps`);
/* (d) "<" while playing at cycle ~5 (tone B), then Stop, then Play: must start at cycle 0 = tone A */
await w2(1500); await p2.click('#startBtn'); s0 = await mark(); await w2(5500); const rs = await since(s0); const seqR = domOf(rs);
check('(d) "<" while playing under throttling: audio returns to the start tone A and stays there for 4 s of the program', /^B?A$/.test(seqR), `tone sequence ${seqR || 'none'}`);
await w2(4000); await p2.click('#playBtn'); await w2(2500); await p2.click('#startBtn'); await w2(800); s0 = await mark(); await p2.click('#playBtn'); await playing(); await w2(6000); const pl = await since(s0); const seqP = domOf(pl);
check('(d) Play, play to cycle >= 4, Stop, "<", Play: the first audio is the start tone A, not the old position (B)', /^A/.test(seqP), `tone sequence ${seqP || 'none'}`);
/* (e) "<" while playing, Stop while the restart's play() is still loading: stays stopped */
await T2(() => { const E = window.__sc.Engine, p0 = E.prepare.bind(E); E.prepare = async (...a) => { await new Promise((r) => setTimeout(r, 1500)); return p0(...a); }; });
await p2.click('#startBtn'); await w2(300); await p2.click('#playBtn'); s0 = await mark(); await w2(12000); const st = await since(s0); const st2 = await T2(() => ({ playing: window.__sc.S.playing, started: window.__sc.Engine.started }));
check('(e) Stop during the "<" restart is not undone (stays stopped, silent for 5 s)', !st2.playing && st.filter((s) => s.t - st[0].t > 6 && (aOn(s) || bOn(s))).length === 0, JSON.stringify(st2));
await c2.close();
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '));
await browser.close(); server.close(); console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
