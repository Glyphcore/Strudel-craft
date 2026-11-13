"""#44: provider completion + config-registered second provider. Run: python3 tests/vocals/test_complete.py"""
import json, subprocess, sys, tempfile
from pathlib import Path
C = Path(__file__).resolve().parents[2] / 'engine/vocals/complete.py'
def run(*a): return json.loads(subprocess.run([sys.executable, str(C), *a], check=True, capture_output=True, text=True).stdout)['items']
with tempfile.TemporaryDirectory() as t:
    t = Path(t); b = t / 'bank'; b.mkdir()
    (b / 'strudel.json').write_text(json.dumps({'vox_baby': ['a.wav', 'b.wav', 'c.wav'], 'vox_call': ['d.wav'], 'vox_syl': ['e.wav'], 'kick': ['k.wav']}))
    (b / 'words.json').write_text(json.dumps({'bank': 'vox', 'words': [{'key': 'vox_baby'}, {'key': 'vox_baby'}, {'key': 'vox_baby'}, {'key': 'vox_call'}]}))
    it = run('ba', '--samples-dir', str(b))
    baby = [i for i in it if i['name'] == 'baby']
    assert baby and all(i['kind'] == 'word' and i['n'] == 3 for i in baby), it
    # second provider via config entry only (a module + a builtin), no change to complete.py
    (t / 'plug.py').write_text("class P:\n id='extra'\n def list(s): return [{'name':'bazinga','kind':'sample','detail':'x','n':1}]\n def resolve(s,n): return None\ndef provider(cfg): return P()\n")
    (t / 'cfg.json').write_text(json.dumps({'providers': [{'id': 'extra', 'module': 'plug.py'}, {'id': 'drums', 'type': 'samples-dir', 'path': 'bank'}]}))
    it = run('ba', '--config', str(t / 'cfg.json'))
    assert {i['provider'] for i in it} == {'extra', 'drums'} and any(i['name'] == 'bazinga' for i in it) and any(i['name'] == 'baby' for i in it), it
print('ok')
