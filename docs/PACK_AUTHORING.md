# Writing a sandboxed code ingredient (craftpack 1.0, site host, #71)

Data first: prefer a data kind. Use code only when data cannot say it. Your module runs in a Worker inside a sandboxed frame with **no network, no
storage and no access to the page**; the user must trust it for its exact hash, and the site must have code ingredients switched on. Read
`docs/PACK_SPEC.md` 10.3 and 10.4 for the rules and the threat model.

## Manifest

```json
{ "id": "you/pack", "kind": "intellisense-provider", "format": "intellisense-provider@1", "path": "provider.json", "hash": "sha256:...",
  "code": true, "modules": [{ "path": "provider.js", "realm": "sandbox", "hash": "sha256:...", "bytes": 1234 }] }
```

`provider.json` is `{ "id": "my-provider", "module": "provider.js", "timeoutMs": 150 }` (`module` must be one of `modules`; `timeoutMs` default 150,
at most 1000). Every executable file must be listed in `modules` with its hash (`strudel packs hash`), otherwise `E_PACK_CODE_UNDECLARED`.

## Module API

Plain script text (no `import`, no `export`). The only global the host adds is `craft`:

```js
craft.handle('complete', ({ before, after, line, pos }) => {
  // before: up to 2000 chars before the caret; after: up to 500 after; line: the current line; pos: caret offset
  return [{ label: 'mySound', category: 'My pack', detail: 'short', info: 'longer text', apply: 'mySound("x")' }];
});
```

Return plain data (strings, numbers, booleans, null, arrays, plain objects, typed arrays), at most 64 KiB, depth 6; for completions at most 200 items,
strings are truncated (`label` 80, `detail` 120, `info` 600, `apply` 400). Return or resolve within `timeoutMs`; the reply is dropped after that, and three
timeouts in a row stop your frame (`E_PACK_SANDBOX_TIMEOUT`). The host never evaluates anything you return and never treats it as HTML.

## RPC message shapes (what the host and frame exchange)

All messages travel over a private `MessageChannel`; a module only sees its `call`s through `craft.handle`.

| direction | shape |
|---|---|
| host to frame | `{t:'init'}` + one transferred port (once), then `{t:'load', src}`, then `{t:'call', id, method, input}` |
| frame to host | `{t:'ready'}` (frame up), `{t:'ready'}` (module ran), `{t:'res', id, ok:true, value}`, `{t:'res', id, ok:false, error}`, `{t:'err', message}` |

Anything else, an oversize message, or more than 40 messages per 100 ms is a protocol violation: the frame is removed (`E_PACK_SANDBOX_PROTOCOL`).
A module that throws while loading, or never finishes loading within 2 s, is stopped too. At most 4 sandboxes run at once.

## What you cannot do

`fetch`, XHR, WebSocket, EventSource, `sendBeacon`, `importScripts`, dynamic `import()`, `eval`, `new Function`, nested workers from a URL, IndexedDB, Cache,
`localStorage`, `window`/`document`/`parent`, the clipboard, navigation, popups. Do not design around them; there is no prompt that grants them.

## Kinds not built yet (coming)

Renderers, editors, painters (need a drawing surface in the frame) and `palette-actions` `run` (the kind has no adapter): until they exist they stay `blocked`.
