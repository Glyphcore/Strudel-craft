# Strudel Craft (static site)

Plain HTML, CSS and JS. No build step, no dependencies to install. Pages: catalog (`index.html`), compose (`compose.html`), plugin reference (`plugins.html`), best practices (`practices.html`). Data lives in `data/*.json`.

- Live player: `@strudel/web` 1.3.0 loaded from unpkg when you tap Play (audio starts only from a button). Needs network access.
- "Open in strudel.cc" builds `https://strudel.cc/#` + `encodeURIComponent(btoa(UTF-8 code))`, the format the strudel.cc REPL itself writes (read from its bundle).
- Recipes marked "rendered ok" were rendered headless and were non-silent; sample-bank recipes could not be checked that way and show "not verified".

## Run locally
    python3 -m http.server 8000 --directory site     # open http://localhost:8000

## Regenerate the data
From the repo root (needs Node + Playwright Chromium for the headless check):

    python3 engine/strudel/build_catalog.py          # rewrites site/data/{catalog,plugins,practices}.json
    python3 engine/strudel/build_catalog.py --no-render   # skip the render check (all recipes then show unverified)

Sources: `docs/strudel/{RECIPES,PLUGINS,BEST_PRACTICES}.md` and `engine/strudel/recipes_extra.py`.

## Deploy to GitHub Pages
Option A, from a folder: Settings > Pages > Source "Deploy from a branch", branch `main`, folder `/site`
(GitHub only offers `/` or `/docs`; if `/site` is not offered, use option B or copy `site/` to `docs/`).

Option B, workflow: copy `.github/workflows/pages.yml` into the target repo (it publishes the `site/` folder), then Settings > Pages > Source "GitHub Actions". Push to `main`.

All links are relative, so it works under `https://USER.github.io/REPO/`.

## Tests
    node engine/strudel/test_site.mjs                # serves site/, checks console errors, plays a recipe, screenshots
