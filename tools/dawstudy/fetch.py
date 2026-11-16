#!/usr/bin/env python3
"""Fetch licensed DAW projects, keep statistics only (docs/RESEARCH_ETHICS.md). The project file goes to a temporary directory
outside the repo, is hashed, parsed and deleted in the same run; the repo keeps <out>/<genre>/<slug>.stats.json + .md and
<out>/fetch-log.json (analysed and refused entries with reasons).

  fetch.py lmms-repo --dirs demos demos/CapDan demos/Skiessi shorties --out docs/dawstudy [--delay 120] [--ref master]

Source lmms-repo: the LMMS repository ships demo projects with a LICENSES.TXT per folder (file, licence, LSP page). The licence
there is classified (common.licence_class, fail closed); allowed files are downloaded from raw.githubusercontent.com; the genre
(subcategory) and author are read from the cited LMMS Sharing Platform page, respecting its robots.txt Crawl-delay (120 s) and
never touching /lsp/download_file.php (disallowed there)."""
import argparse, datetime, hashlib, html, json, os, re, shutil, sys, tempfile, time, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import common, dawstudy

UA = {"User-Agent": "dawstudy/1.0 (structure statistics for study; no redistribution)"}
RAW = "https://raw.githubusercontent.com/LMMS/lmms/%s/data/projects/%s"
GENRES = {"drum'n'bass": "dnb", "house": "house", "trance": "trance", "hiphop": "hiphop", "industrial": "industrial", "metal": "metal",
          "rock": "rock", "hardcore": "hardcore", "eurodance": "eurodance", "chiptune": "chiptune", "ambient": "ambient", "pop": "pop",
          "reggae": "reggae", "funk": "funk", "classical": "classical", "covers": "covers", "blues/jazz": "jazz", "misc": "misc"}

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read()

def licences(text):
    out = []; cur = None
    for line in text.splitlines():
        m = re.match(r"\*\s+(.+?)\s*$", line)
        if m: cur = {"file": m.group(1), "licence": None, "page": None}; out.append(cur); continue
        m = re.match(r"\s+-\s+(.+?)\s*$", line)
        if m and cur is not None:
            v = m.group(1)
            if v.startswith("http"): cur["page"] = v
            else: cur["licence"] = v
    return out

def lsp_meta(url):
    h = get(url).decode("utf-8", "replace")
    crumbs = re.search(r'<h3 class="lsp-title">(.*?)</h3>', h, re.S)
    parts = [p.strip() for p in re.sub(r"<[^>]+>", "|", crumbs.group(1) if crumbs else "").replace("&nbsp;", "").split("|") if p.strip()]
    sub = parts[2] if len(parts) >= 4 and parts[1] == "Projects" else None
    by = re.search(r"<small>by <a[^>]*>\s*([^<]+?)\s*</a>", h)
    t = re.sub(r"<[^>]+>", " ", h); t = re.sub(r"\s+", " ", t)
    lic = re.search(r"License:\s*(?:&nbsp;)?\s*(.+?)\s+LMMS Version", html.unescape(t))
    ver = re.search(r"LMMS Version:\s*(?:&nbsp;)?\s*([0-9.]+)", html.unescape(t))
    return {"genre_raw": html.unescape(sub) if sub else None, "author": html.unescape(by.group(1)) if by else None,
            "licence_lsp": lic.group(1).strip() if lic else None, "lmms_version": ver.group(1) if ver else None}

def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", choices=["lmms-repo"]); ap.add_argument("--dirs", nargs="+", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--delay", type=float, default=120.0); ap.add_argument("--ref", default="master"); ap.add_argument("--limit", type=int, default=0)
    o = ap.parse_args()
    today = datetime.date.today().isoformat(); log = {"source": "LMMS repository data/projects (ref %s) + LMMS Sharing Platform pages" % o.ref, "accessed": today, "analysed": [], "refused": []}
    lp = os.path.join(o.out, "fetch-log.json")
    if os.path.exists(lp): log = json.load(open(lp)); log["accessed"] = today
    done = {e["file"] for e in log["analysed"] + log["refused"]}
    tmp = tempfile.mkdtemp(prefix="dawstudy_fetch_"); last = 0.0; n = 0
    try:
        for d in o.dirs:
            for e in licences(get(RAW % (o.ref, d + "/LICENSES.TXT")).decode("utf-8", "replace")):
                if e["file"] in done: continue
                cls = common.licence_class(e["licence"])
                if cls is None:
                    log["refused"].append({"file": e["file"], "dir": d, "licence": e["licence"], "reason": "licence not allowed or unknown (RESEARCH_ETHICS.md 1)"}); continue
                meta = {}
                if e["page"] and "lmms.io/lsp" in e["page"]:
                    wait = o.delay - (time.time() - last)
                    if wait > 0: time.sleep(wait)
                    try: meta = lsp_meta(e["page"])
                    except Exception as ex: meta = {"error": str(ex)}
                    last = time.time()
                if meta.get("licence_lsp") and common.licence_class(meta["licence_lsp"]) is None:
                    log["refused"].append({"file": e["file"], "dir": d, "licence": e["licence"], "licence_lsp": meta["licence_lsp"],
                                           "reason": "the LSP page licence is not allowed (conflict with LICENSES.TXT: the stricter one wins)"}); continue
                name = e["file"] if re.search(r"\.mmpz?$", e["file"]) else e["file"] + ".mmpz"
                url = RAW % (o.ref, d + "/" + urllib.request.quote(name))
                try: data = get(url)
                except Exception as ex:
                    log["refused"].append({"file": e["file"], "dir": d, "licence": e["licence"], "reason": "download failed: %s" % ex}); continue
                p = os.path.join(tmp, "p" + os.path.splitext(name)[1]); open(p, "wb").write(data)
                prov = {"url": url, "page_url": e["page"], "author": meta.get("author") or name.split("-")[0], "title": name, "licence": e["licence"],
                        "licence_class": cls, "licence_lsp": meta.get("licence_lsp"), "accessed": today, "sha256": hashlib.sha256(data).hexdigest(),
                        "bytes": len(data), "format": "lmms", "parser": "tools/dawstudy/lmms.py", "kept": "statistics only",
                        "genre_source": "LSP subcategory" if meta.get("genre_raw") else "none (unclassified)", "lmms_version": meta.get("lmms_version")}
                try: s = dawstudy.stats_file(p, prov)
                except Exception as ex:
                    log["refused"].append({"file": e["file"], "dir": d, "licence": e["licence"], "reason": "parse failed: %s" % ex}); os.remove(p); continue
                os.remove(p)  # nothing of the project stays
                g = GENRES.get((meta.get("genre_raw") or "").lower(), "unclassified")
                od = os.path.join(o.out, g); os.makedirs(od, exist_ok=True); sl = slug(os.path.splitext(name)[0])
                open(os.path.join(od, sl + ".stats.json"), "w").write(json.dumps(s, indent=1) + "\n")
                open(os.path.join(od, sl + ".md"), "w").write(common.to_md(s, name))
                log["analysed"].append({"file": e["file"], "dir": d, "licence": e["licence"], "genre": g, "genre_raw": meta.get("genre_raw"), "stats": os.path.join(g, sl + ".stats.json"),
                                        "bars": s["length_bars"], "tempo": s["tempo"]})
                json.dump(log, open(lp, "w"), indent=1); n += 1
                print("analysed %s -> %s (%s, %s bars)" % (name, g, e["licence"], s["length_bars"]), flush=True)
                if o.limit and n >= o.limit: return 0
    finally:
        shutil.rmtree(tmp, ignore_errors=True); json.dump(log, open(lp, "w"), indent=1)
    return 0

if __name__ == "__main__":
    sys.exit(main())
