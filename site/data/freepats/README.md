# glyphcore/freepats: three CC0 instruments

Selection via the openDAW factory catalogue (https://opendaw.studio/). Audio bytes come from the upstream FreePats archives, not from openDAW's servers.
Sound names: `fp_harp`, `fp_organ`, `fp_xylophone` (pitched maps; `note("c4").s("fp_harp")`). Lazy: loaded when the pack's sounds ingredient is activated or a recipe needing it plays.

| Instrument | Upstream page | Archive (SHA-256) | SF2 bytes | Author / credit |
|---|---|---|---|---|
| Concert Harp | https://freepats.zenvoid.org/OrchestralStrings/harp.html | ConcertHarp-SF2-20200702.tar.xz a328faa1996369154f20f960dde2e255b96e823574d5cf80eb9e7f00aed6a150 | 18,810,604 | assembled by Roberto (roberto@zenvoid.org) from the Versilian Community Sample Library (Versilian Studios LLC, CC0); performer K. Smith |
| Drawbar organ emulation | https://freepats.zenvoid.org/Organ/electric-organ.html | DrawbarOrganEmulation-SF2-20190712.tar.xz 9b41fa8418f6f1a14924381bc6ccbddbb665bbec2b5f46d4ab549e8d88a2e178 | 6,505,320 | Roberto (roberto@zenvoid.org), recorded from setBfree |
| Xylophone (medium mallets) | https://freepats.zenvoid.org/ChromaticPercussion/xylophone.html | Xylophone-MediumMallets-SF2-20200706.tar.xz b142f2a25f0610f13d1d657c60ae3f28be58cf026d216826125c6fb9d1af631b | 4,244,686 | assembled by Roberto (roberto@zenvoid.org) from the Versilian Community Sample Library (Versilian Studios LLC, CC0) |

Licence text on each page: "Published under the terms of the Creative Commons CC0 1.0 public domain dedication."

Not in this pack (blocked): Spanish classical guitar and Upright Piano KW. FreePats publishes them only as .7z (no tar variant of the same CC0 bank), and no extractor is available here. Tracked on issue #181.

Reduction (tools/freepats/extract.py): one velocity layer (the zone holding velocity 100), the SF2's own root-key zones (every 3 to 6 semitones), cut to 8 s (harp), 4 s (organ, loop unrolled), 3 s (xylophone) with a 150 ms fade, mono ogg vorbis q4 at 44.1 kHz.
