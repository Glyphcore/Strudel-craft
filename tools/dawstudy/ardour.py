"""Ardour .ardour session (XML) -> Project (common.py).
Time: Ardour 6 stores samples (integers); Ardour 7+ stores timepos strings 'a<superclock>' (282240000 per second) or 'b<ticks>'
(1920 ticks per beat). Tempo: TempoMap/Tempos/Tempo (npm, Ardour 7) or TempoMap/Tempo (beats-per-minute, Ardour 6).
Routes: Route with default-type; Processor type lv2/ladspa/vst/luaproc/... are plug-ins; intsend / send are sends (target route id).
Regions on Playlist orig-track-id (position / length). Markers: Locations/Location flags IsMark (and IsSection in Ardour 8)."""
import xml.etree.ElementTree as ET

SUPERCLOCK = 282240000.0

def _secs(v, sr, tempo):
    if v is None: return 0.0
    v = str(v)
    if v.startswith("a"): return float(v[1:]) / SUPERCLOCK
    if v.startswith("b"): return float(v[1:]) / 1920.0 * 60.0 / tempo
    return float(v) / sr

def parse(data):
    root = ET.fromstring(data)
    sr = float(root.get("sample-rate", 48000))
    tempo = 120.0; num, den = 4, 4
    t = root.find("TempoMap/Tempos/Tempo")
    if t is not None: tempo = float(t.get("npm", t.get("note-types-per-minute", 120)))
    else:
        t = root.find(".//TempoMap/Tempo")
        if t is not None: tempo = float(t.get("beats-per-minute", 120))
    m = root.find("TempoMap/Meters/Meter")
    if m is None: m = root.find(".//TempoMap/Meter")
    if m is not None:
        num = int(float(m.get("divisions-per-bar", 4))); den = int(float(m.get("note-value", 4)))
    spb = 60.0 / tempo
    routes, ids = [], {}
    for r in root.findall("Routes/Route"):
        flags = r.get("flags", "")
        if "MasterOut" in flags or "MonitorOut" in flags: continue
        devs, sends = [], []
        for p in r.findall("Processor"):
            ty = p.get("type", "")
            if ty in ("lv2", "ladspa", "vst", "windows-vst", "lxvst", "mac-vst", "vst3", "luaproc", "audiounit", "plugininsert"):
                devs.append(p.get("name", ty))
            elif ty in ("intsend", "send", "foldbacksend"):
                sends.append(p.get("target", ""))
        sc = [p.get("name") for p in r.findall(".//Processor") if "sidechain" in (p.get("name", "") + p.get("type", "")).lower()]
        rt = {"name": r.get("name", ""), "kind": "instrument" if r.get("default-type") == "midi" else "audio",
              "plugin": devs[0] if devs and r.get("default-type") == "midi" else "", "devices": devs[1:] if devs and r.get("default-type") == "midi" else devs,
              "sends": sends, "sidechain": sc, "clips": [], "_id": r.get("id"), "_audio": r.find(".//Diskstream") is not None or r.get("audio-playlist") or r.find("Diskstream") is not None}
        ids[r.get("id")] = rt; routes.append(rt)
        for at in r.findall(".//AutomationList"):
            pts = []
            ev = at.find("events")
            if ev is not None and ev.text:
                vals = ev.text.split()
                for a, b in zip(vals[::2], vals[1::2]): pts.append([_secs(a, sr, tempo) / spb, float(b)])
            if pts: autos_target = at.get("automation-id", "other"); rt.setdefault("_auto", []).append({"target": autos_target, "points": pts})
    for pl in root.findall("Playlists/Playlist"):
        rt = None
        for r in routes:
            if pl.get("orig-track-id") and pl.get("orig-track-id") == r["_id"]: rt = r
        if rt is None: continue
        for rg in pl.findall("Region"):
            st = _secs(rg.get("position"), sr, tempo); ln = _secs(rg.get("length"), sr, tempo)
            rt["clips"].append({"start": st / spb, "len": ln / spb, "notes": None})
    markers = []
    for l in root.findall("Locations/Location"):
        if "IsMark" in l.get("flags", "") or "IsSection" in l.get("flags", ""):
            markers.append({"name": l.get("name", ""), "beat": _secs(l.get("start"), sr, tempo) / spb})
    autos = []
    for r in routes:
        autos += r.pop("_auto", []); r.pop("_id", None); r.pop("_audio", None)
    tracks = [r for r in routes if r["clips"]]; buses = [dict(r, kind="bus") for r in routes if not r["clips"]]
    return {"format": "ardour", "tempo": tempo, "meter": [num, den], "key": None, "tracks": tracks, "markers": markers,
            "automation": autos, "buses": buses, "synth": []}
