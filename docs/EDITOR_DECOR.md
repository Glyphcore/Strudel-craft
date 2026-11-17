# Editor decorations: decorated first paint and style atoms (#170)

## 1. No undecorated frame
- `style.css`: `#code, #stackCode { color: transparent; caret-color: var(--sig-2) }` from the first byte of CSS. The textarea's text is
  never painted plain while the decorator is missing. If nothing decorates it within 6 s (both `decor.js` and the editor failed), a 0 s
  animation with a 6 s delay shows it plain, so the code is never lost.
- `site/decor.js` is the first module of the deferred set (index.html `LATER`, not in the eager shell; `tests/site/shell_budget.mjs`). It
  wraps each textarea in `.sc-pd-wrap` and lays a `<pre class="sc-pd">` over it. The pre gets the textarea's font, padding and size,
  follows its scroll, and repaints on `input` and on a `value` set. Its token colours are the editor's highlight colours (`lex(text)` ->
  `[from, to, kind]`, kinds `str num kw fn var com pun ws`). If CodeMirror cannot load, the overlay stays, so the plain editor is decorated too.
- `intellisense.js` calls `decor.release(ta)` in the same task that creates the `EditorView`, so no frame falls between the overlay and
  the editor. CodeMirror's first render already carries the syntax highlight and the token identity layer (section 2).
- Cache: the editor's data (typed param shapes `params`, intellisense docs `docs`) lives in IndexedDB `sc-decor` (store `b`), keyed by
  name. Each entry carries the build hash (`build.json` sha) and a hash of the pack set (`localStorage sc.packs.lock` + `sc.packs.prefer`).
  On a hit, the editor mounts from the cache and the packs refresh the entry in the background. When the cache opens, entries of another
  build are dropped. `strudelCraft.decor.stats()` -> `{ hits, misses, puts, dropped, errors, overlays }`.
- Grammar tables are the lezer JavaScript grammar inside the pinned CodeMirror module graph. The service worker snapshot holds that graph
  (`precache.json` cdn) with `decor.js` and `style-atoms.js`, which cover offline. Lint rules: none exist, because the editor reports
  runtime errors only (`live:error`).

## 2. Identity in the code DOM, state in style atoms
- Identity: `tokField` (intellisense.js) gives every token of a line (`/[ \t]+|[\w$#]+|[^\s\w$#]/u`) a mark span with `data-tok`, and
  every line a `data-ln`. A line-state gutter (`.cm-sc-state`) holds one marker per line with the same `data-ln`. Ids are new only for
  the lines a transaction changes; elsewhere they are mapped through the edit. A state change never writes them.
- Style atoms (`site/style-atoms.js`): `atom(name)` returns `{ set(key, rule), delete(key), has, keys, size, clear(), replace(entries),
  remove() }`. Each atom is one constructable stylesheet in `document.adoptedStyleSheets` (a `<style data-atom>` in `<head>` where that
  is unsupported). There is one atom per concern. A state change inserts or deletes the rules for that concern only.
  `strudelCraft.styleAtoms.list()` and `.sheets()` audit the registry.
- Features converted (all former class or decoration toggles in a code area):

| feature | before | now (atom) |
|---|---|---|
| playback highlight of active events (visuals.js) | `hlField` decoration set per change, `.cm-sc-active` + inline style | `editor-playhead:<editor>`, one rule per token under each active event, `.color()` kept (plain colour tokens only) |
| reference inspector marks (refs.js, perform.js) | `refField` marks `.cm-ref-primary` / `.cm-ref-related`, gutter class `.cm-ref-gutter` | `editor-refs:<editor>`, token rules + line-state gutter rules |
| runtime error line (live:error / live:ok) | `@codemirror/lint` diagnostics: range mark + lint gutter marker | `editor-error:<editor>`, wavy underline on the `data-ln` line + red gutter marker; hover tooltip with the message |
| bracket matching | CodeMirror `bracketMatching` (`.cm-matchingBracket` marks on caret moves) | `editor-caret:<editor>` |
| selection matches | CodeMirror `highlightSelectionMatches` | `editor-caret:<editor>` |
| active line / active line gutter | CodeMirror classes on caret moves (themed invisible) | removed |
| Graph code pane selection sync (graph.js) | the mirror's innerHTML rewritten with `<mark>` on every selection | the mirror is written once per text change with `data-sp` statement spans; `graph-code-sel` holds one rule per selected id |

- Tests and tools read what the atoms show with `strudelCraft.intellisense.decorState(editorId)` ->
  `{ active[], primary, related[], refId, error: { line, message }, atoms: { playhead, refs, error, caret } }`.
- Rejected: per-span inline styles (the same churn), one global stylesheet rewritten on every change (rule-set thrash), and custom
  properties on the container (they cannot target one token).

## 3. Measured
`node tests/site/decor_atoms.mjs --measure <siteDir>` plays 8 bars of `setcps(1)` (two synth lanes, 32-33 playhead changes per
run, 1280x900 Chromium) and reports the CDP `Performance.getMetrics` deltas in ms. Below are medians of 6 runs per site (two invocations of 3):

| site | scripting | style | layout | total |
|---|---|---|---|---|
| before #170 (7795f06) | 505 | 14 | 102 | 627 |
| after #170 | 364 | 81 | 83 | 528 |

The scripting time drops because a playhead change is no longer a CodeMirror transaction that re-renders lines. Layout drops for the
same reason. The style time rises: in Chromium a change to any stylesheet costs a tree walk proportional to the document (about 1 to
2 ms per change on this page; id and attribute selectors cost the same, measured), whereas a class toggle restyles one element. The net
main-thread time over 8 bars falls by about 16 %, and the code DOM no longer changes during playback. Runs are noisy (totals
548-794 before, 492-801 after), because the audio scheduler shares the main thread.
