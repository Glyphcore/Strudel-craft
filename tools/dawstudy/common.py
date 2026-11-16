"""dawstudy common layer: one intermediate project form -> dawstudy-stats@1 (docs/DAW_STUDY.md).

Every parser returns a Project dict:
  {format, tempo, meter: [num, den], key, tracks: [Track], markers: [{name, beat}], automation: [{target, track, points: [[beat, value]]}],
   buses: [{name, kind, sends: [name], devices: [str]}], synth: [{role, attack_ms, decay_ms, release_ms, cutoff_hz}]}
  Track = {name, kind: instrument|audio|bus|return|group|master, plugin, devices: [str], sends: [str], sidechain: [str],
           clips: [{start, len, notes}]}   (start / len in quarter-note beats; notes = a count, never pitches or positions)
Names are used here only to classify a role and are dropped from the output (RESEARCH_ETHICS.md section 2)."""
import math, re, statistics

SCHEMA = "dawstudy-stats@1"

ROLE_WORDS = [  # first match wins; checked on lower-cased track name + plugin
    ("kick", r"kick|\bbd\b|bassdrum|bass drum|kicker|\bkik"),
    ("snare", r"snare|\bsd\b|clap|rim"),
    ("hat", r"hat|\bhh\b|cymbal|ride|crash|shaker|tamb"),
    ("perc", r"perc|tom|conga|bongo|cowbell|clang|metal|hit\b|impact|foley|clank"),
    ("drums", r"drum|beat|break|loop|kit|\bbb\b|beat\+bassline"),
    ("sub", r"\bsub"),
    ("bass", r"bass|808|reese|wobble|growl|lb302|riddim"),
    ("guitar", r"guit|gtr|riff|chug|distortion guitar|vibedstrings"),
    ("vox", r"vox|vocal|voice|choir|sing|speech|talk"),
    ("lead", r"lead|melody|solo|synth ?lead|screech|arp"),
    ("pad", r"pad|string|atmos|ambient|drone|choir"),
    ("keys", r"piano|keys|rhodes|organ|chord|stab|pluck|bell"),
    ("fx", r"\bfx\b|sfx|riser|sweep|noise|uplifter|downlifter|whoosh|reverse|sfxr|crash fx"),
]
DEVICE_WORDS = [
    ("sidechain", r"sidechain|side ?chain|duck|pump|lfotool|volumeshaper|kickstart|peak ?controller"),
    ("multiband", r"multiband|\bott\b|multi ?band|crossover|mb ?comp"),
    ("compressor", r"compress|comp\b|glue|reacomp|dynamics|leveler|dynamicsprocessor"),
    ("limiter", r"limit|maximi|clipper|soft ?clip"),
    ("eq", r"\beq|equali|parametric|eq8|eq3|channeleq|reaeq|bassbooster|crossovereq"),
    ("filter", r"filter|autofilter|dualfilter|lowpass|highpass|lp\b|hp\b"),
    ("distortion", r"distort|overdrive|saturat|waveshap|amp\b|amplifier sim|fuzz|drive|redux|saturator|pedal|tube|bitcrush|crush|decimat|lofi"),
    ("reverb", r"reverb|verb|room|hall|plate|convolution|reverbsc"),
    ("delay", r"delay|echo|multitap|pingpong|reaverb"),
    ("modulation", r"chorus|flanger|phaser|ensemble|vibrato|tremolo|rotary|autopan"),
    ("stereo", r"stereo|width|imager|utility|haas|spread"),
    ("gate", r"gate\b|transient|shaper"),
    ("pitch", r"pitch|tune|vocoder|formant|frequency ?shift"),
    ("amp_cab", r"cab|cabinet|amp ?sim|guitar ?rig|amplitube"),
    ("gain", r"gain|amplifier|volume|trim"),
]
SECTION_WORDS = [("intro", r"intro|start"), ("build", r"build|riser|pre-?drop|pre-?chorus|lift"), ("drop", r"drop"),
                 ("chorus", r"chorus|hook|refrain"), ("verse", r"verse"), ("breakdown", r"break"), ("bridge", r"bridge|middle 8"),
                 ("solo", r"solo"), ("outro", r"outro|end|fade")]
AUTO_WORDS = [("volume", r"vol|gain|level|amp"), ("cutoff", r"cut|freq|fcut|filter"), ("resonance", r"res|\bq\b|fres"),
              ("pan", r"pan|balance"), ("send", r"send"), ("tempo", r"tempo|bpm"), ("pitch", r"pitch|tune|detune"),
              ("wet", r"wet|mix|dry"), ("mute", r"mute|enable|on"), ("macro", r"macro")]

def _classify(text, table, default):
    t = (text or "").lower()
    for k, rx in table:
        if re.search(rx, t): return k
    return default

def role_of(name, plugin=""):
    return _classify("%s %s" % (name or "", plugin or ""), ROLE_WORDS, "other")

def device_type(name):
    return _classify(name, DEVICE_WORDS, "other")

def section_role(name):
    return _classify(name, SECTION_WORDS, "other")

def auto_target(name):
    return _classify(name, AUTO_WORDS, "other")

# ---------------------------------------------------------------- licences (RESEARCH_ETHICS.md section 1, fail closed)
def licence_class(text):
    t = (text or "").lower().replace("_", " ")
    if not t.strip(): return None
    if re.search(r"\bnc\b|non-?commercial|\bnd\b|no ?deriv|noderiv|all rights|copyright|proprietary", t): return None
    if re.search(r"cc0|public domain|zero", t): return "cc0"
    if "creative commons" in t or re.search(r"\bcc\b|\bcc[- ]?by", t):
        if re.search(r"\bsa\b|share ?alike|by-sa", t): return "by-sa"
        if re.search(r"\(by\)|\bby\b|attribution", t): return "by"
        return None  # CC without a variant: unknown, refuse
    if re.search(r"free art|\bfal\b", t): return "fal"
    if re.search(r"\b(a|l)?gpl|gnu general", t): return "gpl"
    if re.search(r"artistic", t): return "artistic"
    if re.search(r"\bmit\b|\bbsd\b", t): return "permissive"
    return None

# ---------------------------------------------------------------- statistics
def _median(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs), 3) if xs else None

def automation_shape(points, interp="linear"):
    pts = sorted(points)
    if len(pts) < 2: return "flat"
    vs = [p[1] for p in pts]; lo, hi = min(vs), max(vs); rng = hi - lo
    if rng <= 1e-9: return "flat"
    d = [b - a for a, b in zip(vs, vs[1:]) if abs(b - a) > 0.02 * rng]
    turns = sum(1 for a, b in zip(d, d[1:]) if (a > 0) != (b > 0))
    if turns >= 3: return "lfo"
    if interp == "step" and len(pts) <= 3 and turns == 0 and len(d) <= 1: return "step"
    net = vs[-1] - vs[0]
    if turns <= 1 and net > 0.5 * rng: return "rise"
    if turns <= 1 and net < -0.5 * rng: return "fall"
    return "curve"

def bucket_ms(x):
    if x is None: return None
    return int(10 * round(float(x) / 10.0))

def bucket_octave(hz):
    if not hz or hz <= 0: return None
    return round(2 ** round(math.log2(hz)))

def _infer_sections(active, bars, block=4):
    """Change points of the active role set on block-bar steps; Jaccard distance > 0.34 starts a new section."""
    if bars == 0: return []
    blocks = []
    for b0 in range(0, bars, block):
        s = set()
        for b in range(b0, min(bars, b0 + block)): s |= active[b]
        blocks.append((b0, s))
    cuts = [0]
    for (b0, s), (_, p) in zip(blocks[1:], blocks):
        u = s | p; j = 1 - (len(s & p) / len(u)) if u else 0
        if j > 0.34: cuts.append(b0)
    cuts.append(bars)
    return [(a, b - a) for a, b in zip(cuts, cuts[1:]) if b > a]

def _label_inferred(secs, density):
    if not secs: return []
    mx = max(density) or 1; med = statistics.median(density)
    out = []
    for i, (st, n) in enumerate(secs):
        d = statistics.mean(density[st:st + n])
        if i == 0 and d < med: r = "intro"
        elif i == len(secs) - 1 and d < med and len(secs) > 1: r = "outro"
        elif d >= 0.8 * mx: r = "peak"
        elif d <= 0.5 * mx: r = "breakdown"
        else: r = "body"
        out.append(r)
    return out

def stats(project, provenance=None):
    num, den = (project.get("meter") or [4, 4])[:2]
    bpb = num * 4.0 / den  # quarter-note beats per bar
    tracks = [t for t in project.get("tracks", []) if t.get("clips")]
    end = 0.0
    for t in tracks:
        for c in t["clips"]: end = max(end, c["start"] + c["len"])
    bars = int(math.ceil(end / bpb - 1e-3)) if end > 0 else 0
    roles = [role_of(t.get("name"), t.get("plugin")) for t in tracks]
    active = [set() for _ in range(bars)]; per_track = []
    notes_bar = {}
    for ti, (t, r) in enumerate(zip(tracks, roles)):
        on = set()
        for c in t["clips"]:
            if c["len"] <= 0: continue
            b0 = int((c["start"] + 1e-3) // bpb); b1 = int(math.ceil((c["start"] + c["len"]) / bpb - 1e-3))
            for b in range(max(0, b0), min(bars, b1)): on.add(b)
            if c.get("notes") is not None:
                notes_bar.setdefault(r, []).append(c["notes"] / max(c["len"] / bpb, 1e-9))
        for b in on: active[b].add(ti)
        per_track.append(on)
    layers = [len(a) for a in active]
    role_active = [set(roles[i] for i in a) for a in active]
    markers = sorted([m for m in project.get("markers", []) if m.get("beat") is not None], key=lambda m: m["beat"])
    secs = []
    if len(markers) >= 2 and bars:
        pts = [(int(round(m["beat"] / bpb)), section_role(m.get("name"))) for m in markers]
        pts = [p for p in pts if 0 <= p[0] < bars]
        if pts and pts[0][0] > 0: pts.insert(0, (0, "intro"))
        for (a, r), nxt in zip(pts, pts[1:] + [(bars, None)]):
            if nxt[0] > a: secs.append({"role": r, "start_bar": a + 1, "bars": nxt[0] - a, "source": "marker"})
    else:
        inf = _infer_sections(role_active, bars)
        for (a, n), r in zip(inf, _label_inferred(inf, layers)):
            secs.append({"role": r, "start_bar": a + 1, "bars": n, "source": "inferred"})
    for s in secs:
        rng = range(s["start_bar"] - 1, s["start_bar"] - 1 + s["bars"])
        s["layers_median"] = _median([layers[b] for b in rng])
        s["layers_max"] = max([layers[b] for b in rng] or [0])
        s["roles"] = sorted(set().union(*[role_active[b] for b in rng])) if s["bars"] else []
    clip_bars = {}
    for t in tracks:
        for c in t["clips"]:
            k = str(round(c["len"] / bpb, 2)); clip_bars[k] = clip_bars.get(k, 0) + 1
    fx_chains, fx_freq = [], {}
    for t, r in zip(tracks + project.get("buses", []), roles + ["bus"] * len(project.get("buses", []))):
        chain = [device_type(d) for d in t.get("devices", [])]
        if chain: fx_chains.append({"role": r if t in tracks else t.get("kind", "bus"), "chain": chain})
        for d in set(chain): fx_freq[d] = fx_freq.get(d, 0) + 1
    autos = []
    for a in project.get("automation", []):
        pts = a.get("points") or []
        if not pts: continue
        autos.append({"target": auto_target(a.get("target")), "shape": automation_shape(pts, a.get("interp", "linear")),
                      "start_bar": int(min(p[0] for p in pts) // bpb) + 1, "end_bar": int(max(p[0] for p in pts) // bpb) + 1})
    tension = tension_events(layers, autos, tracks, roles, bpb, bars)
    sends = sum(len(t.get("sends", [])) for t in project.get("tracks", []))
    sidechains = sum(len(t.get("sidechain", [])) for t in project.get("tracks", []) + project.get("buses", []))
    out = {
        "schema": SCHEMA, "format": project.get("format"),
        "tempo": round(project["tempo"], 3) if project.get("tempo") else None, "meter": [num, den], "key": project.get("key"),
        "length_bars": bars, "length_s": round(bars * bpb * 60.0 / project["tempo"], 1) if project.get("tempo") and bars else None,
        "tracks": {"total": len(project.get("tracks", [])), "with_clips": len(tracks),
                   "by_role": {r: roles.count(r) for r in sorted(set(roles))},
                   "by_kind": _count(t.get("kind") for t in project.get("tracks", []))},
        "sections": secs,
        "density": {"layers_per_bar": layers, "median": _median(layers), "max": max(layers or [0]),
                    "notes_per_bar_by_role": {r: _median(v) for r, v in sorted(notes_bar.items())}},
        "clip_bars": dict(sorted(clip_bars.items(), key=lambda kv: float(kv[0]))),
        "fx": {"chains": fx_chains, "type_frequency": dict(sorted(fx_freq.items()))},
        "automation": autos,
        "tension": tension,
        "routing": {"buses": len(project.get("buses", [])), "sends": sends, "sidechains": sidechains},
        "synth_ranges": [{k: v for k, v in s.items()} for s in project.get("synth", [])],
        "provenance": provenance,
    }
    return out

def tension_events(layers, autos, tracks, roles, bpb, bars):
    """Builds, drops, breakdowns, fills and switches from project data alone (no render). Bars are 1-based.
    Evidence: automation ramps (cutoff / volume / send / wet rise = build, fall = breakdown or fade; a ramp ending at bar b puts a drop
    candidate at b + 1 when layers rise there), riser / impact clips of fx-role tracks, density steps (layers +3 or x1.5 vs the two bars
    before = drop; -3 or x0.6 = breakdown), mute / enable steps (switch). Confidence adds per agreeing evidence (capped 0.95)."""
    ev = {}
    def add(kind, bar, why, c, end=None):
        if bar < 1 or bar > max(bars, 1): return
        k = (kind, bar); e = ev.setdefault(k, {"kind": kind, "bar": bar, "evidence": [], "confidence": 0.0})
        e["evidence"].append(why); e["confidence"] = round(min(0.95, e["confidence"] + c), 2)
        if end: e["end_bar"] = end
    for i, a in enumerate(autos):
        span = a["end_bar"] - a["start_bar"]
        if a["target"] in ("cutoff", "volume", "send", "wet", "resonance", "pitch") and a["shape"] == "rise" and span >= 1:
            add("build", a["start_bar"], "automation %d %s rise" % (i, a["target"]), 0.4, a["end_bar"])
            nb = a["end_bar"] + 1
            if nb <= bars and nb >= 2 and layers[nb - 1] > layers[max(0, nb - 2)]: add("drop", nb, "ramp %d ends, layers rise" % i, 0.3)
        elif a["target"] in ("cutoff", "volume", "send", "wet") and a["shape"] == "fall" and span >= 1:
            add("breakdown", a["start_bar"], "automation %d %s fall" % (i, a["target"]), 0.3, a["end_bar"])
        elif a["target"] == "mute" and a["shape"] in ("step", "curve"):
            add("switch", a["start_bar"], "automation %d mute/enable step" % i, 0.3)
    for t, r in zip(tracks, roles):
        if r != "fx": continue
        for c in t["clips"]:
            b0 = int((c["start"] + 1e-3) // bpb) + 1; nb = max(1, int(round(c["len"] / bpb)))
            if nb >= 2: add("build", b0, "fx clip %d bars (riser)" % nb, 0.3, b0 + nb - 1); add("drop", b0 + nb, "fx riser ends", 0.25)
            else: add("fill", b0, "fx one-bar clip (impact / fill)", 0.2)
    for b in range(2, len(layers)):
        prev = (layers[b - 1] + layers[b - 2]) / 2.0
        if layers[b] - prev >= 3 or (prev >= 2 and layers[b] >= 1.5 * prev): add("drop", b + 1, "layers %.1f -> %d" % (prev, layers[b]), 0.4)
        elif prev - layers[b] >= 3 or (prev >= 3 and layers[b] <= 0.6 * prev): add("breakdown", b + 1, "layers %.1f -> %d" % (prev, layers[b]), 0.35)
    out = []
    for e in sorted(ev.values(), key=lambda e: (e["kind"], e["bar"])):
        if out and out[-1]["kind"] == e["kind"] and e["bar"] - out[-1]["bar"] <= 1:  # one event per neighbouring bar pair
            out[-1]["evidence"] += e["evidence"]; out[-1]["confidence"] = round(min(0.95, max(out[-1]["confidence"], e["confidence"]) + 0.05), 2); continue
        out.append(e)
    return sorted(out, key=lambda e: (e["bar"], e["kind"]))

def _count(xs):
    d = {}
    for x in xs: d[x] = d.get(x, 0) + 1
    return dict(sorted(d.items(), key=lambda kv: str(kv[0])))

PROV_KEYS = ("url", "page_url", "author", "title", "licence", "licence_class", "accessed", "sha256", "bytes", "format", "parser", "kept")

def check_provenance(p):
    if not isinstance(p, dict): return ["no provenance"]
    errs = ["missing %s" % k for k in PROV_KEYS if p.get(k) in (None, "")]
    if p.get("licence_class") and licence_class(p.get("licence")) != p.get("licence_class"):
        errs.append("licence_class %s does not match licence text" % p.get("licence_class"))
    if p.get("kept") != "statistics only": errs.append("kept must be 'statistics only'")
    return errs

def to_md(s, title):
    L = ["# %s" % title, "", "Format %s, tempo %s, meter %s/%s, %s bars (%s s). Tracks %s (%s with clips). Statistics only (docs/RESEARCH_ETHICS.md)." % (
        s["format"], s["tempo"], s["meter"][0], s["meter"][1], s["length_bars"], s["length_s"], s["tracks"]["total"], s["tracks"]["with_clips"]), ""]
    L += ["| # | section | start bar | bars | layers median / max | roles | source |", "|---|---|---|---|---|---|---|"]
    for i, x in enumerate(s["sections"], 1):
        L.append("| %d | %s | %d | %d | %s / %s | %s | %s |" % (i, x["role"], x["start_bar"], x["bars"], x["layers_median"], x["layers_max"], ", ".join(x["roles"]), x["source"]))
    L += ["", "Roles: %s" % s["tracks"]["by_role"], "FX type frequency: %s" % s["fx"]["type_frequency"],
          "Automation: %s" % _count("%s/%s" % (a["target"], a["shape"]) for a in s["automation"]),
          "Routing: %s" % s["routing"], "Clip lengths (bars: count): %s" % s["clip_bars"]]
    p = s.get("provenance") or {}
    if p: L += ["", "Source: %s by %s, licence %s, accessed %s, sha256 %s" % (p.get("page_url"), p.get("author"), p.get("licence"), p.get("accessed"), p.get("sha256"))]
    return "\n".join(L) + "\n"
