// VALE harness — round 5 AUD-4: a streamed stem's windows are the whole decode's samples.
//
//   node _harness/fw_r5_aud_stream.mjs [--beds mus_match_rift,mus_match_bridge,mus_match_fray] [--out _harness/_reports/fw_r5_aud_stream.json]
//
// In real Chrome (fake sink, dev client): each long bed stem is decoded whole by decodeAudioData and by windows through
// src/audio/opus_stream.ts (WebCodecs, cold decoder per window, pre-roll), and each window is compared sample by
// sample with the same span of the whole decode (wrapping past either end). Gates:
// Windows: 32 s (a match bed's sections) for match beds, 16 s (LOOP_WINDOW_S) for the menu's and post-game's loops.
//   W1  the timelines agree: the stem's length = the whole decode's length (samples)
//   W2  every window's error under -70 dB re the span's own RMS, and its peak error under -60 dBFS
// Exit 0 = hold, 1 = fail, 2 = run failed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const BEDS = opt('--beds', 'mus_match_rift,mus_match_bridge,mus_match_fray,mus_menu,mus_postgame').split(',');
const OUT = opt('--out', join(HERE, '_reports', 'fw_r5_aud_stream.json'));

const release = await holdHeavy('fw_r5_aud_stream');
const rep = { probe: 'fw_r5_aud_stream', at: new Date().toISOString(), load: [+loadavg()[0].toFixed(2)], files: [], err: null };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
try {
  const context = await browser.newContext();
  await context.routeWebSocket(/.*/, () => {});
  const page = await context.newPage();
  await page.goto(`${BASE}/?dev=1&render=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  const refs = await page.evaluate((beds) => beds.flatMap((b) => { const d = window.__valeAudio.beds[b]; const w = /mus_match/.test(b) ? 32 : 16; return d ? [d.file, ...d.layers.filter((l) => l.id === 'intense' || l.id.startsWith('stem')).map((l) => l.file)].map((x) => [x, w]) : []; }), BEDS);
  for (const f of refs) {
    const r = await page.evaluate(async ([ref, winS]) => {
      const { OpusStem } = await import('/src/audio/opus_stream.ts');
      const name = ref.replace(/.*\//, '');
      const bytes = await (await fetch(window.__valeAudio.url(ref))).arrayBuffer();
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      const supported = await OpusStem.supported(2);
      const stem = OpusStem.parse(bytes.slice(0));
      const whole = await ctx.decodeAudioData(bytes.slice(0));
      if (!stem) return { name, supported, parsed: false, wholeLen: whole.length };
      const L = whole.length, sr = 48000, H = Math.round(0.3 * sr), W = winS * sr;
      const spans = [];
      for (let k = 0; k * W < L; k++) spans.push([k * W - H, Math.min(L, (k + 1) * W) + H]);
      const rows = [];
      for (const [a, b] of spans) {
        const t = performance.now();
        const buf = await stem.window(ctx, a, b);
        const ms = performance.now() - t;
        if (!buf) { rows.push({ a, b, ok: false }); continue; }
        let se = 0, ss = 0, pk = 0;
        for (let c = 0; c < 2; c++) {
          const w = buf.getChannelData(c), x = whole.getChannelData(c);
          for (let i = 0; i < b - a; i++) {
            const j = (((a + i) % L) + L) % L;
            const e = w[i] - x[j];
            se += e * e; ss += x[j] * x[j]; if (Math.abs(e) > pk) pk = Math.abs(e);
          }
        }
        rows.push({ a: +(a / sr).toFixed(2), b: +(b / sr).toFixed(2), ms: Math.round(ms), errDb: +(10 * Math.log10(se / (ss + 1e-30) + 1e-30)).toFixed(1), peakErrDb: +(20 * Math.log10(pk + 1e-12)).toFixed(1), ok: true });
      }
      return { name, winS, supported, parsed: true, stemLen: stem.length, wholeLen: whole.length, kb: Math.round(stem.bytes / 1024), wholeMb: +(whole.length * 2 * 4 / 1048576).toFixed(1), rows };
    }, f);
    r.W1 = r.parsed && r.stemLen === r.wholeLen;
    r.W2 = r.parsed && r.rows.every((x) => x.ok && x.errDb <= -70 && x.peakErrDb <= -60);
    console.log(JSON.stringify(r));
    rep.files.push(r);
  }
} catch (e) { rep.err = String(e?.stack ?? e); console.log(rep.err); }
await browser.close().catch(() => {});
release();
rep.load.push(+loadavg()[0].toFixed(2));
rep.pass = !rep.err && rep.files.length > 0 && rep.files.every((r) => r.W1 && r.W2);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
console.log(rep.pass ? 'PASS' : 'FAIL', '->', OUT, 'load', rep.load.join('->'));
process.exit(rep.err ? 2 : rep.pass ? 0 : 1);
