# CraftCues: score annotations in bars (issues #162 format + tools, #163 site UI, #164 examples + integration)

Terse, timed, machine-readable notes on a Craft program or its audio: what a section does, the role of a layer, which concept a passage uses,
where a motif returns, where tension resolves. Each cue points to the knowledge base (KB) by id, so the body stays short and the detail lives
in one card. The text form works like subtitles (WebVTT / SRT) but keeps bars, scopes and links, and converts to WebVTT so any audio player
shows the cues as captions.

## 1. One cue line, two containers
```
TIME [KIND] [@SCOPE] [: BODY] [| TOKENS]...
17-24 motif @bell: bell hook *enters*, no pre-echo | MOT-05 FS-01 | prepares:drop-c | conf=0.8 src=author
```
- **Sidecar** `.craftcues` (`.crafcues` is read as an alias): a `CRAFTCUES 1` line, `key: value` header lines, a blank line, then blocks separated by
  blank lines. A block is an optional id line, the cue line, body lines, and `|` token lines. `NOTE ...` blocks are free comments (kept).
- **Inline** in a Craft program: `//@ <cue line>` at the end of a line or on its own line, and `/*@ ... */` with one cue per line. The #142
  comment masker (`site/engine/comments.js`) blanks them like any comment, so a cue never reaches the code; `//@` inside a string, template
  literal or regex is not a cue. `//@! key: value` sets a header value (e.g. `//@! sections: intro 1-8, drop-a 9-24`).

Grammar (EBNF; whitespace between tokens is free):
```
file      = magic NL { header NL } NL { block NL+ }
magic     = "CRAFTCUES" [ " 1" ] [ text ]
header    = key ":" value                     ; track, title, program, bars, bpm, beats, offset (s of bar 1), sections, any other key
sections  = name range { "," name range }     ; intro 1-8, drop-a 17-32
block     = note | [ id NL ] cueline { NL ( bodyline | tokline ) }
note      = "NOTE" text { NL text }
id        = letter { letter | digit | "_" | "." | "-" }
cueline   = time [ kind ] [ scope ] [ ":" body ] { "|" tokens }
time      = span [ "=>" span ] | motif "@" span "->" [ motif ] "@" span | "*" | "sec:" name
span      = point [ "-" point ]
point     = bar [ "." beat ] | seconds "s" | minutes ":" seconds
kind      = section | layer-role | concept | motif | tension | release | transition | dovetail | call-response | clash | resolution
          | density | feel | mix-note | todo | lesson | foreshadow | callback | note
scope     = "@" ( "track" | "sec:" name | layer { op layer } )   ; inline sugar: NAME lane:  ==  @NAME
layer     = lane | "tag:" tag | "bus:" bus ;  op = "," (list) | "->" (migration, handoff) | "+" (together, doubling) | "~" (against, interplay)
tokens    = { ref | rel ":" id | key "=" value | key "=" '"' text '"' }
rel       = resolves | echoes | prepares | contrasts | answers | varies
tokline   = "|" tokens { "|" tokens }       ; bodyline = any non-blank line not starting with "|" (write "\|" for a literal leading pipe)
```

### Time
Bars are 1-based and inclusive; 1 cycle = 1 bar here (`setcpm(bpm / 4)`). `17` is bar 17, `17-24` bars 17 through 24 (span [17, 25)),
`17.3-18.1` beat 3 of bar 17 through beat 1 of bar 18, `12.5s-20s` or `0:12.5-0:20` absolute seconds (audio; needs `bpm` and `offset`
to place), `*` the whole track, `sec:drop-a` a section of the header. Cross-bar pairs: `9-12 => 17-24` (foreshadow, payoff) and the callback
sugar `M9@17 -> M9@49` (stored as `17 => 49` with `motif=M9`).

### Tokens
- **KB refs**: `MOT-05` `FS-02` (composer catalog, docs/COMPOSITION.md), `syntax:<id>` (Syntax view), `hook:` `atom:` `lane:` `slot:` `bus:`
  `tap:` `control:` `vox:` `import:` `pack:` (the Resources ids, docs/RESOURCES.md), `genre:<id>` (docs/genres), `fb-<16 hex>` (form bank,
  docs/FORM_BANK.md), `form:<role>` (form-bank role labels), http(s) URLs.
- **Relations** `resolves:` `echoes:` `prepares:` `contrasts:` `answers:` `varies:` + a cue id.
- **Meta** `key=value`: `id`, `conf` (0..1), `src` (`author` | `inferred` | `analysis`), `method` (bank provenance words: `ledger`, `density`,
  `foreshadow`, `score`, `inferred-from-project-data`, `analysed-from-audio` ...), `tool`, `motif`, `more` (long-form URL), any other key.
- **Emphasis** `*word*` (bold in captions). Bodies are terse: lint warns past 140 characters; put the detail in a KB card or `more=`.

### Inline defaults (line -> bar mapping)
A `//@` without a time takes the bars of the enclosing `arrange([N, pat], ...)` segment (cumulative from bar 1), else of the last
`// == name a-b ==` marker above it, else the whole track. Without a scope it takes the lane labelled on that line (`bell: ...`) or on the
next code line. The header comes from `// @daw bars=N`, `setcpm(X / 4)` / `setcps(x)`, a section-map comment (`// intro 1-8 | build 9-16 | ...`)
and `//@!` lines; `--form form.json` on the CLI adds sections and bars.

## 2. JSON (schemas/craftcues.v1.json)
`{ format: "craftcues@1", header, notes, cues: [{ id, at, pair?, kind, scope, body, refs, rel, meta, span, pspan? }] }`; `span` is derived
([from, to) in bar positions). Text -> JSON -> text is exact on canonical text (the printer's output; ids always written, meta keys sorted,
bodies without blank lines).

## 3. Tools
Engine: `site/engine/cues.js` (pure ES module, shared by site and CLI: `parse`, `print`, `parseLine`, `printLine`, `extract`, `programHeader`,
`lint`, `merge`, `toJSON`, `fromJSON`, `toVTT`, `toSRT`, `fromVTT`, `fromBank`, `spanOf`, `activeAt`, `completeCue`); KB resolver
`site/engine/cues-kb.js`. CLI `node tools/craftcues/cues.mjs`:
```
parse|json IN            canonical JSON          print IN      canonical .craftcues      extract PROGRAM.js [-o OUT]   inline cues as .craftcues
lint IN... [--kb] [--program P] [--json] [--strict]       merge IN... [-o OUT]           vtt|srt IN... [-o OUT] [--all] [--todo]
from-bank BANK.jsonl [--source-sha S]                     kb ID...                       at IN BAR (cues active at a bar)
header options: --form form.json --bpm B --bars N --beats N --offset S --track NAME;  IN = .craftcues / .crafcues / .json / .vtt / program .js
```
suno-track-lab twin: `engine/craftcues/run.sh` (same commands, plus `emit.py` for Python analysis tools).

**Lint**: errors `E_MAGIC` `E_TIME` `E_SCOPE` `E_META` `E_ID` `E_KIND` `E_DUP_ID` `E_ORPHAN` (relation to no cue); warnings `W_KB` (unknown KB
id; a form-bank id without a loaded bank is `not-loaded`, not unknown), `W_OUTSIDE` (outside 1..bars), `W_LONG` (> 140 chars), `W_OVERLAP`
(sections overlap), `W_CONFLICT` (tension and release, or clash and resolution, overlap on the same scope), `W_SECTION`, `W_LANE` (with
`--program`), `W_UNPLACED`, `W_REL_ORDER`. Exit 1 on errors.
**Merge**: by id; `author` beats `analysis` beats `inferred`, ties keep the first; exact duplicates (kind, scope, time, body) dropped.
Generated cues use deterministic ids `g-<tool>-<hash>` so a rerun replaces, never duplicates.
**Captions**: seconds = offset + (bar - 1) x beats x 60 / bpm; payload `[kind @scope] body (refs)`; a pair gives a second cue `id.2` at the
echo span; whole-track (`*`) cues go into the leading NOTE; `todo` cues only with `--todo`. Cue order is the WebVTT text track order.

## 4. KB resolver
`makeKB({ composition, syntax, genres, formBank, resource })` -> `resolve(id)` -> `{ id, kb, status: resolved | unknown | unchecked | not-loaded,
title, def, link }`. Links: composition `#syntax=mot-05`, syntax `#syntax=<id>`, Resources ids `#res=<id>`, genres and form bank the docs.
The CLI loads site/data/composition.json, syntax.json, docs/genres/*.json, the shipped pack catalogs (hooks, atoms, vox banks) and the form bank
(`$FORM_BANK`, default `$SUNO_TRACK_LAB/data/form-bank/bank.jsonl`; absence tolerated). Genres are read from `$SUNO_TRACK_LAB/docs/genres/*.json`
(default `SUNO_TRACK_LAB=/home/user/suno-track-lab`; wavephonk, dubstep-ukf ...) and then this repo's docs/genres (same id: this repo wins). `cues.mjs kb MOT-05 hook:cowbell` prints the cards.

## 5. Generated cues
Analysis tools emit cues with `src=inferred` or `analysis` and `method` / `tool`: suno-track-lab `engine/composer/run.sh ... --cues OUT`,
`engine/genre/score.py ... --cues OUT`, `engine/craftcues/run.sh from-bank` (form-bank records carry `conf` and `method` through). Merge them
with the authored set; the authored text wins by id.

## 6. Site (#163)
Lazy only (`site/cues.js` entry in the deferred list; `cues-ui.js`, `cues.css`, the engine and the KB load on first use; eager shell unchanged).
- **Captions strip** above the transport while a program with cues plays: the bar, chips of the cues active at that bar, and a thin timeline lane
  with every span, section ticks, the playhead and arcs for cross-bar pairs, relations and cross-layer scopes. The arcs live only in this strip
  timeline lane; the Rack, Graph and Record timelines do not draw them. Highlight: when the Graph view shows the program that is playing (its text
  equals the playing source), the track nodes (`.gn-head[data-node="track:<lane>"]`) and Lanes cards (`[data-lane]`) of the lanes a cue names get
  `[data-cue-hot]`; `@tag:x` resolves to every lane carrying tag x (`.tags(...)`, the Lanes scan), `@bus:x` names no lane. A Graph showing another
  program, and the Rack view (it has no lane rows), are not highlighted. A chip press opens the cue's KB card in the site modal; nothing in the editor moves. "Go to code"
  on the card of an inline cue is the deliberate jump. Hide with the strip's x or Ctrl+K "Captions on / off".
- **Score sheet** (`Score` button in the editor heads, Ctrl+K "Show score cues", `#cues`): cues by section, kind pills, layer and concept filters,
  Edit (site modal; an inline cue is rewritten in place as one editor change: the span comes from the #142 comment ranges, so a `//@` inside a
  string is never touched, and a `/*@ */` cue rewrites its own line of the block; when the editor does not show the playing program the edit is
  refused with a toast, never saved as a hidden local copy), Add cue at the current bar (stored in this browser, or written into
  the code as a `//@` line), Import `.craftcues` / `.vtt` / JSON, Export `.craftcues` / `.vtt` / JSON.
- Sources merged by id: cues edited in this browser (localStorage `sc.cues.<program>`), inline `//@`, shipped sidecars (`site/data/cues/index.json`
  matches a recipe id or the program's first line; built by `node tools/craftcues/build_site.mjs`).
- **Quick play** (#150): an example whose code carries `//@` cues shows the strip on the audition clock.
- **Resources** (#160): a `Cues` section lists the KB ids the cues reference, resolved, with their cards.
- **Record**: a take stores the cues (`cues` in schemas/recipe.v1.json, optional) and the WAV download writes a `.vtt` next to it, timed to the take.
- **Intellisense** inside `//@`: kinds after the time, `@` scopes (lanes, sections), KB ids / relations / meta after `|`.

## 7. Examples
`docs/tracks/night-phonk-demo/track.v2.craftcues`, `docs/tracks/edm-dubstep-tutorial/track.craftcues` (the 11 lessons as `lesson` cues),
`docs/tracks/dnb-electro-tutorial/track.craftcues`. Tests: `node tests/cues/cues.mjs` (schema, 500-doc round-trip fuzz, torture extraction with the
masker, lint rules, KB, CLI), `node tests/cues/vtt_browser.mjs` (Chromium's WebVTT parser), `node tests/site/cues.mjs` (390 px touch UI).
