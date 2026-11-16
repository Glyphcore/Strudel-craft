"""LMMS .mmp (XML) / .mmpz (Qt qCompress: 4-byte big-endian length + zlib) -> Project (common.py).
Ticks: 192 per 4/4 bar (48 per quarter). Track types: 0 instrument, 1 beat/bassline, 2 sample, 5/6 automation.
Beat/bassline tracks: the inner pattern tracks play wherever a bbtco clip of the matching index sits on the song."""
import struct, zlib, xml.etree.ElementTree as ET

TPQ = 48.0

def load_xml(data):
    if data[:1] != b"<":
        try: data = zlib.decompress(data[4:])
        except zlib.error: data = zlib.decompress(data)
    return ET.fromstring(data)

def _fx(chain):
    if chain is None: return []
    out = []
    for e in chain.findall("effect"):
        n = e.get("name") or ""
        if n == "ladspaeffect":
            k = e.find(".//key/attribute[@name='plugin']")
            n = "ladspa:" + (k.get("value") if k is not None else "")
        out.append(n)
    return out

def _notes(pat):
    return len(pat.findall("note"))

def parse(data):
    root = load_xml(data)
    head = root.find("head")
    tempo = float(head.get("bpm", 140)) if head is not None else 140.0
    if head is not None and head.find("bpm") is not None: tempo = float(head.find("bpm").get("value", tempo))
    num = int(head.get("timesig_numerator", 4)) if head is not None else 4
    den = int(head.get("timesig_denominator", 4)) if head is not None else 4
    song = root.find("song")
    tc = song.find("trackcontainer")
    ids = {}
    for e in root.iter():
        if e.get("id") is not None and e.tag != "object": ids[e.get("id")] = e.tag
    tracks, autos, buses, synth = [], [], [], []
    bb_inner = []
    bb_clips = {}
    bb_index = 0
    mixer = {}
    fxm = _first(song, "fxmixer", "mixer")
    if fxm is not None:
        for ch in list(fxm):
            n = ch.get("num")
            mixer[n] = {"name": ch.get("name") or "mix%s" % n, "kind": "bus", "devices": _fx(ch.find("fxchain")),
                        "sends": [s.get("channel") for s in ch.findall("send")], "sidechain": []}
    for tr in tc.findall("track"):
        ty = tr.get("type"); name = tr.get("name", "")
        if ty == "0":
            it = tr.find("instrumenttrack"); inst = it.find("instrument") if it is not None else None
            plugin = inst.get("name") if inst is not None else ""
            ch = it.get("fxch") if it is not None else None
            t = {"name": name, "kind": "instrument", "plugin": plugin, "devices": _fx(it.find("fxchain") if it is not None else None),
                 "sends": [ch] if ch not in (None, "0") else [], "sidechain": [],
                 "clips": [{"start": int(p.get("pos", 0)) / TPQ, "len": int(p.get("len", 0)) / TPQ if int(p.get("len", 0)) else 192 / TPQ,
                            "notes": _notes(p)} for p in tr.findall("pattern")]}
            el = it.find("eldata") if it is not None else None
            if el is not None:
                v = el.find("elvol")
                synth.append({"plugin": plugin, "cutoff_hz": _oct(el.get("fcut")), "filter": el.get("ftype"),
                              "attack_ms": _env_ms(v, "att"), "decay_ms": _env_ms(v, "dec"), "release_ms": _env_ms(v, "rel")})
            tracks.append(t)
        elif ty == "2":
            tracks.append({"name": name or "sample", "kind": "audio", "plugin": "sample", "devices": _fx(tr.find(".//fxchain")), "sends": [], "sidechain": [],
                           "clips": [{"start": int(c.get("pos", 0)) / TPQ, "len": int(c.get("len", 0)) / TPQ, "notes": None} for c in tr.findall("sampletco") + tr.findall("sampleclip")]})
        elif ty == "1":
            clips = [(int(c.get("pos", 0)) / TPQ, int(c.get("len", 0)) / TPQ) for c in tr.findall("bbtco") + tr.findall("patternclip")]
            bb_clips[bb_index] = clips
            inner = _first(tr, "bbtrack/trackcontainer", "patterntrack/trackcontainer")
            if inner is not None:  # one container holds every beat/bassline; pattern pos / 192 = the bb index
                for itr in inner.findall("track"):
                    if itr.get("type") != "0": continue
                    it = itr.find("instrumenttrack"); inst = it.find("instrument") if it is not None else None
                    pats = {int(p.get("pos", 0)) // 192: _notes(p) for p in itr.findall("pattern")}
                    bb_inner.append((itr.get("name", ""), inst.get("name") if inst is not None else "", _fx(it.find("fxchain") if it is not None else None), pats))
            bb_index += 1
        elif ty in ("5", "6"):
            for ap in tr.findall("automationpattern") + tr.findall("automationclip"):
                pos = int(ap.get("pos", 0)) / TPQ
                pts = [[pos + int(t.get("pos", 0)) / TPQ, float(t.get("value", 0))] for t in ap.findall("time")]
                tg = [ids.get(o.get("id"), "other") for o in ap.findall("object")]
                interp = "step" if ap.get("prog", "0") == "0" else "linear"  # progression 0 discrete, 1 linear, 2 cubic
                for g in tg or ["other"]: autos.append({"target": g, "points": pts, "interp": interp})
    for name, plugin, devs, pats in bb_inner:
        clips = []
        for bi, cl in bb_clips.items():
            n = pats.get(bi, 0)
            for (st, ln) in cl:
                if n and ln > 0: clips.append({"start": st, "len": ln, "notes": n * max(1.0, ln / 4.0)})
        tracks.append({"name": name, "kind": "instrument", "plugin": plugin, "devices": devs, "sends": [], "sidechain": [], "clips": clips})
    for n, m in mixer.items():
        if n != "0" and (m["devices"] or m["sends"]): buses.append(m)
    for m in mixer.values():
        if any(d.startswith("peakcontroller") for d in m["devices"]): m["sidechain"].append("peak")
    return {"format": "lmms", "tempo": tempo, "meter": [num, den], "key": None, "tracks": tracks, "markers": [],
            "automation": autos, "buses": buses, "synth": synth}

def _first(e, *paths):
    for p in paths:
        x = e.find(p)
        if x is not None: return x
    return None

def _env_ms(v, k):
    if v is None or v.get(k) is None: return None
    from common import bucket_ms
    return bucket_ms(float(v.get(k)) * 5000.0)  # LMMS stores envelope times as 0..1 of a 5 s span (UNVERIFIED across versions)

def _oct(x):
    if x is None: return None
    from common import bucket_octave
    return bucket_octave(float(x))
