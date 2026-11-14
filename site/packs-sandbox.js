// Sandbox host for third-party code ingredients (docs/PACK_SPEC.md 10.3, 10.4; issue #71). Loaded lazily by packs.js, only when a code ingredient is
// verified, trusted for its code hash and the code-ingredient flag is on. Everything here is defensive: the pack's code runs in a Worker inside an
// <iframe sandbox="allow-scripts"> (opaque origin, CSP without network), talks to the host only over a private MessageChannel, and every message is
// schema-checked as plain data. Nothing it returns is evaluated, injected as HTML or passed to import().
export const LIMITS = { loadMs: 2000, callMs: 150, strikes: 3, maxSandboxes: 4, maxModuleBytes: 512 * 1024, maxMsgBytes: 64 * 1024, maxNodes: 4000, maxDepth: 6, rateMax: 40, rateMs: 100, maxItems: 200 };
export const CSP = "default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; form-action 'none'; base-uri 'none'";
export const SANDBOX_ATTR = 'allow-scripts'; // never allow-same-origin, allow-top-navigation, allow-popups, allow-forms, allow-modals, allow-downloads

// measure(v, limits) -> approximate byte size of plain data, or -1 when v is not plain structured data within the limits. The same source runs in the
// frame (which relays only what passes) and on the host (which is the authority).
export function measure(v, L) {
  let nodes = 0, bytes = 0;
  const walk = (x, d) => {
    if (++nodes > L.maxNodes || d > L.maxDepth || bytes > L.maxMsgBytes) return false;
    if (x === null || typeof x === 'boolean') { bytes += 4; return true; }
    if (typeof x === 'number') { bytes += 8; return Number.isFinite(x); }
    if (typeof x === 'string') { bytes += x.length * 2; return bytes <= L.maxMsgBytes; }
    if (typeof x !== 'object') return false;
    if (ArrayBuffer.isView(x) && !(x instanceof DataView)) { bytes += x.byteLength; return bytes <= L.maxMsgBytes; }
    if (x instanceof ArrayBuffer) { bytes += x.byteLength; return bytes <= L.maxMsgBytes; }
    if (Array.isArray(x)) { for (let i = 0; i < x.length; i++) if (!walk(x[i], d + 1)) return false; return true; }
    const p = Object.getPrototypeOf(x); if (p !== Object.prototype && p !== null) return false;
    for (const k of Object.keys(x)) { bytes += k.length * 2; if (!walk(x[k], d + 1)) return false; }
    return true;
  };
  return walk(v, 0) ? bytes : -1;
}

// ---------------------------------------------------------------- worker bootstrap (the pack module is appended after it; it only gets `craft.handle`)
const WORKER_BOOT = `'use strict';
const H=Object.create(null);
self.craft=Object.freeze({handle(n,f){if(typeof n==='string'&&typeof f==='function')H[n]=f;}});
self.onmessage=async(e)=>{const m=e.data;if(!m||m.t!=='call')return;
 try{const f=H[m.method];if(!f)throw new Error('no handler '+m.method);const v=await f(m.input);self.postMessage({t:'res',id:m.id,ok:true,value:v});}
 catch(x){self.postMessage({t:'res',id:m.id,ok:false,error:String((x&&x.message)||x).slice(0,200)});}};
`;

// ---------------------------------------------------------------- frame document (host-built; the page text is the only script the frame ever runs)
const frameScript = (L, probe) => `(()=>{
const L=${JSON.stringify(L)};const measure=${measure.toString()};
const BOOT=${JSON.stringify(WORKER_BOOT)};
let port=null,worker=null;
const bye=(m)=>{try{port&&port.postMessage({t:'err',message:String(m).slice(0,200)});}catch(e){}};
addEventListener('message',(e)=>{
 if(port||e.source!==parent||!e.ports||e.ports.length!==1||!e.data||e.data.t!=='init')return;
 port=e.ports[0];port.onmessage=onHost;port.postMessage({t:'ready'});
});
function onHost(e){const m=e.data;if(measure(m,{...L,maxMsgBytes:L.maxModuleBytes*2+1024})<0||!m||typeof m.t!=='string')return bye('bad host message');
 if(m.t==='load'&&!worker&&typeof m.src==='string'){
  try{
   const b=new Blob([BOOT,'\\n',m.src,'\\n;self.postMessage({t:"ready"});'],{type:'text/javascript'});
   worker=new Worker(URL.createObjectURL(b));
   worker.onmessage=(w)=>{const d=w.data;if(measure(d,L)<0||!d||typeof d.t!=='string')return bye('bad worker message');port.postMessage(d);};
   worker.onerror=(w)=>{w.preventDefault&&w.preventDefault();bye('module error');};
  }catch(x){bye('cannot start module');}
 }else if(m.t==='call'&&worker){worker.postMessage(m);}
}
${probe ? probe : ''}
})();`;
export const frameDoc = (L = LIMITS, probe = '') => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta charset="utf-8"><script>${frameScript(L, probe).replace(/<\/script/gi, '<\\/script')}</script>`;

// ---------------------------------------------------------------- host side
const live = new Set();
export const sandboxCount = () => live.size;
export function createSandbox(o = {}) {
  const L = { ...LIMITS, ...(o.limits || {}) };
  const doc = o.document || globalThis.document;
  if (live.size >= L.maxSandboxes) throw Object.assign(new Error(`at most ${L.maxSandboxes} sandboxes at once`), { code: 'E_PACK_SANDBOX_LIMIT' });
  let iframe = null, port = null, state = 'new', stamp = [], seq = 0, strikes = 0, reason = null, loadTimer = null, onReady = null;
  const pending = new Map(), stale = new Set();
  const listeners = []; const emit = (ev) => listeners.forEach((f) => { try { f(ev); } catch (e) { /* listener bug */ } });
  function kill(code, message) { // remove the frame (and with it the worker); reject everything waiting
    if (state === 'stopped') return; state = 'stopped'; reason = { code, message }; live.delete(self_);
    clearTimeout(loadTimer); try { port && port.close(); } catch (e) { /* closed */ } port = null; try { iframe && iframe.remove(); } catch (e) { /* gone */ } iframe = null;
    for (const [, p] of pending) { clearTimeout(p.t); p.reject(Object.assign(new Error(message), { code })); } pending.clear();
    if (onReady) { onReady.reject(Object.assign(new Error(message), { code })); onReady = null; }
    emit({ type: 'stopped', code, message });
  }
  const violate = (why) => kill('E_PACK_SANDBOX_PROTOCOL', 'sandbox protocol violation: ' + why);
  function onMsg(e) {
    if (state === 'stopped') return;
    const now = Date.now(); stamp = stamp.filter((t) => now - t < L.rateMs); stamp.push(now);
    if (stamp.length > L.rateMax) return violate('message flood');
    const m = e.data; if (e.ports && e.ports.length) return violate('ports in message');
    if (measure(m, L) < 0 || !m || typeof m.t !== 'string') return violate('malformed or oversize message');
    if (m.t === 'ready' && state === 'framed') { state = 'booting'; port.postMessage({ t: 'load', src: o.source }); return; }
    if (m.t === 'ready' && state === 'booting') { state = 'ready'; clearTimeout(loadTimer); const r = onReady; onReady = null; r && r.resolve(); emit({ type: 'ready' }); return; }
    if (m.t === 'err') return kill('E_PACK_SANDBOX_PROTOCOL', 'module error: ' + String(m.message).slice(0, 200));
    if (m.t === 'res' && state === 'ready' && Number.isInteger(m.id) && typeof m.ok === 'boolean') {
      if (stale.delete(m.id)) return; const p = pending.get(m.id); if (!p) return violate('unexpected reply');
      if (!m.ok && typeof m.error !== 'string') return violate('bad error reply');
      pending.delete(m.id); clearTimeout(p.t); strikes = 0; if (m.ok) p.resolve(m.value); else p.reject(Object.assign(new Error(m.error), { code: 'E_PACK_SANDBOX_ERROR' })); return;
    }
    violate('unexpected message ' + m.t);
  }
  const self_ = {
    get state() { return state; }, get reason() { return reason; },
    on: (f) => { listeners.push(f); },
    start() { // resolves when the module has run once; rejects (and removes the frame) on timeout, error or protocol violation
      if (state !== 'new') return Promise.reject(new Error('already started'));
      if (typeof o.source !== 'string' || new TextEncoder().encode(o.source).length > L.maxModuleBytes) { state = 'stopped'; return Promise.reject(Object.assign(new Error('module too large'), { code: 'E_PACK_SIZE' })); }
      live.add(self_); state = 'framed';
      return new Promise((resolve, reject) => {
        onReady = { resolve, reject };
        loadTimer = setTimeout(() => kill('E_PACK_SANDBOX_TIMEOUT', `module did not start within ${L.loadMs} ms`), L.loadMs);
        iframe = doc.createElement('iframe'); iframe.setAttribute('sandbox', SANDBOX_ATTR); iframe.setAttribute('referrerpolicy', 'no-referrer'); iframe.setAttribute('allow', ''); iframe.setAttribute('aria-hidden', 'true'); iframe.tabIndex = -1;
        iframe.setAttribute('style', 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-9999px');
        iframe.addEventListener('load', () => {
          if (state !== 'framed' || !iframe) return; const ch = new MessageChannel(); port = ch.port1; port.onmessage = onMsg;
          iframe.contentWindow.postMessage({ t: 'init' }, '*', [ch.port2]);
        }, { once: true });
        iframe.srcdoc = frameDoc(L, o.probe || '');
        doc.body.append(iframe);
      });
    },
    call(method, input, { timeoutMs } = {}) { // one RPC; input must be plain data; a reply later than timeoutMs is dropped; three in a row stop the frame
      if (state !== 'ready') return Promise.reject(Object.assign(new Error('sandbox is ' + state), { code: reason ? reason.code : 'E_PACK_SANDBOX_STATE' }));
      if (typeof method !== 'string' || measure(input, L) < 0) return Promise.reject(Object.assign(new Error('input is not plain data within the limits'), { code: 'E_PACK_SANDBOX_PROTOCOL' }));
      const id = ++seq, ms = timeoutMs || L.callMs;
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          pending.delete(id); stale.add(id); if (stale.size > 64) stale.delete(stale.values().next().value);
          reject(Object.assign(new Error(`no answer within ${ms} ms`), { code: 'E_PACK_SANDBOX_TIMEOUT' }));
          if (++strikes >= L.strikes) kill('E_PACK_SANDBOX_TIMEOUT', `${strikes} calls in a row exceeded ${ms} ms; sandbox stopped`);
        }, ms);
        pending.set(id, { resolve, reject, t }); try { port.postMessage({ t: 'call', id, method, input }); } catch (e) { clearTimeout(t); pending.delete(id); reject(e); }
      });
    },
    stop: () => kill('E_PACK_SANDBOX_STOPPED', 'stopped by the host'),
    element: () => iframe,
  };
  return self_;
}

// plain-data -> completion items the intellisense registry understands; strings only, truncated, never evaluated
export function cleanItems(v, provider) {
  if (!Array.isArray(v)) return [];
  const s = (x, n) => (typeof x === 'string' ? x.slice(0, n) : undefined), out = [];
  for (const it of v.slice(0, LIMITS.maxItems)) {
    if (!it || typeof it !== 'object' || typeof it.label !== 'string' || !it.label || it.label.length > 80) continue;
    out.push({ label: it.label, category: s(it.category, 40) || provider, detail: s(it.detail, 120), info: s(it.info, 600), apply: s(it.apply, 400), method: it.method === true, string: it.string === true });
  }
  return out;
}
