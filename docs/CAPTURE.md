# Audio capture and download (`site/capture.js`, `site/capture.css`, #72)

Record whatever the transport plays (Rack or Stack) as takes that loop, keep them on the device and download them, phone first.

## Where
- Transport: the record button after Next opens the capture sheet. It pulses red while a take runs, so you can see that it is recording with the sheet closed.
- Command palette (`Ctrl+K`, or the floating button on phones), group Capture: Open capture, Record / stop take, Record N cycles (loop), Render exact N cycles (offline).
- The sheet does not block the page: the Rack and Stack stay playable and editable while it records.

## Tap
`app.js` routes every Strudel connection to the destination into one master `GainNode` (the bus). It exposes that bus as `strudelCraft.transport.bus = {ctx, node, own}`.
`capture.js` connects `bus.node` to an `AudioWorkletNode` loaded from a Blob module. If AudioWorklet is missing it falls back to a `ScriptProcessorNode`.
The worklet writes silent output. That output goes to the destination only so the node gets pulled. The node is in `bus.own`, so app.js's redirect skips it. What you hear does not change. The tap sits after the master level, so a take sounds like what is heard.
Each block carries its `currentFrame`, so every sample has an absolute frame index on the AudioContext clock. Takes use the live context's sample rate (44.1 or 48 kHz, whichever the device uses). The tap attaches on the first Record. Autoplay rules apply, so Record starts the transport from the tap when needed.

## Arm modes
- **Cycles**: the start is the next cycle boundary, plus the count-in. The end is `start + round(N / cps * sampleRate)` frames, so the length is exact and the take loops. Strudel's Cyclist plays a hap at cycle `c` at `lastTick + (c - lastBegin) / cps + latency` (AudioContext time). `capture.js` uses the same formula to turn the boundary into a frame. Test: the realtime cut lines up with the offline render at a 0 ms onset lag.
- **Free**: from now (or from the boundary after the count-in) until you press Stop. Pre-roll prepends up to the chosen seconds from a ring buffer, which fills while the transport plays and the sheet is open.
- **Until stop**: like Free, capped by what is left of the play-time limit (`strudelCraft.range`).
- If the transport stops, the take ends and is saved. A Cycles take cut short is saved as not exact.
- Tab switches: Follow tab hot-swaps the program on the bus, so a take runs on across Rack/Stack switches. On a hidden browser tab the worklet keeps sending blocks and the take still ends on its frame. Only the UI redraw is throttled.
- A tempo change during a Cycles take is not followed: the length is fixed when the take starts.

## Render exact N cycles (offline)
`strudelCraft.transport.compile()` evaluates the current source without starting it, or takes the playing pattern. `capture.js` then stops the transport and does the following:
1. Suspends the live context. superdough's `onended` cleanups build nodes on the *current* context, so no live source may end while the offline context is current.
2. Swaps superdough to an `OfflineAudioContext` (`setAudioContext`, `setSuperdoughAudioController(null)`, `loadWorklets()`).
3. Calls `superdough()` for every onset hap in `[0, N)` in onset order. This is what Strudel's own `renderPatternAudio` does, but without closing the live context or auto-downloading.
4. Renders, waits 300 ms so the offline `onended` cleanups run while the offline context is still current, then restores and resumes the live context and controller.

Length: `round(N / cps * sampleRate)` frames, faster than real time. Fold tail (on by default) renders up to 4 s more and adds it back onto the start, which gives the steady-state loop. The master level is applied so that exact and realtime takes match.

Limits:
- Live transport effects are not in the offline render: hooks, pads, perform mappings and the transport loop/seek.
- superdough pools filter and compressor nodes in WeakRef pools that ignore the context. On the first render, `capture.js` makes `WeakRef.prototype.deref` return `undefined` for an AudioNode of any context other than superdough's current one. A pool then never hands a node across contexts, in either direction. Any events that still fail are counted (`meta.fails`) and reported in the toast.
- Worklet effects need `loadWorklets()` on the offline context. If that fails, those effects are silent.
- Samples must be loadable. The sample maps load before the render.
- Takes are always stereo at the live sample rate.

## Takes and storage
- IndexedDB `sc-capture`, object store `takes`. Records are `{meta, audio: {L, R}}` (Float32). `meta` = `{id, kind: 'take', name, created, sr, frames, seconds, cycles, cps, mode, exact, loop, how: 'realtime'|'offline', preRoll, fold, startCycle, haps, fails, peak, peaks[320], source: {kind, title, code}, bytes}`.
- Settings are in `localStorage` `sc.capture.{mode,n,countIn,preRoll,name,bits,fold}`, so the history store versions them. Audio never goes into history.
- `navigator.storage.estimate()` drives the usage line. Past 80% or under 64 MB free, it turns into a warning and a toast. On the first save, `navigator.storage.persist()` is requested.
- Preview plays through an `HTMLAudioElement` on a looping WAV, not through the WebAudio bus, so a preview is never recorded.

## Downloads
- A Blob plus an `<a download>` anchor, which works on the live site and on phones. Name: `<name>_<cycles>c_<cps>cps.<ext>`, e.g. `loop_2c_0.5cps.wav`.
- WAV: 16 or 24 bit PCM stereo, encoded in the browser. A `LIST/INFO` chunk holds INAM (name), ISFT, ICRD and ICMT (JSON with cycles, cps, exact, loop, how and the pattern source).
- Compressed: the first format `MediaRecorder` supports out of `audio/webm;codecs=opus`, `audio/ogg;codecs=opus`, `audio/mp4`. The take plays once in real time through a private, silent AudioContext into MediaRecorder at 160 kb/s. No MP3 library is bundled.
- JSON sidecar `strudel-craft/capture@1`: every meta field except the peaks, plus the WAV file name.

## API
`strudelCraft.capture = { open, close, toggle, configure(opts), record(opts), stop, toggleRec, renderExact(n), list, get(id), remove(id), rename(id, name), download(id, 'wav16'|'wav24'|'comp'|'json'), encodeWav(take, bits), sidecar(take), fileName(take, ext), opts, state }`.

## Test
`node tests/site/capture.mjs` runs at 360x740:
- the transport and sheet: 44px targets, no overflow, knob readouts whole;
- palette actions;
- Record 2 cycles: the take is listed, has the exact frame count and a non-silent waveform;
- WAV 16 and 24 headers and lengths;
- the file name and the download anchor;
- recording across Rack -> Stack -> Rack;
- exact render length and level;
- realtime/offline onset alignment;
- playback after a render;
- no console errors.

It writes `docs/screens/phone-360-capture.png`.
