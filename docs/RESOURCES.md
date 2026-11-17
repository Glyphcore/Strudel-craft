# Resources pane: what the program uses, and what is available

Users and agents building Craft code both need to see what a program references (imported atoms, racks, taps, lanes, vox banks, packs) and what else is installed. One model answers both: `buildModel(code, host)` in `site/engine/resources.js` (pure ES module, comment-safe through `blankComments`, shared by the site and the CLI).

## Where it is
- Button **Resources** in the head of the Rack code and the Stack program editors (phone first: a bottom-sheet dialog, 390 px), `Ctrl+K > Show resources` (sheet), `Ctrl+K > Browse available resources` (sheet on Available), `Ctrl+K > Show Resources pane` and the workspace pane `resources` (desktop side panel, docs/WORKSPACE.md). Same panel component in both (`site/resources-ui.js`, `resources.css`); `site/resources.js` is the tiny lazy entry. Nothing loads before first open (the eager shell budget is unchanged: `node tests/site/shell_budget.mjs`).
- Deep link `#res=<kind>:<name>` (e.g. `#res=hook:kick808`, `#res=atom:ph.kick`, `#res=import:pack:glyphcore/phonk:atoms`) opens the sheet on that row; `#res=available:<query>` opens Available with the search filled; plain `#res` opens the sheet. The view underneath does not change.

## In this program
Rows by kind (filter pills with counts, "Problems only" toggle):
| kind | detected from | resolved against |
|---|---|---|
| import | `atoms.import("pack:author/pack:ingredient", { as })` | the pack lock: pack present and ready, ingredient exists; unused when none of its atoms is used |
| atom | `atoms.<name>` uses (the atoms engine, same as `strudel atoms refs`) | the atoms env (imports, `atom()` declarations, catalog); older ids show `older id` |
| hook | `hooks.def`, `hooks.bind(slot, hook, gate)`, `.hook("a \| b(0.3)")` | this program, the pack's `hooks@1` defs (winner by pack precedence), the registry, the standard library (hygiene racks, grooves) |
| slot | `.use("slot")` and the `hooks.bind` slots | used + bound = resolved; bound without a `.use` = missing; used without a bind = info |
| tap | `.tap("x")` (writer), `tap("x")` / `wire(p, "x")` (reader) | writer without reader = **unread** (#114); reader without writer = reads a Perform pad or pack tap (info) |
| bus | `.send("bus", n)`, `ret("bus")` | send without a `ret` = missing; `ret` nobody sends to = unused |
| lane | lane labels / `$:` lines (`engine/lanes.js` scan) | this program, with its tags |
| control | `ctl(name, {...})`, `slider(...)`, `hooks.map(ctl, param, opts)` | range, default and the params it maps to; a map without a declaration = missing |
| vox | `voxBank('name')`, `word("a b")` | the bank index (shipped banks, packs, your own); words are listed with the banks in use |
| pack | derived: every pack that supplies a resolved reference | the lock: `id@version`, licence, layer, state, code-bearing |
| lib | `"lib:name"` strings | library components (unknown when the library is not loaded) |
| groove | `.groove("name")`, binds to slots named groove / feel | standard library, registry, packs |

Each row: name, kind, **status chips**, source `pack@version · licence`, one-line description, params with range and default (typed shapes), and the lines it is used on.
Chips: `resolved`, `shadowed` (another pack defines the same name, the winner is used; #143), `older id` (alias of a renamed item; #120), `missing` (nothing provides it; with a **fix** such as `import pack:glyphcore/phonk:atoms` and, for atoms, an **Insert this import** button), `unused` (import or bus), `unread` (tap; #114), `code: needs allow` (a code-bearing ingredient; Packs sheet), `info`.
A compact banner at the top counts what is missing and jumps to the rows.

**Cues (#163).** When the program carries CraftCues score annotations (`//@` lines, a shipped sidecar or cues saved in this browser), a **Cues** section follows the rows: the knowledge-base ids the cues reference (MOT-05, FS-01, genre:x, ...) resolved to their KB cards (`site/cues-ui.js` `resourcesSection`, loaded only when the program has cues; docs/CRAFTCUES.md).

Presses (#107): a plain press on a row only expands it. Jumping to code is deliberate: the target button on the right of the row (shows the first line) or a line number in "Used at". Go to line closes the sheet (in the pane it stays), puts the caret on that line and scrolls it into view. Plain presses never scroll, focus or select in the editor.
The list is kept current: it refreshes (350 ms debounce) on typing, on the live compile events (`live:ok`, `strudel:idle`, `live:swap`) and on pack loader changes.

## Available
Every installed pack, then kind (atoms, hooks / racks, vox banks, recipes, ...), then items; the #120 organizer above the list (folder tree, tag chips with AND/OR, sort, appearance), plus a search box. An item row shows pack, version, licence, a description, tags and params; open it for the example in Craft and lowered form (`site/forms.js`, the lowered tab appears when `atoms.inline` writes the text out), and three actions:
- **Play** (#150 Quick play, `sc.quickplay.press(btn, () => spec)`): auditions the item's example without touching the program;
- **Insert reference**: one editor change at one place (`insertPlan` in `site/engine/resources.js`): an `atoms.import` or `await voxBank(...)` line after the last such line (else after the header run of `setcpm` / imports / comments); a `hooks.bind(...)` after the last bind; a block after the caret line. The selection, scroll and every other character stay; an identical line already present is not repeated (the reference is copied instead). The toast offers Go to line;
- **Copy**.

**Indexed recipes (#131).** A recipe row of the index carries no code (216 of 221 rows): the body is one lazy file per family. Expanding a recipe card shows a status row ("Loading recipe...") and fetches the family file once through `packs.recipeBodies(pack, 'bodies-<family>')` (hash-verified, one fetch per file however many recipes of that family you open); failure shows the message with **Retry** (also offline: a family not fetched yet fails with Retry, a fetched one keeps working). Then Craft / lowered tabs (the body's own `lowered`, `lowered_note`, `lowered_check`), Play and Insert reference work. Recipe code is a whole program, so Insert reference puts it in as a block after the caret line exactly as written (a bare expression gets `$: `). The model side is `applyBody(entry, body)` / `blockText(code)` in `engine/resources.js`.

## CLI twin
`strudel refs IN [--json] [--eval]` (suno-track-lab `engine/strudel-cli/lib/refs-cmd.mjs`) builds the same host from the atoms engine (`strudel atoms refs` side), the loaded packs (`--packs`, `--pack`) and, with `--eval`, the hooks registry pass, then calls the same `buildModel` (resolved from `$STRUDEL_CRAFT/site/engine/resources.js`). Text output groups by kind: name, `[status]`, `pack@version licence`, lines, description, params, fix; `--json` is the model the panel uses. Exit 1 when anything is unresolved. `--available [--q QUERY]` prints the Available list the same way (`available()`; recipes carry their code because the CLI pack loader merges the recipe bodies, #131). Test: `node tests/site/resources_model.mjs` (model, insert plan, CLI equality on night phonk v2).

## Files and tests
- `site/engine/resources.js` (model, `available`, `applyBody`, `insertPlan`, `renderText`, `renderAvailable`, `packsFacade`), `site/resources.js` (entry), `site/resources-ui.js`, `site/resources.css`; precached for offline (`tools/pwa/precache.mjs`).
- `node tests/site/resources_model.mjs` (unit + CLI twin), `node tests/site/resources.mjs [shot.png]` (390 px touch: opens, night phonk v2 rows, unresolved + live update, Insert without moving other text, no scroll on press, Go to line, palette, `#res=`, offline reopen; lazy recipe: one body fetch, code, Play, Insert, undo of the insert, offline failure + Retry; the Stack editor head button).
- Docs follow code: `site/data/syntax.json` section `resources`, intellisense entries `strudelCraft.resources.*`, `site/README.md`, docs/WORKSPACE.md.
