// CLI host shim (prelude for headless renders only, not part of the track): the site's vox banks are addressed relative to the
// site root ('data/vox/...'), so a relative fetch is resolved against $STRUDEL_CRAFT/site here. Pass with --prelude before site/prelude/word.js.
{ const f0 = globalThis.fetch, root = 'file://' + ((globalThis.process && process.env.STRUDEL_CRAFT) || '/home/user/strudel-craft') + '/site/';
  globalThis.fetch = (u, o) => f0(typeof u === 'string' && /^data\//.test(u) ? root + u : u, o) }
