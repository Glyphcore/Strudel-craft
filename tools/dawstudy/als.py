"""Ableton Live .als (gzip XML) -> Project (common.py). Times are in quarter-note beats.
Tracks: MidiTrack, AudioTrack, GroupTrack, ReturnTrack; MasterTrack / MainTrack hold the tempo (Tempo/Manual) and time signature.
Clips: MainSequencer/ClipTimeable/ArrangerAutomation/Events/{MidiClip,AudioClip} (Time / CurrentStart / CurrentEnd); notes are counted only.
Devices: DeviceChain//Devices children (tag = device type, PluginDevice -> PluginDesc name). Sidechain: a device with
SideChain/OnOff/Manual true and a RoutedInput target. Automation: AutomationEnvelope PointeeId -> the parameter element owning AutomationTarget Id."""
import gzip, xml.etree.ElementTree as ET

def _v(e, path, default=None):
    x = e.find(path)
    return x.get("Value") if x is not None and x.get("Value") is not None else default

def _devices(tr):
    out, sc = [], []
    devs = tr.find("DeviceChain/DeviceChain/Devices")
    if devs is None: devs = tr.find("DeviceChain/Devices")
    if devs is None: return out, sc
    for d in list(devs):
        name = d.tag
        if d.tag in ("PluginDevice", "AuPluginDevice"):
            pn = d.find(".//PluginDesc//PlugName")
            if pn is None: pn = d.find(".//PluginDesc//Name")
            name = "plugin:" + (pn.get("Value") if pn is not None else "")
        out.append(name)
        on = d.find("SideChain/OnOff/Manual")
        if on is not None and on.get("Value") == "true":
            tgt = d.find("SideChain/RoutedInput/Routable/Target")
            sc.append(tgt.get("Value") if tgt is not None else "sidechain")
    return out, sc

def _instrument(devs):
    for d in devs:
        if d in ("OriginalSimpler", "MultiSampler", "InstrumentGroupDevice", "DrumGroupDevice", "Operator", "UltraAnalog", "InstrumentVector",
                 "Collision", "Tension", "LoungeLizard", "StringStudio", "Drift", "MeldDevice") or d.startswith("plugin:"):
            return d
    return ""

def parse(data):
    if data[:2] == b"\x1f\x8b": data = gzip.decompress(data)
    root = ET.fromstring(data); ls = root.find("LiveSet")
    master = ls.find("MasterTrack")
    if master is None: master = ls.find("MainTrack")
    tempo = float(_v(master, ".//Tempo/Manual", 120)) if master is not None else 120.0
    num, den = 4, 4
    ts = master.find(".//TimeSignature//RemoteableTimeSignature") if master is not None else None
    if ts is not None:
        num = int(_v(ts, "Numerator", 4)); den = int(_v(ts, "Denominator", 4))
    pointee = {}
    for p in root.iter():
        at = p.find("AutomationTarget")
        if at is not None and at.get("Id"): pointee[at.get("Id")] = p.tag
    tracks, autos, buses = [], [], []
    kinds = {"MidiTrack": "instrument", "AudioTrack": "audio", "GroupTrack": "group", "ReturnTrack": "return"}
    for tag, kind in kinds.items():
        for tr in ls.findall("Tracks/" + tag):
            name = _v(tr, "Name/EffectiveName", "") or _v(tr, "Name/UserName", "")
            devs, sc = _devices(tr)
            clips = []
            ev = tr.find("DeviceChain/MainSequencer/ClipTimeable/ArrangerAutomation/Events")
            if ev is None: ev = tr.find("DeviceChain/MainSequencer/Sample/ArrangerAutomation/Events")
            if ev is not None:
                for c in list(ev):
                    if c.tag not in ("MidiClip", "AudioClip"): continue
                    st = float(c.get("Time", _v(c, "CurrentStart", 0)))
                    ln = float(_v(c, "CurrentEnd", st)) - float(_v(c, "CurrentStart", st))
                    if c.tag == "MidiClip":
                        n = len(c.findall(".//Notes//MidiNoteEvent"))
                    else: n = None
                    clips.append({"start": st, "len": ln, "notes": n})
            sends = []
            for i, s in enumerate(tr.findall("DeviceChain/Mixer/Sends/TrackSendHolder")):
                if float(_v(s, "Send/Manual", 0) or 0) > 0.0001: sends.append("return%d" % i)
            t = {"name": name, "kind": kind, "plugin": _instrument(devs), "devices": [d for d in devs if d != _instrument(devs)],
                 "sends": sends, "sidechain": sc, "clips": clips}
            (buses if kind in ("return", "group") and not clips else tracks).append(t)
            for env in tr.findall(".//AutomationEnvelopes/Envelopes/AutomationEnvelope"):
                pid = _v(env, "EnvelopeTarget/PointeeId")
                pts = [[float(e.get("Time")), float(e.get("Value"))] for e in env.findall("Automation/Events/FloatEvent") if float(e.get("Time")) >= 0]  # the -63072000 event is the pre-song default
                if pts: autos.append({"target": pointee.get(pid, "other"), "points": pts})
    markers = [{"name": _v(l, "Name", ""), "beat": float(_v(l, "Time", 0))} for l in ls.findall("Locators/Locators/Locator")]
    return {"format": "als", "tempo": tempo, "meter": [num, den], "key": None, "tracks": tracks, "markers": markers,
            "automation": autos, "buses": buses, "synth": []}
