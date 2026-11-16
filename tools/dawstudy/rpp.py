"""REAPER .rpp (text chunks) -> Project (common.py). Positions are seconds; converted to beats with the project tempo
(a tempo envelope is not followed: UNVERIFIED for projects with tempo changes). Markers: MARKER idx pos "name" flags.
Tracks: <TRACK NAME ...> with <FXCHAIN> plug-ins (<VST "...">, <JS ...>, <AU ...>), AUXRECV sends, <ITEM> POSITION / LENGTH;
MIDI notes in <SOURCE MIDI> are counted (E / e lines with note-on status 9x), never kept. Envelopes: <VOLENV2>, <PANENV2>, <PARMENV>, PT lines."""
import re, shlex

def _tok(line):
    try: return shlex.split(line)
    except ValueError: return line.split()

def parse(data):
    text = data.decode("utf-8", "replace") if isinstance(data, bytes) else data
    tempo, num, den = 120.0, 4, 4
    markers, tracks, autos = [], [], []
    stack = []; cur = None; item = None; env = None
    for raw in text.splitlines():
        line = raw.strip()
        if not line: continue
        if line.startswith("<"):
            tag = line[1:].split()[0] if len(line) > 1 else ""
            stack.append(tag)
            if tag == "TRACK":
                cur = {"name": "", "kind": "instrument", "plugin": "", "devices": [], "sends": [], "sidechain": [], "clips": []}; tracks.append(cur)
            elif tag == "ITEM" and cur is not None:
                item = {"start": 0.0, "len": 0.0, "notes": None}; cur["clips"].append(item)
            elif tag in ("VST", "JS", "AU", "CLAP", "DX") and cur is not None and "FXCHAIN" in stack:
                t = _tok(line[1:]); cur["devices"].append(t[1] if len(t) > 1 else tag)
            elif tag in ("VOLENV2", "PANENV2", "PARMENV", "VOLENV", "PANENV", "AUXVOLENV", "TEMPOENVEX"):
                env = {"target": {"VOLENV2": "volume", "VOLENV": "volume", "PANENV2": "pan", "PANENV": "pan", "AUXVOLENV": "send", "TEMPOENVEX": "tempo"}.get(tag, "param"), "points": []}
                autos.append(env)
            elif tag == "SOURCE" and item is not None and "MIDI" in line:
                item["notes"] = 0
            continue
        if line == ">":
            tag = stack.pop() if stack else ""
            if tag == "ITEM": item = None
            elif tag == "TRACK": cur = None
            elif tag in ("VOLENV2", "PANENV2", "PARMENV", "VOLENV", "PANENV", "AUXVOLENV", "TEMPOENVEX"): env = None
            continue
        t = _tok(line); k = t[0]
        top = stack[-1] if stack else ""
        if top == "REAPER_PROJECT":
            if k == "TEMPO" and len(t) >= 2:
                tempo = float(t[1]); num = int(t[2]) if len(t) > 2 else 4; den = int(t[3]) if len(t) > 3 else 4
            elif k == "MARKER" and len(t) >= 3:
                markers.append({"name": t[3] if len(t) > 3 else "", "sec": float(t[2])})
        elif top == "TRACK" and cur is not None:
            if k == "NAME": cur["name"] = t[1] if len(t) > 1 else ""
            elif k == "AUXRECV" and len(t) > 1: cur.setdefault("_recv", []).append(int(t[1]))
            elif k == "ISBUS" and len(t) > 1 and t[1] != "0": cur["kind"] = "group"
        elif top == "ITEM" and item is not None:
            if k == "POSITION": item["start"] = float(t[1])
            elif k == "LENGTH": item["len"] = float(t[1])
        elif top == "SOURCE" and item is not None and item.get("notes") is not None:
            if k in ("E", "e") and len(t) >= 3 and t[2][:1].lower() == "9": item["notes"] += 1
        elif env is not None and k == "PT" and len(t) >= 3:
            env["points"].append([float(t[1]), float(t[2])])
    spb = 60.0 / tempo
    for i, tr in enumerate(tracks):
        for c in tr["clips"]: c["start"] /= spb; c["len"] /= spb
        for src in tr.pop("_recv", []):
            if 0 <= src < len(tracks): tracks[src]["sends"].append(str(i))
    for a in autos: a["points"] = [[p[0] / spb, p[1]] for p in a["points"]]
    for m in markers: m["beat"] = m.pop("sec") / spb
    buses = [t for t in tracks if not t["clips"] and t["kind"] == "group"]
    return {"format": "rpp", "tempo": tempo, "meter": [num, den], "key": None, "tracks": [t for t in tracks if t not in buses],
            "markers": markers, "automation": autos, "buses": buses, "synth": []}
