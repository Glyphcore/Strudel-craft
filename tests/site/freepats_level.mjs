/* glyphcore/freepats levels (#181, #184): the three FreePats recipes through the shared from-t=0 capture of instruments_level.mjs (cold and warm; no clipped sample, steady peak 0.1..0.98, first-2-s peak within 3 dB of steady). Usage: node tests/site/freepats_level.mjs */
process.env.IDS = 'fp-harp,fp-organ,fp-xylophone'; process.env.LEVEL = '0.1,0.98';
await import('./instruments_level.mjs');
