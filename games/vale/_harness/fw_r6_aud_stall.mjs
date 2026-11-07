// VALE harness — round 6 AUD-5 / AUD-7: a stall in a section's look-ahead keeps the music, and the draft bed's buffers
// become the match bed's windows.
//
//   node _harness/fw_r6_aud_stall.mjs [--out _harness/_reports/fw_r6_aud_stall.json]
//
// The real engine (dev client, ?dev=1&render=0) in real Chrome on the fake sink (the clock runs), the RIFT match bed
// streaming (src/audio/index.ts `stream`). A tally rides the page: every AudioBufferSourceNode started, 'live' while it
// has not ended and still holds its buffer; every createBuffer of a section window's shape; the music bus metered.
//   G1  (AUD-5, r5_AUD_verify1 AUD-3-gap) the context suspended after the next section is scheduled (inside the 3 s
//       look-ahead), resumed 3 s later: the music sounds at once (no metered block under -60 dBFS from 0.15 s after the
//       resume to 1 s past the downbeat), the playing section's sources were kept through the stall (long live sources
//       at the suspend and just after the resume the same), and never more than cur + next + the objective layer play
//       (<= 5 long sources); 1 s past the downbeat only the new section (+ objective) plays (<= 3)
//   G2  the same stall, the bed changed (to the menu) while it stands, then resumed: no source of the match bed is
//       left (0 foreign long sources), nothing retired waits (release dying = 0 after 3 s)
//   G3  (AUD-7) draft -> RIFT: the draft bed's 4 buffers are handed over and the match bed's first windows decode into
//       them (releaseStats.reused >= 4, at most 1 new window-shaped buffer: the objective layer); the match bed sounds
//       within 2.5 s of the switch; audio MB read without a GC 1 s and 3 s after the switch (the probes' first poll)
// Exit 0 = all hold, 1 = a gate fails, 2 = the run failed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadavg } from 'node:os';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'fw_r6_aud_stall.json');
const WIN = 1564800;     // a RIFT section window: (32 s + 2 x 0.3 s) x 48 kHz
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const TALLY = `(() => {
  const live = new Set();
  const S = AudioBufferSourceNode.prototype, st = S.start;
  S.start = function (...a) { const r = new WeakRef(this); const e = { r, ended: false }; live.add(e); this.addEventListener('ended', () => { e.ended = true; }); return st.apply(this, a); };
  window.__srcLive = () => { const out = []; for (const e of live) { const s = e.r.deref(); if (!s || e.ended) { live.delete(e); continue; } if (s.buffer) out.push(s); } return out; };
  window.__srcLong = () => window.__srcLive().filter((s) => s.buffer.duration >= 10).length;
  window.__srcForeign = () => { const own = window.__valeAudio.bedBuffers(); return window.__srcLive().filter((s) => s.buffer.duration >= 10 && !own.has(s.buffer)).length; };
  const B = BaseAudioContext.prototype, cb = B.createBuffer;
  window.__winMade = 0;
  B.createBuffer = function (...a) { if (a[1] === ${WIN}) window.__winMade++; return cb.apply(this, a); };
})();`;

const rep = { probe: 'fw_r6_aud_stall', at: new Date().toISOString(), load: [loadavg()[0].toFixed(2)], err: null, gates: {}, pass: false };
const release = await holdHeavy('fw_r6_aud_stall');
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
browser.on('disconnected', release);
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.routeWebSocket(/.*/, () => {});
  await context.addInitScript({ path: join(HERE, 'fw_r4_mem_track.js') });
  await context.addInitScript({ content: TALLY });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`${BASE}/?dev=1&render=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
  // the music bus metered (an analyser pulls on its own)
  await page.evaluate(() => {
    const a = window.__valeAudio, g = a.graph; const an = g.ctx.createAnalyser(); an.fftSize = 2048; g.bus.music.connect(an);
    const d = new Float32Array(an.fftSize);
    window.__musicDb = () => { an.getFloatTimeDomainData(d); let s = 0; for (const x of d) s += x * x; return 10 * Math.log10(s / d.length + 1e-20); };
  });
  const bedIn = (id) => page.waitForFunction((b) => { const a = window.__valeAudio; return a.bed?.id === b && !!a.bed.main && a.bed.layers.every((l) => !!l.src || l.role === 'objective'); }, id, { timeout: 60000, polling: 100 });

  // ── G3: draft -> RIFT, the hand-over ─────────────────────────────────────────────────────────
  await page.evaluate(() => window.__valeAudio.music('mus_draft'));
  await bedIn('mus_draft');
  await page.waitForTimeout(3000);
  const g3 = { before: await page.evaluate(() => ({ audio: window.__memTrack().audio.mb, rel: { ...window.__valeAudio.releaseState.stats }, made: window.__winMade,
    draftLens: window.__valeAudio.bed.layers.map((l) => l.buf?.length ?? null).concat([window.__valeAudio.bed.main.buffer?.length ?? null]) })) };
  const sw = Date.now();
  await page.evaluate(() => window.__valeAudio.music('mus_match_rift'));
  await page.waitForFunction(() => !!window.__valeAudio.bed?.main, null, { timeout: 30000, polling: 20 });
  g3.soundsAfterS = +((Date.now() - sw) / 1000).toFixed(2);
  await page.waitForTimeout(Math.max(0, 1000 - (Date.now() - sw)));
  g3.at1s = await page.evaluate(() => ({ audio: window.__memTrack().audio.mb, n: window.__memTrack().audio.n }));
  await page.waitForTimeout(Math.max(0, 3000 - (Date.now() - sw)));
  g3.at3s = await page.evaluate(() => ({ audio: window.__memTrack().audio.mb, n: window.__memTrack().audio.n, largest: window.__memTrack().audio.largest.slice(0, 8) }));
  await page.waitForTimeout(3000);
  g3.after = await page.evaluate(async () => ({ rel: { ...window.__valeAudio.releaseState.stats }, made: window.__winMade, stream: window.__valeAudio.musicStream, dec: await window.__valeAudio.decoded() }));
  g3.reused = g3.after.rel.reused - g3.before.rel.reused;
  g3.handed = g3.after.rel.handed - g3.before.rel.handed;
  g3.newWindowBuffers = g3.after.made - g3.before.made;
  g3.heldMb = g3.after.stream?.heldMb ?? null; g3.windowMb = g3.after.stream?.windowMb ?? null; g3.pooledMb = g3.after.stream?.pooledMb ?? null;
  delete g3.after.stream;
  rep.G3 = g3;
  rep.gates.G3_handover = g3.handed >= 4 && g3.reused >= 4 && g3.newWindowBuffers <= 1 && g3.soundsAfterS <= 2.5;
  log('G3', JSON.stringify({ handed: g3.handed, reused: g3.reused, newWin: g3.newWindowBuffers, sounds: g3.soundsAfterS, at1s: g3.at1s, at3s: g3.at3s.audio, before: g3.before.audio, lens: g3.before.draftLens }));

  // ── a stall in the look-ahead ─────────────────────────────────────────────────────────────────
  const stallIn = async (tag, change) => {
    // the next section scheduled: musicStream.next set (the look-ahead), its downbeat the last section decided
    await page.waitForFunction(() => { const m = window.__valeAudio.musicStream; return m && m.next !== null; }, null, { timeout: 45000, polling: 50 });
    const s = await page.evaluate(() => { const a = window.__valeAudio; const T = a.musicActs.sections.at(-1)?.at ?? null; return { T, ctx: a.graph.ctx.currentTime, long: window.__srcLong(), db: window.__musicDb() }; });
    await page.evaluate(() => window.__valeAudio.graph.ctx.suspend());
    await page.waitForTimeout(150);
    s.longSuspended = await page.evaluate(() => window.__srcLong());
    s.rel = await page.evaluate(() => window.__valeAudio.releaseState);
    if (change) {
      await page.evaluate(() => window.__valeAudio.music('mus_menu'));
      await page.waitForTimeout(500);
    }
    await page.waitForTimeout(3000);
    await page.evaluate(() => window.__valeAudio.graph.ctx.resume());
    const resumedAt = await page.evaluate(() => window.__valeAudio.graph.ctx.currentTime);
    s.resumedCtx = +resumedAt.toFixed(3);
    s.longResumed = await page.evaluate(() => window.__srcLong());
    // meter from the resume to 1 s past the downbeat (or 4 s on)
    s.blocks = await page.evaluate(async ({ T, r }) => {
      const ctx = window.__valeAudio.graph.ctx, out = [];
      const end = T !== null ? T + 1 : r + 4;
      while (ctx.currentTime < end && out.length < 400) { await new Promise((q) => setTimeout(q, 40)); out.push([+(ctx.currentTime - r).toFixed(3), +window.__musicDb().toFixed(1), window.__srcLong()]); }
      return out;
    }, { T: s.T, r: resumedAt });
    const after = s.blocks.filter(([dt]) => dt >= 0.15);
    s.minDb = after.length ? Math.min(...after.map((b) => b[1])) : null;
    s.silentBlocks = after.filter((b) => b[1] < -60).length;
    s.firstSoundS = (s.blocks.find((b) => b[1] >= -60) ?? [null])[0];
    s.maxLong = Math.max(...s.blocks.map((b) => b[2]));
    s.longPastDownbeat = s.blocks.at(-1)?.[2] ?? null;
    await page.waitForTimeout(3000);
    s.end = await page.evaluate(() => ({ long: window.__srcLong(), foreign: window.__srcForeign(), rel: window.__valeAudio.releaseState, bed: window.__valeAudio.bed?.id ?? null, stream: window.__valeAudio.musicStream }));
    log(tag, JSON.stringify({ T: s.T, ctx: s.ctx, long: s.long, longSuspended: s.longSuspended, longResumed: s.longResumed, firstSoundS: s.firstSoundS, minDb: s.minDb, silent: s.silentBlocks, maxLong: s.maxLong, pastDownbeat: s.longPastDownbeat, end: { long: s.end.long, foreign: s.end.foreign, dying: s.end.rel.dying, bed: s.end.bed } }));
    return s;
  };

  rep.G1 = await stallIn('G1', false);
  const g1 = rep.G1;
  rep.gates.G1_musicAtOnce = g1.T !== null && g1.T - g1.ctx <= 3.05 && g1.silentBlocks === 0 && g1.firstSoundS !== null && g1.firstSoundS <= 0.15;
  rep.gates.G1_keptThroughStall = g1.longSuspended === g1.long && g1.longResumed === g1.long;
  rep.gates.G1_noDoublePlay = g1.maxLong <= 5 && g1.longPastDownbeat <= 3 && g1.end.foreign === 0;

  rep.G2 = await stallIn('G2', true);
  const g2 = rep.G2;
  rep.gates.G2_bedChangeFrees = g2.end.bed === 'mus_menu' && g2.end.foreign === 0 && g2.end.rel.dying === 0 && g2.end.rel.stalled === false;
  for (const g of [rep.G1, rep.G2]) delete g.end.stream;
  rep.errors = errs.slice(0, 10);
  rep.pass = Object.values(rep.gates).every(Boolean) && !errs.length;
} catch (e) { rep.err = String(e?.stack ?? e); }
rep.load.push(loadavg()[0].toFixed(2));
await browser.close().catch(() => {});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
log(rep.err ? `ERR ${rep.err}` : `gates ${JSON.stringify(rep.gates)}`, 'load', rep.load.join('->'));
log(rep.err ? 'RUN FAILED' : rep.pass ? 'PASS' : 'FAIL', '->', OUT);
process.exit(rep.err ? 2 : rep.pass ? 0 : 1);
