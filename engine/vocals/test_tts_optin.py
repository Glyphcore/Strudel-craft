# #46: without --tts-fallback no socket is opened (network blocked); run: python3 engine/vocals/test_tts_optin.py
import sys, json, socket, tempfile, numpy as np, soundfile as sf
from pathlib import Path
sys.path.insert(0,'/home/user/Strudel-craft/engine/vocals'); import wordbank as wb
tmp=Path(tempfile.mkdtemp()); sr=48000
x=(0.3*np.sin(2*np.pi*220*np.arange(3*sr)/sr)).astype(np.float32); sf.write(tmp/'s.wav',x,sr)
(tmp/'l.txt').write_text('hello world\n')
(tmp/'t.json').write_text(json.dumps([{'word':'hello','start':.2,'end':.8,'score':.9},{'word':'world','start':None,'end':None}]))
calls=[]
def blocked(*a,**k): calls.append(a); raise OSError('network blocked')
socket.socket.connect=blocked; socket.create_connection=blocked
rc=wb.build(tmp/'s.wav',tmp/'l.txt',tmp/'off','vox',tmp/'t.json','rule',True,'whisperx',True)
print('NOFLAG rc',rc,'socket attempts',len(calls),'keys',list(json.load(open(tmp/'off/strudel.json'))))
