"""FL Studio .flp -> Project (common.py). Our own reader of the container (PyFLP is GPL-3.0 and is not imported: RESEARCH_ETHICS.md 7).

Container: "FLhd" uint32 6, int16 format, int16 channel count, uint16 PPQ; "FLdt" uint32 length, then events.
Event = 1 id byte; id 0-63 one data byte, 64-127 two (uint16 LE), 128-191 four (uint32 LE), 192-255 a LEB128 length then data.
Ids read here (community-documented layout of the event stream; checked only against our synthetic fixture, real-file accuracy
UNVERIFIED, docs/DAW_STUDY.md): 17 time-signature numerator, 18 beat; 64 new channel; 65 new pattern; 66 tempo (legacy, integer bpm);
156 fine tempo (bpm x 1000); 148 time marker position (ticks, low 27 bits); 205 time marker name; 192 / 203 channel name; 193 pattern name;
201 default plug-in name (channel generator or mixer effect); 224 pattern notes (24-byte records: counted, never decoded);
231 playlist items (32-byte records in FL 12.9+, 28 before: uint32 position, uint16 pattern base, uint16 item index, uint32 length,
uint16 reversed track index); 238 playlist track data, 239 playlist track name."""
import struct
from common import device_type

def _leb(b, i):
    n = s = 0
    while True:
        c = b[i]; i += 1; n |= (c & 0x7F) << s; s += 7
        if not c & 0x80: return n, i

def events(b):
    if b[:4] != b"FLhd": raise ValueError("not an FLP file")
    hl = struct.unpack_from("<I", b, 4)[0]
    fmt, nch, ppq = struct.unpack_from("<hhH", b, 8)
    i = 8 + hl
    if b[i:i + 4] != b"FLdt": raise ValueError("no FLdt chunk")
    i += 8; out = []
    while i < len(b):
        eid = b[i]; i += 1
        if eid < 64: v = b[i]; i += 1
        elif eid < 128: v = struct.unpack_from("<H", b, i)[0]; i += 2
        elif eid < 192: v = struct.unpack_from("<I", b, i)[0]; i += 4
        else:
            n, i = _leb(b, i); v = b[i:i + n]; i += n
        out.append((eid, v))
    return ppq, out

def _text(v):
    if len(v) >= 2 and v[1:2] == b"\x00": return v.decode("utf-16-le", "replace").rstrip("\x00")
    return v.decode("latin-1", "replace").rstrip("\x00")

def parse(data):
    ppq, evs = events(data)
    tempo, num, den = 140.0, 4, 4
    channels, patterns, pat_notes, pat_names = [], [], {}, {}
    cur_pat = None; mixer_fx = []; markers = []; items = []; track_names = []; pending_marker = None
    for eid, v in evs:
        if eid == 66: tempo = float(v)
        elif eid == 156: tempo = v / 1000.0
        elif eid == 17: num = v or 4
        elif eid == 18: den = v or 4
        elif eid == 64: channels.append({"name": "", "plugin": ""})
        elif eid == 65: cur_pat = v; patterns.append(v)
        elif eid in (192, 203) and channels: channels[-1]["name"] = _text(v)
        elif eid == 193 and cur_pat is not None: pat_names[cur_pat] = _text(v)
        elif eid == 201:
            n = _text(v)
            if device_type(n) != "other": mixer_fx.append(n)
            elif channels and not channels[-1]["plugin"]: channels[-1]["plugin"] = n
        elif eid == 224 and cur_pat is not None: pat_notes[cur_pat] = pat_notes.get(cur_pat, 0) + len(v) // 24
        elif eid == 148: pending_marker = {"beat": (v & 0x07FFFFFF) / float(ppq), "name": ""}; markers.append(pending_marker)
        elif eid == 205 and pending_marker is not None: pending_marker["name"] = _text(v)
        elif eid == 231:
            size = 32 if len(v) % 32 == 0 else 28
            for k in range(0, len(v) - size + 1, size):
                pos, base, idx, ln, rtrack = struct.unpack_from("<IHHIH", v, k)
                items.append((pos, base, idx, ln, 499 - rtrack))
        elif eid == 239: track_names.append(_text(v))
    tracks = {}
    for pos, base, idx, ln, tr in items:
        is_pat = idx > base
        pid = idx - base if is_pat else None
        t = tracks.setdefault(tr, {"name": track_names[tr] if 0 <= tr < len(track_names) else "", "kind": "instrument" if is_pat else "audio",
                                   "plugin": "", "devices": [], "sends": [], "sidechain": [], "clips": []})
        if not t["name"] and is_pat: t["name"] = pat_names.get(pid, "")
        if not t["name"] and not is_pat and 0 <= idx < len(channels): t["name"] = channels[idx]["name"]; t["plugin"] = channels[idx]["plugin"]
        t["clips"].append({"start": pos / float(ppq), "len": ln / float(ppq), "notes": pat_notes.get(pid) if is_pat else None})
    buses = [{"name": "mixer", "kind": "bus", "devices": mixer_fx, "sends": [], "sidechain": ["peak"] if any(device_type(d) == "sidechain" for d in mixer_fx) else []}] if mixer_fx else []
    return {"format": "flp", "tempo": tempo, "meter": [num, den], "key": None, "tracks": [tracks[k] for k in sorted(tracks)],
            "markers": markers, "automation": [], "buses": buses, "synth": [],
            "channels": {"count": len(channels), "plugins": sorted(set(c["plugin"] for c in channels if c["plugin"]))}}
