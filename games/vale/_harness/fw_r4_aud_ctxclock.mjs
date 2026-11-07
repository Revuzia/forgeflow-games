// VALE harness — does the AudioContext clock advance? (fw r4 AUD-1)
//
//   node _harness/fw_r4_aud_ctxclock.mjs [--out <report.json>] [--match S] [--map rift_coop]
//
// The audio_mix probe hung on ctx.currentTime frozen while state read 'running'. This tells a client bug from a
// browser / output-device stall, in three steps on the same harness Chrome (pw.mjs: headless, real GPU):
//   bare    about:blank-like page, a plain AudioContext + a running oscillator into the destination: does its clock move?
//   client  the real client (?dev=1&render=0&autopilot=1&autoflow=1), one key gesture: the engine's own context, at the
//           menu, then in a queued match for --match s (default 60) of wall time. Each 1 s: state, currentTime,
//           baseLatency, outputLatency, getOutputTimestamp, match time, document visibility, and whether the engine's
//           graph.ctx is still the same object as the first one seen (re-created / replaced context).
//   info (not gated): a page-side kick in the bare page (suspend + resume, then close + a new context), and the bare
//   page again on Chrome's fake sink (--disable-audio-output), which needs no output device.
//   Also counts every suspend()/close()/resume()/setSinkId() call on any AudioContext (wrapped before the page runs).
// Verdict per step: clock 'advancing' (>= 80 % of wall time) or 'frozen'. Exit 0 = every step advancing.
// Report → _harness/_reports/fw_r4_aud_ctxclock.json

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';
import { open, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const OUT = arg('--out', join(HERE, '_reports', 'fw_r4_aud_ctxclock.json'));
const MATCH_S = Number(arg('--match', 60));
const QUEUE = arg('--map', 'rift_coop');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

// installed before any page script: counts context lifecycle calls
const SPY = () => {
  const c = { suspend: 0, close: 0, resume: 0, setSinkId: 0, created: 0 };
  window.__ctxSpy = c;
  const P = window.AudioContext && window.AudioContext.prototype;
  if (!P) return;
  for (const k of ['suspend', 'close', 'resume', 'setSinkId']) {
    const f = P[k];
    if (typeof f !== 'function') continue;
    P[k] = function (...a) { c[k]++; return f.apply(this, a); };
  }
  const AC = window.AudioContext;
  window.AudioContext = class extends AC { constructor(...a) { super(...a); c.created++; } };
};

const SAMPLE = () => {
  const a = window.__valeAudio;
  const ctx = a?.graph?.ctx ?? window.__bareCtx;
  window.__firstCtx ??= ctx;
  let ts = null;
  try { const o = ctx?.getOutputTimestamp?.(); ts = o ? { ct: o.contextTime, pt: o.performanceTime } : null; } catch { /* none */ }
  return {
    wall: performance.now() / 1000, state: ctx?.state ?? null, ct: ctx?.currentTime ?? null,
    base: ctx?.baseLatency ?? null, outLat: ctx?.outputLatency ?? null, ts,
    same: ctx === window.__firstCtx, t: window.__vale?.state?.match?.value?.view?.time ?? null,
    vis: document.visibilityState, focus: document.hasFocus(), spy: { ...(window.__ctxSpy ?? {}) },
  };
};

function verdict(rows) {
  if (rows.length < 2) return { verdict: 'not measured', rows: rows.length };
  const a = rows[0], b = rows[rows.length - 1];
  const wall = b.wall - a.wall, clock = (b.ct ?? 0) - (a.ct ?? 0);
  return { verdict: clock >= 0.8 * wall ? 'advancing' : 'frozen', wallS: +wall.toFixed(2), clockS: +clock.toFixed(3),
    ctFirst: a.ct, ctLast: b.ct, states: [...new Set(rows.map((r) => r.state))], sameCtx: rows.every((r) => r.same),
    spyLast: b.spy, outLat: b.outLat, base: b.base, ts: b.ts, vis: [...new Set(rows.map((r) => r.vis))] };
}

async function sampleFor(page, s, tag) {
  const rows = [];
  const end = Date.now() + s * 1000;
  while (Date.now() < end) { rows.push(await page.evaluate(SAMPLE)); await page.waitForTimeout(1000); }
  const v = verdict(rows);
  log(tag, JSON.stringify(v));
  return { ...v, sample: rows.filter((_, i) => i % 5 === 0 || i === rows.length - 1) };
}

const report = { probe: 'fw_r4_aud_ctxclock', at: new Date().toISOString(), steps: {}, info: {} };
let browser;
try {
  // bare
  {
    const b = await open('/?dev=1&render=0', { hmr: false, wait: false });
    browser = b.browser;
    const page = b.page;
    await page.goto('about:blank');
    await page.evaluate(async () => {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const o = ctx.createOscillator(); const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(g).connect(ctx.destination); o.start();
      await ctx.resume();
      window.__bareCtx = ctx;
    });
    report.steps.bare = await sampleFor(page, 6, 'bare');
    // a page-side recovery attempt (what a client watchdog could do): suspend + resume, then a second new context
    await page.evaluate(async () => { await window.__bareCtx.suspend(); await window.__bareCtx.resume(); });
    report.info.kickResume = await sampleFor(page, 5, 'kickResume');
    await page.evaluate(async () => { await window.__bareCtx.close(); const c = new AudioContext(); await c.resume(); window.__bareCtx = c; });
    report.info.kickNewContext = await sampleFor(page, 5, 'kickNewContext');
  }
  await browser.close();
  // the same bare page on Chrome's fake audio sink (--disable-audio-output: a timer-driven output stream, no device)
  {
    const release = await holdHeavy('fw_r4_aud_ctxclock fake');
    const fb = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-audio-output', '--autoplay-policy=no-user-gesture-required'] });
    try {
      const page = await (await fb.newContext()).newPage();
      await page.goto('about:blank');
      await page.evaluate(async () => { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.connect(ctx.destination); o.start(); await ctx.resume(); window.__bareCtx = ctx; });
      report.info.bareFakeSink = await sampleFor(page, 6, 'bareFakeSink');
    } finally { await fb.close(); release(); }
  }
  // client
  const r = await open('/?dev=1&render=0&autopilot=1&autoflow=1', { hmr: false, wait: false });
  browser = r.browser;
  const page = r.page;
  await page.addInitScript(SPY);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 }).catch(() => {});
  report.steps.menu = await sampleFor(page, 8, 'menu');
  await vale(page, (v, q) => { (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); return true; }, QUEUE);
  log('queued', QUEUE);
  await waitFor(page, (v) => !!v.state.match.value, 300000);
  report.steps.matchStart = await sampleFor(page, 6, 'matchStart');
  await waitFor(page, (v) => (v.state.match.value?.view.time ?? -1) >= 30, 300000);
  report.steps.match = await sampleFor(page, MATCH_S, 'match');
  report.logs = r.logs.slice(0, 30);
} catch (e) {
  report.error = String(e?.message ?? e);
} finally {
  report.pass = !report.error && Object.values(report.steps).every((s) => s.verdict === 'advancing');
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  await browser?.close().catch(() => {});
}
console.log(report.pass ? 'PASS: the context clock advances bare, at the menu and in the match' : `FAIL ${report.error ?? ''} ${Object.entries(report.steps).map(([k, s]) => `${k}=${s.verdict}`).join(' ')}`);
console.log(`report → ${OUT}`);
process.exit(report.pass ? 0 : 1);
