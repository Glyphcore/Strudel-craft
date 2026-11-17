/* glyphcore/freepats levels (#181, #184): the three FreePats recipes through the shared from-t=0 capture of instruments_level.mjs (cold and warm; no clipped sample, rms within 2 dB of the stock synth reference, peak <= 0.5, first-2-s peak within 3 dB of steady). Usage: node tests/site/freepats_level.mjs */
process.env.IDS = 'fp-harp,fp-organ,fp-xylophone'; 
await import('./instruments_level.mjs');
