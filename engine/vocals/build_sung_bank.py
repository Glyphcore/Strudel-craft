#!/usr/bin/env python3
"""Build the `sung` vox bank: English words sung at fixed pitches, no .NET, no OpenUtau.

Engine : SoulX-Singer (Soul-AILab, Apache-2.0 code and weights), zero-shot singing synthesis, run on CPU with PyTorch.
         Score control: per word one note (ARPAbet phonemes from g2p_en / CMUdict, MIDI pitch, duration). No f0 curve is supplied.
Timbre : a prompt assembled from the shipped VocalSet bank (CC BY 4.0): one singer's five straight long tones a/e/i/o/u.
Output : OUT/ogg/<word>_<note>.ogg (mono 22.05 kHz), OUT/strudel.json (flat, middle note), OUT/pitched/strudel.json
         ({vox_<word>: {note: [url]}}, what voxBank('sung') loads), OUT/words.json (per clip: target note, measured f0, cents error).

  python3 engine/vocals/build_sung_bank.py --code SOULX_CHECKOUT --model model.pt --work WORK_DIR \
      [--out site/data/vox/sung] [--singer female6] [--notes "g3 c4 f4 a#4 d#5 g5"] [--steps 16] [--words FILE] [--limit N] [--stage render|slice|all]

SOULX_CHECKOUT = a checkout of github.com/Soul-AILab/SoulX-Singer (or the Hugging Face space of the same name); model.pt from
huggingface.co/Soul-AILab/SoulX-Singer. Neither is vendored here. The checkpoint is loaded with weights_only=True (no pickle code).
Render is resumable: finished segments in WORK_DIR are skipped. Licences: engine/vocals/LICENSES.md.
"""
import argparse, hashlib, json, os, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import soundfile as sf

# Model pin (#79): the exact inputs of the shipped bank. render() refuses a checkpoint whose sha256 differs and warns if the checkout is another commit.
MODEL_PIN = dict(
    weights='https://huggingface.co/Soul-AILab/SoulX-Singer/resolve/40493ad90286056c7a9095035164434a79daa8c9/model.pt',
    weights_repo_revision='40493ad90286056c7a9095035164434a79daa8c9',  # huggingface.co/Soul-AILab/SoulX-Singer, last modified 2026-03-13
    weights_sha256='447eaf41f91a6b6659d55e9ec3c9b809221724fb8592aebaec35a23751a5b500', weights_bytes=2818092278,
    code_repo='https://huggingface.co/spaces/Soul-AILab/SoulX-Singer', code_revision='339c325cbfbf8cf81bb1c1c9860df351f45758ae',  # last modified 2026-03-12; mirrors the GitHub repo
)
SR = 24000          # model rate
OUT_SR = 22050      # bank rate (same as the other site banks)
FPS = 50            # 24000 / hop 480
NOTE_DUR, REST_DUR, LEAD = 0.70, 0.30, 0.30
PER_SEG = 8         # words per rendered segment (one pitch per segment)
VOWELS = [('a', 'en_AA1'), ('e', 'en_EH1'), ('i', 'en_IY1'), ('o', 'en_OW1'), ('u', 'en_UW1')]
NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b']

WORDS = """love heart baby night light fire time day way world life dream soul mind eyes hand face name home road sky sun moon star rain
wind sea river water stone gold blood bone skin breath voice song dance beat sound bass drum line word truth lie hope fear pain joy
tears smile kiss touch hold run fall rise fly burn break shine glow fade stay go come leave take give make feel know want need see
hear say tell call cry sing play move turn walk wait watch dark bright cold warm high low deep slow wild free young old new last
first one two three four five six seven eight nine ten all none more less never always forever again tonight today tomorrow now then
here there where when why how who what yes no oh ah la hey yeah ooh na da me you we they she he it us them my your our I am is
are was be been do done can will would should could and but or if so like just only still down up in out on off over under into
away back with without for from to of the a this that these those girl boy man woman friend lover angel devil heaven hell city street
door room bed car money gun crown king queen summer winter morning midnight shadow ghost thunder lightning ocean mountain flower rose
silver diamond heartbeat alone together crazy lonely sweet bitter easy hard good bad better""".split()


def midi_of(note):
    n = note.lower().strip(); name, octv = n[:-1], int(n[-1])
    return NAMES.index(name) + 12 * (octv + 1)


def meta(ph, du, pi, ty):
    n = int(sum(du) * FPS) + 2  # f0 is unused in score mode, but its length bounds the frame count
    return dict(index='seg', language='English', time=[0, int(sum(du) * 1000)], duration=' '.join(f'{d:.2f}' for d in du), text='',
                phoneme=' '.join(ph), note_pitch=' '.join(map(str, pi)), note_type=' '.join(map(str, ty)), f0=' '.join(['0.0'] * n))


def build_prompt(vocalset, singer, work):
    """Five straight long tones of one VocalSet singer -> prompt wav + score metadata (pitch from the bank's words.json)."""
    import librosa
    wj = json.load(open(os.path.join(vocalset, 'words.json')))['words']
    notes = {x['vowel']: x for x in wj if x['singer'] == singer and x['technique'] == 'straight'}
    parts, ph, du, pi, ty = [np.zeros(int(.2 * SR), np.float32)], ['<SP>'], [.2], [0], [1]
    for v, p in VOWELS:
        y, _ = librosa.load(os.path.join(vocalset, notes[v]['file']), sr=SR)
        y = y[int(.3 * SR):int(1.2 * SR)].copy(); f = int(.03 * SR)
        y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f)
        parts += [y, np.zeros(int(.1 * SR), np.float32)]
        ph += [p, '<SP>']; du += [len(y) / SR, .1]; pi += [midi_of(notes[v]['note']), 0]; ty += [2, 1]
    path = os.path.join(work, 'prompt.wav'); sf.write(path, np.concatenate(parts), SR)
    return path, meta(ph, du, pi, ty), [notes[v]['file'] for v, _ in VOWELS]


def plan(words, notes):
    segs = []
    for note in notes:
        for i in range(0, len(words), PER_SEG):
            segs.append(dict(note=note, midi=midi_of(note), words=words[i:i + PER_SEG], wav=f'seg_{note.replace("#", "s")}_{i // PER_SEG:03d}.wav'))
    return segs


def render(a, words, notes):
    import torch
    sys.path.insert(0, a.code)
    from soulxsinger.utils.file_utils import load_config
    from soulxsinger.models.soulxsinger import SoulXSinger
    from soulxsinger.utils.data_processor import DataProcessor
    from g2p_en import G2p
    torch.set_num_threads(a.threads); torch.manual_seed(a.seed)
    cfg = load_config(os.path.join(a.code, 'soulxsinger/config/soulxsinger.yaml'))
    h = hashlib.sha256()
    with open(a.model, 'rb') as fh:
        for blk in iter(lambda: fh.read(1 << 24), b''): h.update(blk)
    if h.hexdigest() != MODEL_PIN['weights_sha256']: raise SystemExit(f"model.pt sha256 {h.hexdigest()} != pinned {MODEL_PIN['weights_sha256']}; fetch {MODEL_PIN['weights']}")
    try:
        import subprocess
        rev = subprocess.run(['git', '-C', a.code, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
        if rev and rev != MODEL_PIN['code_revision']: print(f"warning: code checkout {rev} != pinned {MODEL_PIN['code_revision']}")
    except Exception: pass
    model = SoulXSinger(cfg)
    ck = torch.load(a.model, weights_only=True, map_location='cpu')
    model.load_state_dict(ck['state_dict'], strict=True); model.eval(); del ck
    for m in model.modules():  # transformers > 4.53 leaves the attention implementation unset on hand-built LlamaConfigs
        c = getattr(m, 'config', None)
        if c is not None and hasattr(c, '_attn_implementation_internal') and c._attn_implementation_internal is None: c._attn_implementation = 'eager'
    dp = DataProcessor(hop_size=480, sample_rate=SR, phoneset_path=os.path.join(a.code, 'soulxsinger/utils/phoneme/phone_set.json'), device='cpu')
    pwav, pmeta, pfiles = build_prompt(a.vocalset, a.singer, a.work)
    prompt = dp.process(pmeta, pwav)
    g2p = G2p(); phon = {}
    for w in words:
        p = [x for x in g2p(w) if x.strip() and x[0].isalpha()]
        if not all(('en_' + x) in dp.phone2idx for x in p): raise SystemExit(f'phoneme outside the model set: {w} {p}')
        phon[w] = p
    json.dump(dict(prompt_files=pfiles, singer=a.singer, phonemes=phon), open(os.path.join(a.work, 'render_meta.json'), 'w'), indent=1)
    segs = plan(words, notes); t0 = time.time(); done = 0
    for k, s in enumerate(segs):
        path = os.path.join(a.work, s['wav'])
        if os.path.exists(path): continue
        ph, du, pi, ty = ['<SP>'], [LEAD], [0], [1]
        for w in s['words']:
            ph += ['en_' + '-'.join(phon[w]), '<SP>']; du += [NOTE_DUR, REST_DUR]; pi += [s['midi'], 0]; ty += [2, 1]
        target = dp.process(meta(ph, du, pi, ty), None)
        with torch.no_grad():
            y = model.infer({'prompt': prompt, 'target': target}, auto_shift=False, pitch_shift=0, n_steps=a.steps, cfg=a.cfg, control='score')
        sf.write(path + '.tmp.wav', y.squeeze().cpu().numpy(), SR); os.replace(path + '.tmp.wav', path); done += 1
        print(f'seg {k + 1}/{len(segs)} {s["wav"]} {(time.time() - t0) / done:.1f}s/seg', flush=True)


def slice_bank(a, words, notes):
    import librosa
    rm = json.load(open(os.path.join(a.work, 'render_meta.json')))
    os.makedirs(os.path.join(a.out, 'ogg'), exist_ok=True); os.makedirs(os.path.join(a.out, 'pitched'), exist_ok=True)
    clips, missing = [], 0
    for s in plan(words, notes):
        path = os.path.join(a.work, s['wav'])
        if not os.path.exists(path): missing += 1; continue
        y, _ = sf.read(path, dtype='float32')
        for j, w in enumerate(s['words']):
            t0 = LEAD + j * (NOTE_DUR + REST_DUR)
            seg = y[max(0, int((t0 - 0.12) * SR)):int((t0 + NOTE_DUR + REST_DUR - 0.12) * SR)]
            if len(seg) < SR // 4: continue
            env = librosa.feature.rms(y=seg, frame_length=512, hop_length=128)[0]; thr = max(env.max() * 10 ** (-30 / 20), 1e-4)
            floor = float(20 * np.log10(max(env.min(), 1e-6) / max(env.max(), 1e-6)))  # how far the rest drops below the note
            on = np.where(env > thr)[0]
            if len(on) == 0: continue
            seg = seg[max(0, on[0] * 128 - 240):min(len(seg), on[-1] * 128 + 1200)].copy()
            f = min(120, len(seg) // 4); seg[:f] *= np.linspace(0, 1, f); f2 = min(720, len(seg) // 4); seg[-f2:] *= np.linspace(1, 0, f2)
            f0, vf, _ = librosa.pyin(seg, fmin=80, fmax=1200, sr=SR, frame_length=1024)
            v = f0[vf & ~np.isnan(f0)]; voiced = float(np.mean(vf)) if len(vf) else 0.0
            hz = float(np.median(v)) if len(v) else 0.0
            cents = float(1200 * np.log2(hz / (440 * 2 ** ((s['midi'] - 69) / 12)))) if hz > 0 else None
            ok = cents is not None and abs(cents) <= a.max_cents and voiced >= 0.25 and len(seg) / SR >= 0.2 and floor <= -15
            out = librosa.resample(seg, orig_sr=SR, target_sr=OUT_SR); out = out / max(1e-9, np.abs(out).max()) * 10 ** (-1 / 20)
            rel = f'ogg/{w.lower()}_{s["note"].replace("#", "s")}.ogg'
            if ok: sf.write(os.path.join(a.out, rel), out, OUT_SR, format='OGG', subtype='VORBIS')
            clips.append(dict(word=w.lower(), key='vox_' + w.lower(), note=s['note'], midi=s['midi'], dur=round(len(out) / OUT_SR, 3), f0_hz=round(hz, 2),
                              cents=None if cents is None else round(cents, 1), voiced=round(voiced, 2), floor_db=round(floor, 1), file=rel if ok else None, ok=bool(ok), phonemes=rm['phonemes'][w]))
    good = [c for c in clips if c['ok']]; flat, pitched = {}, {}
    mid = notes[len(notes) // 2]
    for c in good:
        pitched.setdefault(c['key'], {})[c['note']] = ['../' + c['file']]
    for k, m in pitched.items():
        n = mid if mid in m else min(m, key=lambda x: abs(midi_of(x) - midi_of(mid)))
        flat[k] = [m[n][0][3:]]
    json.dump(flat, open(os.path.join(a.out, 'strudel.json'), 'w'), indent=0)
    json.dump(pitched, open(os.path.join(a.out, 'pitched', 'strudel.json'), 'w'), indent=0)
    ce = [abs(c['cents']) for c in good]
    summary = dict(words=len(pitched), clips=len(good), rejected=len(clips) - len(good), segments_missing=missing, notes=notes,
                   median_abs_cents=round(float(np.median(ce)), 1) if ce else None, p95_abs_cents=round(float(np.percentile(ce, 95)), 1) if ce else None)
    json.dump(dict(bank='vox', source='SoulX-Singer (Apache-2.0) score-controlled render; timbre prompt: VocalSet ' + rm['singer'] + ' long tones (CC BY 4.0)',
                   sr=OUT_SR, engine=dict(model='Soul-AILab/SoulX-Singer model.pt', pin=MODEL_PIN, steps=a.steps, cfg=a.cfg, seed=a.seed, control='score', note_dur=NOTE_DUR),
                   prompt_files=['../vocalset/' + f for f in rm['prompt_files']], summary=summary, words=clips), open(os.path.join(a.out, 'words.json'), 'w'), indent=0)
    from hash_banks import write as write_hashes
    write_hashes(a.out)
    print(json.dumps(summary))


def main():
    here = os.path.dirname(os.path.abspath(__file__)); site = os.path.join(here, '..', '..', 'site', 'data', 'vox')
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--code'); p.add_argument('--model'); p.add_argument('--work', required=True)
    p.add_argument('--out', default=os.path.join(site, 'sung')); p.add_argument('--vocalset', default=os.path.join(site, 'vocalset'))
    p.add_argument('--singer', default='female6'); p.add_argument('--notes', default='g3 c4 f4 a#4 d#5 g5')
    p.add_argument('--steps', type=int, default=16); p.add_argument('--cfg', type=float, default=3.0); p.add_argument('--seed', type=int, default=7)
    p.add_argument('--threads', type=int, default=os.cpu_count() or 4); p.add_argument('--max-cents', type=float, default=80.0)
    p.add_argument('--words'); p.add_argument('--limit', type=int, default=0); p.add_argument('--stage', default='all', choices=['render', 'slice', 'all'])
    a = p.parse_args(); os.makedirs(a.work, exist_ok=True)
    words = open(a.words).read().split() if a.words else WORDS
    words = list(dict.fromkeys(w.lower() for w in words))
    if a.limit: words = words[:a.limit]
    notes = a.notes.split()
    if a.stage in ('render', 'all'):
        if not (a.code and a.model): raise SystemExit('--code and --model are required to render')
        render(a, words, notes)
    if a.stage in ('slice', 'all'): slice_bank(a, words, notes)


if __name__ == '__main__':
    main()
