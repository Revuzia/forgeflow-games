// VALE harness — round 5 AUD-3: a stalled or switched output device never pins decoded audio.
//
//   node _harness/fw_r5_aud_release.mjs [--sinks device,fake] [--out _harness/_reports/fw_r5_aud_release.json]
//
// The real engine (dev client, ?dev=1&render=0) in real Chrome, once on the Mac's own output device (this Mac's is
// stalled: the context reads 'running' and its clock stands still) and once on Chrome's fake sink (the clock runs).
// _harness/fw_r4_mem_track.js rides the page (live AudioBuffers after a GC), plus a source tally: every
// AudioBufferSourceNode started, held weakly, 'live' while it has not ended and still has its buffer.
//   journey   menu → draft → RIFT match bed (+ a burst of cues, a loop) → postgame → menu, each bed decoded before the
//             next; then 4 s for the last fade to be due, a GC, the tally
//   R1        audio MB at the end (the burst's cues freed as a match change frees them) within 10 MB of the menu bed + the UI
//             set alone (the same page read after the first menu)
//   R2        live sources with a long buffer (>= 10 s) at the end: only the menu bed's (its whole files or, streamed, its
//             windows: window.__valeAudio.bedBuffers()), at least its 3 stems
//   S1        (fake sink) the context suspended mid-bed (the device gone: no clock), the bed changed twice while it
//             stands, then resumed: one bed sounds, the one the screen wants, and the beds retired during the stall
//             hold no buffer (live sources = that bed's, audio MB = that bed + the UI set)
// Exit 0 = all hold, 1 = one fails, 2 = the run failed.
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
const SINKS = opt('--sinks', 'device,fake').split(',');
const OUT = opt('--out', join(HERE, '_reports', 'fw_r5_aud_release.json'));
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const TALLY = `(() => {
  const live = new Set();
  const S = AudioBufferSourceNode.prototype, st = S.start;
  S.start = function (...a) { const r = new WeakRef(this); const e = { r, ended: false }; live.add(e); this.addEventListener('ended', () => { e.ended = true; }); return st.apply(this, a); };
  window.__srcLive = () => { const out = []; for (const e of live) { const s = e.r.deref(); if (!s || e.ended) { live.delete(e); continue; } if (s.buffer) out.push(s); } return out; };
  window.__srcTally = () => window.__srcLive().map((s) => +s.buffer.duration.toFixed(1)).sort((a, b) => b - a);
  window.__srcForeign = () => { const own = window.__valeAudio.bedBuffers(); return window.__srcLive().filter((s) => s.buffer.duration >= 10 && !own.has(s.buffer)).length; };
})();`;

async function run(sink) {
  const rep = { sink, err: null, load: [loadavg()[0].toFixed(2)] };
  const browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--js-flags=--expose-gc', ...(sink === 'fake' ? ['--disable-audio-output'] : [])] });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await context.routeWebSocket(/.*/, () => {});
    await context.addInitScript({ path: join(HERE, 'fw_r4_mem_track.js') });
    await context.addInitScript({ content: TALLY });
    const page = await context.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    const cdp = await context.newCDPSession(page);
    const gcRead = async () => {
      for (let i = 0; i < 3; i++) { await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(300); }
      return page.evaluate(async () => ({ audio: window.__memTrack().audio, live: window.__srcTally(), foreign: window.__srcForeign(), rel: window.__valeAudio.releaseState,
        stream: window.__valeAudio.musicStream,
        bed: window.__valeAudio.bed?.id ?? null, dec: await window.__valeAudio.decoded() }));
    };
    await page.goto(`${BASE}/?dev=1&render=0`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
    const bedIn = (id) => page.waitForFunction((b) => { const a = window.__valeAudio; return a.bed?.id === b && !!a.bed.main && a.bed.layers.every((l) => !!l.src); }, id, { timeout: 60000, polling: 200 });
    const to = async (id) => { await page.evaluate((b) => window.__valeAudio.music(b), id); await bedIn(id); log(sink, 'bed in', id); };
    await to('mus_menu');
    await page.waitForTimeout(4000);
    rep.menu0 = await gcRead();
    log(sink, 'menu0', rep.menu0.audio.mb, 'MB, live', JSON.stringify(rep.menu0.live), JSON.stringify(rep.menu0.rel));
    await to('mus_draft');
    await to('mus_match_rift');
    // a burst of cues and a loop (one-shots, voices displaced by the budget)
    await page.evaluate(() => { const a = window.__valeAudio; const ids = Object.keys(a.cues).filter((k) => a.cues[k].bus !== 'music').slice(0, 60); for (const k of ids) a.play(k); });
    await page.waitForTimeout(3000);
    rep.match = await gcRead();
    log(sink, 'match', rep.match.audio.mb, 'MB, live', rep.match.live.length);
    await to('mus_postgame');
    await to('mus_menu');
    await page.waitForTimeout(4000);
    // the cues the burst decoded are the cache's (a match change frees them): free them as a match change does
    await page.evaluate(() => window.__valeAudio.evictCues());
    rep.menu1 = await gcRead();
    log(sink, 'menu1', rep.menu1.audio.mb, 'MB, live', JSON.stringify(rep.menu1.live), JSON.stringify(rep.menu1.rel));
    rep.clock = await page.evaluate(() => window.__memTrack().clock);
    rep.R1 = Math.abs(rep.menu1.audio.mb - rep.menu0.audio.mb) <= 10;
    rep.R2 = rep.menu1.foreign === 0 && rep.menu1.live.filter((d) => d >= 10).length >= 3;
    if (sink === 'fake') {
      // S1: the device goes (suspend), the screen changes twice, the device comes back
      await page.evaluate(() => window.__valeAudio.graph.ctx.suspend());
      await page.waitForTimeout(1500);
      await page.evaluate(() => window.__valeAudio.music('mus_postgame'));
      await page.waitForFunction(() => !!window.__valeAudio.bed?.main, null, { timeout: 60000 });
      await page.evaluate(() => window.__valeAudio.music('mus_draft'));
      await page.waitForFunction(() => { const b = window.__valeAudio.bed; return b?.id === 'mus_draft' && !!b.main && b.layers.every((l) => !!l.src); }, null, { timeout: 60000 });
      const during = await gcRead();
      await page.evaluate(() => window.__valeAudio.graph.ctx.resume());
      await page.waitForTimeout(4000);
      rep.stall = { during, after: await gcRead() };
      log(sink, 'stall during', during.audio.mb, 'MB live', JSON.stringify(during.live), 'after', rep.stall.after.audio.mb, 'MB live', JSON.stringify(rep.stall.after.live), JSON.stringify(rep.stall.after.rel));
      // the draft bed: main + 3 layers, 32 s each; nothing else long
      const a = rep.stall.after;
      rep.S1 = a.bed === 'mus_draft' && a.foreign === 0 && a.live.filter((d) => d >= 10).length === 4 && a.rel.stalled === false;
    }
    rep.errors = errs.slice(0, 10);
  } catch (e) { rep.err = String(e?.stack ?? e); }
  rep.load.push(loadavg()[0].toFixed(2));
  await browser.close().catch(() => {});
  return rep;
}

const release = await holdHeavy('fw_r5_aud_release');
const out = { probe: 'fw_r5_aud_release', at: new Date().toISOString(), runs: [] };
for (const s of SINKS) out.runs.push(await run(s));
release();
out.pass = out.runs.every((r) => !r.err && r.R1 && r.R2 && (r.sink !== 'fake' || r.S1));
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
for (const r of out.runs) log(r.sink, r.err ? `ERR ${r.err}` : `R1 ${r.R1} R2 ${r.R2}${r.sink === 'fake' ? ` S1 ${r.S1}` : ''} menu0 ${r.menu0.audio.mb} match ${r.match.audio.mb} menu1 ${r.menu1.audio.mb} MB, clock ${JSON.stringify(r.clock)}, load ${r.load.join('->')}`);
log(out.pass ? 'PASS' : 'FAIL', '->', OUT);
process.exit(out.runs.some((r) => r.err) ? 2 : out.pass ? 0 : 1);
