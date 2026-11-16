"""Tiny synthetic projects written by our own code (no real project is ever used as a fixture: RESEARCH_ETHICS.md 2).
Shape of every fixture: 140 bpm 4/4, 32 bars = intro 8 (kick, pad), drop 16 (kick, snare, hat, bass, pad), outro 8 (pad, hat).
Markers (where the format has them): Intro @1, Drop @9, Outro @25. Expected stats: sections intro 8 / drop 16 / outro 8, layers 2 / 5 / 2."""
import gzip, struct, zlib

TEMPO = 140
LAYOUT = [("Kick", "kicker", [(0, 24)]), ("Snare", "tripleoscillator", [(8, 16)]), ("Hat", "tripleoscillator", [(8, 24)]),
          ("Bass", "lb302", [(8, 16)]), ("Pad", "tripleoscillator", [(0, 24)])]   # name, plug-in, [(start bar, bars)]
LAYOUT[2] = ("Hat", "tripleoscillator", [(8, 24)])
LAYOUT = [("Kick", "kicker", [(0, 24)]), ("Snare", "tripleoscillator", [(8, 16)]), ("Hat", "tripleoscillator", [(8, 24)]),
          ("Bass", "lb302", [(8, 16)]), ("Pad", "tripleoscillator", [(0, 32)])]
MARKERS = [("Intro", 0), ("Drop", 8), ("Outro", 24)]
EXPECT = {"tempo": 140, "length_bars": 32}

def mmp():
    tr = []
    for name, plug, clips in LAYOUT:
        pats = "".join('<pattern pos="%d" len="%d" steps="16"><note pos="0" len="48" key="0" vol="100"/><note pos="96" len="48" key="0" vol="100"/></pattern>' % (s * 192, n * 192) for s, n in clips)
        fx = '<fxchain enabled="1" numofeffects="1"><effect name="reverbsc" on="1"/></fxchain>' if name == "Pad" else '<fxchain enabled="0" numofeffects="0"/>'
        tr.append('<track type="0" name="%s"><instrumenttrack fxch="%d" vol="100"><instrument name="%s"/>%s'
                  '<eldata fcut="14000" ftype="0"><elvol att="0.002" dec="0.1" rel="0.05"/></eldata></instrumenttrack>%s</track>' % (name, 1 if name == "Bass" else 0, plug, fx, pats))
    auto = '<track type="5" name="Automation"><automationpattern pos="0" len="768" prog="1"><time pos="0" value="200"/><time pos="768" value="12000"/><object id="9001"/></automationpattern></track>'
    tr[4] = tr[4].replace('<instrument name="tripleoscillator"/>', '<instrument name="tripleoscillator"/><cut id="9001" value="200"/>')
    x = ('<?xml version="1.0"?><lmms-project version="1.0" type="song"><head bpm="%d" timesig_numerator="4" timesig_denominator="4"/>'
         '<song><trackcontainer type="song">%s%s</trackcontainer><fxmixer><fxchannel num="0" name="Master"><fxchain numofeffects="1"><effect name="compressor"/></fxchain></fxchannel>'
         '<fxchannel num="1" name="BassBus"><fxchain numofeffects="1"><effect name="bitcrush"/></fxchain><send channel="0" amount="1"/></fxchannel></fxmixer></song></lmms-project>') % (TEMPO, "".join(tr), auto)
    return x.encode()

def mmpz():
    d = mmp(); return struct.pack(">I", len(d)) + zlib.compress(d)

def als():
    tracks = []
    for i, (name, plug, clips) in enumerate(LAYOUT):
        cl = "".join('<MidiClip Time="%d"><CurrentStart Value="%d"/><CurrentEnd Value="%d"/><Notes><KeyTracks><KeyTrack><Notes><MidiNoteEvent Time="0" Duration="1" Velocity="100"/></Notes></KeyTrack></KeyTracks></Notes></MidiClip>' % (s * 4, s * 4, (s + n) * 4) for s, n in clips)
        sc = '<Compressor2><SideChain><OnOff><Manual Value="true"/></OnOff><RoutedInput><Routable><Target Value="AudioIn/Track.0/PostFxOut"/></Routable></RoutedInput></SideChain></Compressor2>' if name == "Bass" else ""
        tracks.append('<MidiTrack Id="%d"><Name><EffectiveName Value="%s"/></Name><DeviceChain><Mixer><Sends><TrackSendHolder><Send><Manual Value="%s"/></Send></TrackSendHolder></Sends>'
                      '<Volume><AutomationTarget Id="%d"/></Volume></Mixer><MainSequencer><ClipTimeable><ArrangerAutomation><Events>%s</Events></ArrangerAutomation></ClipTimeable></MainSequencer>'
                      '<DeviceChain><Devices><Operator/>%s<Eq8/></Devices></DeviceChain></DeviceChain>%s</MidiTrack>' % (
                          i, name, "0.5" if name == "Pad" else "0", 100 + i, cl, sc,
                          '<AutomationEnvelopes><Envelopes><AutomationEnvelope><EnvelopeTarget><PointeeId Value="104"/></EnvelopeTarget><Automation><Events><FloatEvent Time="-63072000" Value="0"/><FloatEvent Time="0" Value="0"/><FloatEvent Time="32" Value="1"/></Events></Automation></AutomationEnvelope></Envelopes></AutomationEnvelopes>' if name == "Pad" else ""))
    loc = "".join('<Locator><Time Value="%d"/><Name Value="%s"/></Locator>' % (b * 4, n) for n, b in MARKERS)
    x = ('<?xml version="1.0"?><Ableton><LiveSet><Tracks>%s<ReturnTrack><Name><EffectiveName Value="Reverb"/></Name><DeviceChain><DeviceChain><Devices><Reverb/></Devices></DeviceChain></DeviceChain></ReturnTrack></Tracks>'
         '<MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="%d"/></Tempo></Mixer></DeviceChain></MasterTrack><Locators><Locators>%s</Locators></Locators></LiveSet></Ableton>') % ("".join(tracks), TEMPO, loc)
    return gzip.compress(x.encode())

def rpp():
    spb = 60.0 / TEMPO; L = ['<REAPER_PROJECT 0.1 "7.0"', "  TEMPO %d 4 4" % TEMPO]
    for i, (n, b) in enumerate(MARKERS): L.append('  MARKER %d %.6f "%s" 0' % (i + 1, b * 4 * spb, n))
    for name, plug, clips in LAYOUT:
        L += ["  <TRACK", '    NAME "%s"' % name, "    <FXCHAIN", '      <VST "VSTi: %s" x.dll 0' % plug, "      >"]
        if name == "Bass": L += ['      <VST "VST: ReaComp (Cockos)" reacomp.dll 0', "      >"]
        L += ["    >"]
        for s, n in clips:
            L += ["    <ITEM", "      POSITION %.6f" % (s * 4 * spb), "      LENGTH %.6f" % (n * 4 * spb), "      <SOURCE MIDI", "        E 0 90 3c 60", "        E 96 80 3c 00", "      >", "    >"]
        if name == "Pad": L += ["    <VOLENV2", "      PT 0 0.1 0", "      PT %.6f 1 0" % (32 * 4 * spb), "    >"]
        L += ["  >"]
    L += ['  <TRACK', '    NAME "Verb"', "    ISBUS 0 0", "    AUXRECV 4 0 0.5 0 0 0 0 0 0 -1:U 0 -1 ''", "  >", ">"]
    return "\n".join(L).encode()

def ardour():
    sr = 48000; spb = 60.0 / TEMPO; sm = lambda bars: int(round(bars * 4 * spb * sr))
    routes, pls = [], []
    for i, (name, plug, clips) in enumerate(LAYOUT):
        routes.append('<Route id="%d" name="%s" default-type="midi"><Processor type="lv2" name="%s"/>%s</Route>' % (
            10 + i, name, plug, '<Processor type="lv2" name="x42-compressor sidechain"/>' if name == "Bass" else '<Processor type="intsend" target="99"/>' if name == "Pad" else ""))
        pls.append('<Playlist orig-track-id="%d">%s</Playlist>' % (10 + i, "".join('<Region position="%d" length="%d"/>' % (sm(s), sm(n)) for s, n in clips)))
    routes.append('<Route id="99" name="Reverb" default-type="audio"><Processor type="lv2" name="ACE Reverb"/></Route>')
    loc = "".join('<Location name="%s" start="%d" end="%d" flags="IsMark"/>' % (n, sm(b), sm(b)) for n, b in MARKERS)
    x = ('<?xml version="1.0"?><Session version="3001" sample-rate="%d"><Locations>%s</Locations><Routes>%s</Routes><Playlists>%s</Playlists>'
         '<TempoMap><Tempo beats-per-minute="%d"/><Meter divisions-per-bar="4" note-value="4"/></TempoMap></Session>') % (sr, loc, "".join(routes), "".join(pls), TEMPO)
    return x.encode()

def _ev(eid, v):
    if eid < 64: return bytes([eid, v])
    if eid < 128: return bytes([eid]) + struct.pack("<H", v)
    if eid < 192: return bytes([eid]) + struct.pack("<I", v)
    n = len(v); leb = bytearray()
    while True:
        c = n & 0x7F; n >>= 7
        leb.append(c | (0x80 if n else 0))
        if not n: break
    return bytes([eid]) + bytes(leb) + v

def flp():
    ppq = 96; u = lambda s: (s + "\x00").encode("utf-16-le"); ev = []
    ev.append(_ev(156, TEMPO * 1000)); ev.append(_ev(17, 4)); ev.append(_ev(18, 4))
    for name, plug, _ in LAYOUT:
        ev += [_ev(64, len(ev)), _ev(201, u(plug)), _ev(203, u(name))]
    ev.append(_ev(201, u("Fruity Limiter"))); ev.append(_ev(201, u("Fruity Peak Controller")))
    for i, (name, plug, _) in enumerate(LAYOUT):
        ev += [_ev(65, i + 1), _ev(193, u(name)), _ev(224, b"\x00" * 48)]
    items = b""
    for i, (name, plug, clips) in enumerate(LAYOUT):
        for s, n in clips:
            items += struct.pack("<IHHIH", s * 4 * ppq, 20480, 20480 + i + 1, n * 4 * ppq, 499 - i) + b"\x00" * 18
    ev.append(_ev(231, items))
    for n, b in MARKERS: ev += [_ev(148, b * 4 * ppq), _ev(205, u(n))]
    body = b"".join(ev)
    return b"FLhd" + struct.pack("<IhhH", 6, 0, len(LAYOUT), ppq) + b"FLdt" + struct.pack("<I", len(body)) + body

ALL = {".mmp": mmp, ".mmpz": mmpz, ".als": als, ".rpp": rpp, ".ardour": ardour, ".flp": flp}
