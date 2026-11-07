// VALE harness — round 6 AUD-7: does detaching a let-go AudioBuffer's channel data free its memory at once (no GC)?
// Real Chrome, fake output device. Four buffers decoded from the shipped draft bed play, are stopped and dropped by
// the engine's rules (stop, disconnect, buffer = null); then, per arm, their channel data's ArrayBuffers are
// detached (ArrayBuffer.prototype.transfer(0)) or not. V8's array-buffer backing (Runtime.getHeapUsage
// backingStorageSize) and the renderer's macOS footprint (footprint -p) are read before any GC, then after a forced GC.
//
//   node _harness/fw_r6_aud_detach.mjs [--out _harness/_reports/fw_r6_aud_detach.json]
// Exit 0 = the detach arm frees >= 90 % of the decoded bytes before a GC, 1 = it does not, 2 = the run failed.

import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(HERE, '_reports', 'fw_r6_aud_detach.json');
const FILES = ['mus_draft', 'mus_draft_picks', 'mus_draft_final', 'mus_draft_urgency'].map((f) => join(HERE, '..', 'audio', 'out', 'music', `${f}.ogg`));
const MB = (b) => +(b / 1048576).toFixed(1);
const rep = { probe: 'fw_r6_aud_detach', at: new Date().toISOString(), arms: {}, pass: false, err: null };

async function arm(detach, play = true) {
  const dir = mkdtempSync(join(tmpdir(), 'fw_r6_aud_detach_'));
  const ctxB = await chromium.launchPersistentContext(dir, { channel: 'chrome', headless: true,
    args: ['--disable-audio-output', '--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = ctxB.pages()[0] ?? await ctxB.newPage();
    await page.goto('about:blank');
    const cdp = await ctxB.newCDPSession(page);
    const heap = async () => { const h = await cdp.send('Runtime.getHeapUsage'); return MB(h.backingStorageSize); };

    // the renderer's macOS footprint (what probe_match_memory reads), by its pid from ps (the profile dir is ours alone)
    const rss = () => {
      try {
        const out = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
        const pids = out.split('\n').filter((l) => l.includes(dir) && l.includes('--type=renderer')).map((l) => parseInt(l.trim(), 10));
        let best = null;
        for (const pid of pids) {
          const m = /Footprint:\s+([\d.]+)\s+(MB|GB|KB)/.exec(execFileSync('footprint', ['-p', String(pid)], { encoding: 'utf8', timeout: 30000 }));
          const mb = m ? Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1) : null;
          if (mb !== null && (best === null || mb > best)) best = +mb.toFixed(1);
        }
        return best;
      } catch { return null; }
    };

    const bytes = FILES.map((f) => [...readFileSync(f)]);
    await page.evaluate(async (all) => {
      const ctx = new AudioContext({ sampleRate: 48000 });
      await ctx.resume().catch(() => {});
      window.__bufs = [];
      for (const b of all) window.__bufs.push(await ctx.decodeAudioData(new Uint8Array(b).buffer));
      window.__ctx = ctx;
    }, bytes);
    const r = { decodedMb: MB(await page.evaluate(() => window.__bufs.reduce((s, b) => s + b.length * b.numberOfChannels * 4, 0))) };
    await page.evaluate((p) => { window.__play = p; }, play);
    await page.evaluate(async () => {
      const ctx = window.__ctx;
      window.__srcs = !window.__play ? [] : window.__bufs.map((b) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.connect(ctx.destination); s.start(); return s; });
      await new Promise((r) => setTimeout(r, 1500));
    });
    r.playing = { backingMb: await heap(), footprintMb: rss() };
    r.detachOk = await page.evaluate((detach) => {
      let ok = 0;
      for (const s of window.__srcs) { s.onended = null; try { s.stop(); } catch { /* */ } try { s.disconnect(); } catch { /* */ } try { s.buffer = null; } catch { /* */ } }
      window.__srcs = null;
      if (detach) for (const b of window.__bufs) for (let c = 0; c < b.numberOfChannels; c++) {
        const ab = b.getChannelData(c).buffer;
        try { if (typeof ab.transfer === 'function') { ab.transfer(0); ok++; } } catch { /* */ }
      }
      window.__keep = window.__bufs;            // the AudioBuffer objects stay reachable: what an uncollected one does
      window.__bufs = null;
      return ok;
    }, detach);
    await page.waitForTimeout(1500);
    r.droppedNoGc = { backingMb: await heap(), footprintMb: rss(), channel0Len: await page.evaluate(() => window.__keep[0].getChannelData(0).length) };
    // the sources still play? a fresh buffer still sounds after a detach (the context is not broken)
    r.freshPlays = await page.evaluate(async () => {
      const ctx = window.__ctx; const b = ctx.createBuffer(2, 48000, 48000); b.getChannelData(0).fill(0.1);
      const s = ctx.createBufferSource(); s.buffer = b; const an = ctx.createAnalyser(); s.connect(an); an.connect(ctx.destination); s.start();
      await new Promise((r) => setTimeout(r, 300)); const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
      return Math.max(...d.map(Math.abs)) > 0.05;
    });
    await page.evaluate(() => { window.__keep = null; });
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(1500);
    r.afterGc = { backingMb: await heap(), footprintMb: rss() };
    r.freedNoGcMb = r.playing.footprintMb !== null && r.droppedNoGc.footprintMb !== null ? +(r.playing.footprintMb - r.droppedNoGc.footprintMb).toFixed(1) : null;
    r.freedByGcMb = r.droppedNoGc.footprintMb !== null && r.afterGc.footprintMb !== null ? +(r.droppedNoGc.footprintMb - r.afterGc.footprintMb).toFixed(1) : null;
    return r;
  } finally {
    await ctxB.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  rep.arms.keep = await arm(false);
  rep.arms.detach = await arm(true);
  rep.arms.detachUnplayed = await arm(true, false);
  const d = rep.arms.detach;
  rep.pass = d.freedNoGcMb >= 0.9 * d.decodedMb && d.freshPlays && d.droppedNoGc.channel0Len === 0;
} catch (e) { rep.err = String(e?.stack ?? e); }
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
console.log(JSON.stringify(rep, null, 1));
process.exit(rep.err ? 2 : rep.pass ? 0 : 1);
