import { createRequire } from 'module'; import http from 'http'; import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const SITE=new URL('../../site',import.meta.url).pathname, OUT=process.argv[2]||new URL('../../docs/screens',import.meta.url).pathname;
const T={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{let p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';const f=path.join(SITE,p);if(!fs.existsSync(f)){r.writeHead(404);return r.end();}r.writeHead(200,{'content-type':T[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
await new Promise(r=>srv.listen(0,'127.0.0.1',r)); const B=`http://127.0.0.1:${srv.address().port}/`;
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']}); const errs=[]; let fail=0;
const ok=(n,c,d='')=>{console.log((c?'PASS ':'FAIL ')+n+' '+d); if(!c)fail++;};
for (const [tag,vp] of [['360',{width:360,height:780}],['1440',{width:1440,height:900}]]) {
  const pg=await b.newPage({viewport:vp, hasTouch: tag==='360'}); pg.on('console',m=>{if(m.type()==='error')errs.push(tag+': '+m.text())}); pg.on('pageerror',e=>errs.push(tag+': '+e.message));
  await pg.route(/api\.github\.com/,r=>r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:'{"body":""}'}));
  await pg.goto(B); await pg.waitForTimeout(1500);
  // palette
  if (tag==='360') { ok(tag+' fab visible', await pg.isVisible('#palFab')); await pg.tap('#palFab'); }
  else { await pg.keyboard.press('Control+k'); }
  ok(tag+' palette open', await pg.isVisible('#palette'));
  await pg.fill('#palQ','fstd'); const first=await pg.textContent('#palList li'); ok(tag+' fuzzy fstd -> Full studio', /Full studio/.test(first), first);
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
  ok(tag+' workspace on', await pg.evaluate(()=>document.body.classList.contains('ws-on')));
  const lay=()=>pg.evaluate(()=>JSON.stringify(strudelCraft.workspace.layout().map(r=>r.map(p=>p.id))));
  const l0=await lay();
  await pg.click('.ws-pane[data-id="editor"] [data-a="split"]'); const l1=await lay(); ok(tag+' split', l1!==l0, l1);
  await pg.click('.ws-pane[data-id="editor"] [data-a="up"]'); const l2=await lay(); ok(tag+' move up', l2!==l1, l2);
  await pg.click('.ws-pane[data-id="syntax"] [data-a="close"]'); ok(tag+' close', !(await lay()).includes('syntax'));
  await pg.screenshot({path:`${OUT}/ws-${tag}.png`,fullPage:false});
  const saved=await lay();
  await pg.evaluate(()=>{ const all={Mine:{rows:strudelCraft.workspace.layout(),key:'Alt+5'}}; localStorage.setItem('sc.ws.configs',JSON.stringify(all)); });
  await pg.evaluate(()=>strudelCraft.workspace.load('Code')); ok(tag+' load Code', (await lay())==='[["recipes","editor"]]', await lay());
  await pg.evaluate(()=>strudelCraft.workspace.load('Mine')); ok(tag+' load saved restores', (await lay())===saved);
  // seek + loop via queried event times (scheduler queryArc spans)
  await pg.click('#playBtn'); for(let i=0;i<40;i++){await pg.waitForTimeout(250); if(await pg.evaluate(()=>strudelCraft.transport.playing))break;}
  await pg.waitForTimeout(800);
  const spans=()=>pg.evaluate(()=>{const s=strudelCraft.engineState().scheduler; const p=s.pattern; window.__q=[]; if(!p.__w){const q=p.queryArc.bind(p); p.queryArc=(a,b,o)=>{if(b-a>0&&b-a<0.1)window.__q.push([a,b]); return q(a,b,o);}; p.__w=1;}});
  await spans(); await pg.evaluate(()=>strudelCraft.range.seek(8)); await pg.waitForTimeout(600);
  const q1=await pg.evaluate(()=>window.__q); const after=q1.filter(x=>x[0]>=7.99); ok(tag+' scrub to cycle 8: queries jump', after.length>0 && Math.abs(after[0][0]-8)<0.01 && q1.every((x,i)=>!i||Math.abs(x[0]-q1[i-1][1])<1e-6||x[0]===8), JSON.stringify(after[0]));
  await pg.evaluate(()=>{const st=strudelCraft.range.state; st.start=2; st.end=3; st.loop=true; window.__q=[];});
  await pg.waitForTimeout(4500);
  const q2=await pg.evaluate(()=>window.__q); const loopQ=q2.slice(2); const wr=q2.map((x,i)=>i&&x[0]<q2[i-1][0]?i:-1).filter(i=>i>0); const back=wr.length;
  const cps=await pg.evaluate(()=>strudelCraft.engineState().scheduler.cps); const span=q2[1]?q2[1][1]-q2[1][0]:0.025, perPass=Math.round((3-2)/span);
  /* 4.5 s at cps 0.5 = 2.25 cycles: 1 entry jump + 2 wraps, entry lands exactly on Start, wraps one loop length apart */
  ok(tag+' loop wrap count', cps===0.5 && back===3 && q2[wr[0]][0]===2 && wr.slice(1).every((w,k)=>Math.abs(w-(k?wr[k]:wr[0])-perPass)<=1), 'cps='+cps+' wraps='+back+' at '+JSON.stringify(wr.map(i=>[i,+q2[i][0].toFixed(3)])));
  ok(tag+' loop 2-3: queries stay in range and wrap', back>=1 && loopQ.every(x=>x[0]>=2-1e-6 && x[1]<3.03), 'wraps='+back+' max='+Math.max(...loopQ.map(x=>x[1])).toFixed(3));
  await pg.evaluate(()=>{strudelCraft.range.state.loop=false;}); await pg.click('#playBtn'); await pg.waitForTimeout(300);
  // readout + cycle/time conversion
  ok(tag+' readout format', /^c \d+\.\d\/\d+\.\d·(\d:)?\d\d:\d\d\/(\d:)?\d\d:\d\d$/.test(await pg.textContent('#trPosTxt')), await pg.textContent('#trPosTxt'));
  ok(tag+' m:ss -> cycles via cps', await pg.evaluate(()=>{const P=strudelCraft.range.parsePos; return P('0:24','cycle',0.5)===12 && P('0:24','cycle',1)===24 && P('8','time',0.5)===4 && P('5','bar',0.5)===4 && P('3','cycle',0.5)===3;}));
  for (const id of ['#trUnit','#trLoop','#trSet','#trOut','#trStart','#trEnd']) { const bb=await pg.locator(id).boundingBox(); ok(tag+' '+id+' >= 44px', bb && bb.height>=44 && bb.width>=44, bb&&(bb.width|0)+'x'+(bb.height|0)); }
  // clamp
  await pg.evaluate(()=>{strudelCraft.range.setLimit(0.05); strudelCraft.range.state.atLimit='fade';});
  await pg.click('#playBtn'); let pl=false; for(let i=0;i<40&&!pl;i++){await pg.waitForTimeout(250); pl=await pg.evaluate(()=>strudelCraft.transport.playing);} ok(tag+' playing', pl);
  await pg.waitForTimeout(2500); ok(tag+' override visible near limit', await pg.isVisible('#trMore'));
  await pg.screenshot({path:`${OUT}/range-${tag}.png`});
  await pg.click('#trMore'); await pg.waitForTimeout(2000); ok(tag+' override keeps playing', await pg.evaluate(()=>strudelCraft.transport.playing));
  await pg.evaluate(()=>{strudelCraft.range.state.extra=0;}); await pg.waitForTimeout(5500);
  ok(tag+' clamp stopped', !(await pg.evaluate(()=>strudelCraft.transport.playing)), await pg.textContent('#trLeft'));
  await pg.close();
}
ok('no console errors', errs.length===0, errs.join(' | ')); await b.close(); srv.close(); process.exit(fail?1:0);
