# Schemas

JSON Schema (draft 2020-12) for the craftpack content-pack format. Design and rules: `docs/PACK_SPEC.md`.

| file | validates |
|---|---|
| `craftpack/1/manifest.schema.json` | `craftpack.json`, the manifest at the root of a pack |
| `craftpack/1/lock.schema.json` | `packs.lock.json`: resolved, pinned packs (commit + manifest hash) |
| `craftpack/1/packs.schema.json` | `packs.json`: what a site or project asks for, before resolution |
| `craftpack/1/registry.schema.json` | a registry index listing packs and versions |
| `craftpack/1/kinds/<kind>.1.schema.json` | the entry file of an ingredient with `format: "<kind>@1"` |
| `craftpack/1/kinds/vox-bank.words.1.schema.json` | the words file a `vox-bank` descriptor points to |
| `craftpack/1/kinds/index.json` | kind list: formats, code policy (`never`, `optional`, `always`), palette ops |
| `recipe.v1.json` | a recorded take as a recipe (capture state + pinned deps + audio output hashes), docs/CAPTURE.md |
| `craftpack/1/examples/` | a `glyphcore/core` manifest built from today's `site/data`, a vox bank manifest, `packs.json`, a lock, a registry |

- The folder number is the spec major; the number in a kind file name is that kind's format major. Minor versions are additive and edit the file in place.
- Schemas are strict (`additionalProperties: false`); keys starting with `x-` are free for extensions.
- What a schema cannot express is checked by the validator (`strudel packs validate`, issue #65): hashes match the bytes, paths stay inside the
  pack root, `format` matches `kind`, `requires` names declared dependencies, item ids are unique per kind, model documents in `hooks` and
  `components` also pass `site/data/schema/model.v1.json`.
- Example hashes of entry files that do not exist yet (split or new files) and the commit in the example lock are illustrative;
  `strudel packs hash --write` and `strudel packs lock` produce the real ones. The core example carries `LicenseRef-undecided` until #66 is decided.
- The published `$id` base is `https://glyphcore.github.io/Strudel-craft/schemas/craftpack/1/` (served once #65 adds the deploy step).
