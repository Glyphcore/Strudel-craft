"""Minimal SoundFont 2 reader (RIFF sfbk): enough to list the sample zones of a preset (issue #181).
sf2zones(path) -> (smpl int16 bytes, shdr list, zones[{key:(lo,hi), vel:(lo,hi), sample:int, root, tune_cents, mode, atten}])."""
import struct

def _chunks(b, o, end):
    while o + 8 <= end:
        cid = b[o:o + 4]; n = struct.unpack_from('<I', b, o + 4)[0]
        yield cid, o + 8, n
        o += 8 + n + (n & 1)

def sf2zones(path, preset=0):
    b = open(path, 'rb').read()
    assert b[:4] == b'RIFF' and b[8:12] == b'sfbk', 'not an SF2'
    smpl = None; p = {}
    for cid, o, n in _chunks(b, 12, len(b)):
        if cid != b'LIST': continue
        kind = b[o:o + 4]
        for c2, o2, n2 in _chunks(b, o + 4, o + n):
            if kind == b'sdta' and c2 == b'smpl': smpl = b[o2:o2 + n2]
            elif kind == b'pdta': p[c2] = b[o2:o2 + n2]
    rec = lambda k, sz: [p[k][i:i + sz] for i in range(0, len(p[k]), sz)]
    phdr = [struct.unpack('<20sHHHIII', r) for r in rec(b'phdr', 38)]
    pbag = [struct.unpack('<HH', r) for r in rec(b'pbag', 4)]
    pgen = [struct.unpack('<Hh', r) for r in rec(b'pgen', 4)]
    inst = [struct.unpack('<20sH', r) for r in rec(b'inst', 22)]
    ibag = [struct.unpack('<HH', r) for r in rec(b'ibag', 4)]
    igen = [(struct.unpack('<H', r[:2])[0], 0, struct.unpack('<h', r[2:])[0], struct.unpack('<BB', r[2:])) for r in rec(b'igen', 4)]
    shdr = [struct.unpack('<20sIIIIIBbHH', r) for r in rec(b'shdr', 46)][:-1]
    # preset zones -> instrument ids
    insts = []
    for z in range(phdr[preset][3], phdr[preset + 1][3]):
        for g in pgen[pbag[z][0]:pbag[z + 1][0]]:
            if g[0] == 41: insts.append(g[1])
    zones = []
    for ii in insts:
        glob = {}
        for z in range(inst[ii][1], inst[ii + 1][1]):
            g = {}
            for op, _, amt, rng in igen[ibag[z][0]:ibag[z + 1][0]]:
                g[op] = rng if op in (43, 44) else amt
            if 53 not in g: glob = g; continue
            m = {**glob, **g}
            zones.append(dict(key=m.get(43, (0, 127)), vel=m.get(44, (0, 127)), sample=m[53], root=m.get(58, -1),
                              coarse=m.get(51, 0), fine=m.get(52, 0),
                              mode=m.get(54, 0), atten=m.get(48, 0)))
    return smpl, shdr, zones
