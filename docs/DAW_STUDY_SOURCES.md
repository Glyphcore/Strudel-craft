# DAW study sources: what was found, analysed and refused, per genre

Issue #154; rules docs/RESEARCH_ETHICS.md; tool docs/DAW_STUDY.md. Accessed 2026-11-16. Every analysed file is listed in
`docs/dawstudy/fetch-log.json` (file, licence, genre, stats path) and has a stats file with full provenance (URL, LSP page, author,
licence, sha256); no project file is kept. `python3 tools/dawstudy/dawstudy.py check docs/dawstudy` validates them.

## 1. Sources searched
| source | basis | result |
|---|---|---|
| LMMS repository `data/projects/{demos, demos/CapDan, demos/Skiessi, shorties}` (raw.githubusercontent.com) | per-folder LICENSES.TXT names each file's licence and its LMMS Sharing Platform page; the project ships them for users to open | **used**: allowed licences (CC-BY, CC-BY-SA, Artistic 2.0, BSD) analysed; NC / ND / "Yellow openmusic" refused; a file whose LSP page states a stricter licence than LICENSES.TXT refused (the stricter wins) |
| LMMS Sharing Platform (lmms.io/lsp) | per-file licence on each page (Creative Commons variants, GPL, Artistic, "Copyright") | **metadata only**: genre (subcategory), author, licence cross-check, read at the robots.txt Crawl-delay (120 s). Bulk downloading is **not** done: robots.txt disallows `/lsp/download_file.php`. The site lists Industrial, Metal, Rock, Drum'n'Bass, House, HipHop, Hardcore projects (25+ each, many CC-BY), so a user downloading chosen CC-BY files by hand and handing them over (as their own study copies) would be the way to scale this |
| Ableton Live demo sets / Packs | Ableton licence: content for use in the licensee's productions | **not analysed**: need an installed, licensed Live; none here. Gap |
| FL Studio demo projects | Image-Line EULA, ship with the installer | **not analysed**: no installer / licence here. The FLP reader is tested on our synthetic fixture only (UNVERIFIED on real files). Gap |
| Producer "free FLP / project file" pages (phonk, trap, dubstep YouTube / Gumroad releases) | usually "free download" without written study or redistribution terms | **refused** (a download is not a licence, RESEARCH_ETHICS 1); none found with explicit terms in this pass |
| GitHub repos of Ableton projects | licence per repo | one candidate (an album of Ableton sets) has no licence file: all rights reserved, **refused**; others are tools (MIT), not songs |
| Bitwig / Reaper / Ardour / Zrythm templates | vendor templates are track layouts, not songs | not useful for form statistics; not analysed |
| The user's own projects | owner | none provided yet |

## 2. Per genre
| genre | analysed (licensed) | refused / gap | basis in FORM_PROFILES.md |
|---|---|---|---|
| phonk | **none found** | no licensed phonk project in any searched source | producer-reported / design call (docs/CONVENTIONS.md 3, suno-track-lab genre files) |
| dubstep / industrial | **none** (LSP has an Industrial category, not downloadable automatically) | gap | genre convention + design call (EDM_REFERENCES, INDUSTRIAL_REFERENCES) |
| DnB | 1 (CapDan-TwilightArea, CC-BY-SA, 170 bpm) | n < 3; `DnB.mmpz` and `sv-DnB-Startup` have no licence entry (refused) | indicative measured + producer-reported (DNB_ELECTRO_REFERENCES) |
| house / electro / trance / eurodance | trance 2, eurodance 1 (Artistic 2.0); house / electro none | n < 3 per genre; a mixed electronic pool (trance, eurodance, DnB, hip-hop) has n = 5 | indicative measured + producer-reported |
| trap / hip-hop | hip-hop 1 (Artistic 2.0) | n < 3 | indicative measured + producer-reported |
| rock | **none** | gap | design call (ROCKMETAL_REFERENCES) |
| metal | 1 (Artistic 2.0, "80s" metal / hard-rock demo) | n < 3 | indicative measured + design call |
| other (funk 1, pop 1, reggae 2, ambient 2, classical 1, covers 1, chiptune 1, misc 3, unclassified 3) | see fetch-log.json | | not used for the target genres |

Totals: 21 projects analysed (licences: Artistic 2.0 13, CC-BY-SA 6 incl. 4.0 / "by sa" spellings, CC-BY 1, BSD 1), 6 refused by licence
(4 NC variants, 1 Yellow OpenMusic, 1 where the LSP page licence was stricter than LICENSES.TXT).

Files in the LMMS folders without a LICENSES.TXT entry (e.g. AngryLlama-NewFangled, Ashore, DnB, Shovon-ProgressiveHousePluckDemo,
StrictProduction-DearJonDoe, TobyDox-Psycho, Skiessi-RandomProjectNumber14253, Skiessi-TurningPoint) are **refused** (no licence record,
fail closed), although the repository as a whole is GPL: a per-file statement is what RESEARCH_ETHICS asks for.

## 3. Limits of the data (honest)
- LMMS projects rarely have markers: sections are inferred from the active-role set (DAW_STUDY 3); the labels (intro, peak, breakdown,
  body, outro) describe density, not the author's intent.
- Track roles come from track names and plug-in names; many demo tracks have names like "TripleOscillator" (role `other`).
- n = 1 per target genre: profiles are indicative examples, not distributions. No number in FORM_PROFILES.md is presented as a genre
  norm unless n >= 3 (none is).
- Rendered with the LMMS 1.2.2 binary (a separate GPL program, heavy load gate, WAVs deleted after triage): all 21; project-data section
  boundaries matched by audio boundaries within one bar 47 / 128 (37 %, FORM_PROFILES.md section 1).
