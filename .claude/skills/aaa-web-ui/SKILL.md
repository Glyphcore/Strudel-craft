---
name: aaa-web-ui
description: Build immersive, ergonomic, AAA-grade static web apps for Strudel-craft's GitHub Pages: a music instrument feel, not a template site.
---
# AAA web UI for Strudel-craft
Bar: feels like a pro instrument/game UI (Ableton Push, Teenage Engineering, AAA game menus), not a docs page or a Tailwind template.

## Principles
- Instrument first: every screen is playable. Audio starts from one obvious control; transport, tempo, level meters always visible.
- Live feedback: real-time visuals driven by audio (WebAudio AnalyserNode): spectrum, scope, per-layer meters, pattern timelines with a moving playhead. 60 fps on mid phones; degrade gracefully.
- Direct manipulation: knobs/sliders/XY pads with drag, wheel, keyboard and touch; values shown in real units (Hz, dB, ms, semitones). Undo.
- Ergonomics: phone-first thumb zones, 44px targets, one-hand transport; keyboard shortcuts on desktop with a cheat sheet; focus states; reduced-motion respected.
- Identity: a deliberate visual language (own type pairing, a dark studio palette with a light mode, lighting/glow used for signal, not decoration), consistent motion curves, sound-reactive accents. No stock gradients, emoji or generic cards.
- Performance: no framework unless it earns its weight; canvas/WebGL for visuals; lazy-load Strudel; bundle under 300 KB excluding Strudel.
- Robust: no console errors; works offline after first load where possible; graceful messages when audio is blocked.
## Process
1. Issue with acceptance: Lighthouse perf/accessibility >= 90 on mobile, no console errors (node test), phone and desktop screenshots, frame time measured during playback.
2. Design note in the issue: layout sketch (ASCII), interaction map, visual tokens.
3. Build in site/, test with Playwright (engine/strudel test_site style), screenshots at 390px and 1440px.
4. Critic re-runs the checks; deploy via the Pages workflow.
- UI dialogs: never use native alert()/prompt()/confirm(); inputs/confirms use the site modal component, notices use toasts. User directive 2026-11-13.
