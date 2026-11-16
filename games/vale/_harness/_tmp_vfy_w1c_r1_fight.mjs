// VALE verifier harness (orch1 W1-C round 1, independent verifier): a BRIDGE 5v5 teamfight capture for the
// critical-listening pass. A real match at speed 1 (default settings, the autopilot on your seat, render off,
// Chrome's fake output device), the same K-weighted taps as probe_audio_runtime, plus per 4096-sample block:
// the sfx paths BEFORE the leveller (bus, threat, priority), AFTER it (its three taps), the trim node (the limiter's
// input), the leveller's stage-1 / stage-2 / stage-3 gains, the limiter's reduction and the ducks; and the final
// output's raw samples around the first teamfights (>= FOES enemy and >= ALLIES allied fighters within FIGHT_M of
// you), written as 16-bit WAV for the spectral / envelope pass.
//   node _harness/_tmp_vfy_w1c_r1_fight.mjs [--queue bridge_standard] [--seed 7] [--seconds 420] [--out <dir>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const QUEUE = opt('--queue', 'bridge_standard');
const SEED = opt('--seed', '7');
const SECONDS = Number(opt('--seconds', 420));
const OUT = opt('--out', join(HERE, '_reports', 'vfy_w1c_r1', `fight_${QUEUE}_${SEED}`));
const FIGHT_M = 14, FOES = 3, ALLIES = 2, PRE_S = 12, POST_S = 30, MAX_CAPS = 3, RING_S = 60;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const TAP = (ringS) => {
  const a = window.__valeAudio, g = a.graph, ctx = g.ctx, lv = a.leveller;
  // 0 out, 1 trim (limiter in), 2 music, 3 ambience, 4 voice, 5 ui, 6 bus pre, 7 threat pre, 8 prio pre,
  // 9 bg post, 10 threat post, 11 prio post
  const stems = [g.out, g.trim, g.bus.music, g.bus.ambience, g.bus.voice, g.bus.ui, g.bus.sfx, a.threat, a.prio, lv.taps[0], lv.taps[1], lv.taps[2]];
  const N = stems.length * 2;
  const merger = ctx.createChannelMerger(N);
  stems.forEach((node, i) => {
    const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681.974; hs.gain.value = 3.9998;
    hs.channelCount = 2; hs.channelCountMode = 'explicit'; hs.channelInterpretation = 'speakers';
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.135; hp.Q.value = -6.015;
    const sp = ctx.createChannelSplitter(2);
    node.connect(hs); hs.connect(hp); hp.connect(sp); sp.connect(merger, 0, 2 * i); sp.connect(merger, 1, 2 * i + 1);
  });
  const proc = ctx.createScriptProcessor(4096, N, 1);
  // raw (unweighted) final output for the WAV ring
  const raw = ctx.createScriptProcessor(4096, 2, 1);
  const rs = ctx.createChannelSplitter(2), rm = ctx.createChannelMerger(2);
  g.out.connect(rs); rs.connect(rm, 0, 0); rs.connect(rm, 1, 1); rm.connect(raw);
  const ringN = Math.ceil(ringS * ctx.sampleRate / 4096);
  const st = { blocks: [], ring: [], ringN, caps: [], plays: [] };
  window.__cap = st;
  // every cue call with its routing flags, at context time (the cue log is only read once a poll)
  const orig = Object.getPrototypeOf(a).cue;
  a.cue = function (id, pos, gm, hold, o) {
    const r = orig.call(this, id, pos, gm, hold, o);
    if (id) st.plays.push([ctx.currentTime, id, o?.you ? 1 : 0, o?.onYou ? 1 : 0, o?.aware ? 1 : 0, typeof r === 'string' ? r : 'ok']);
    return r;
  };
  proc.onaudioprocess = (ev) => {
    const ib = ev.inputBuffer, n = ib.length, row = [ctx.currentTime];
    for (let s = 0; s < stems.length; s++) {
      let ss = 0;
      for (let c = 0; c < 2; c++) { const d = ib.getChannelData(2 * s + c); for (let i = 0; i < n; i++) ss += d[i] * d[i]; }
      row.push(ss / n);
    }
    const L = a.leveller;
    row.push(L.gainDb, L.prioDb, L.stats.longCutDb ?? 0, g.limiter.reduction,
      a.sfxHeat ? 20 * Math.log10(Math.max(1e-6, a.sfxHeat.gain.value)) : 0);
    st.blocks.push(row);
  };
  raw.onaudioprocess = (ev) => {
    const ib = ev.inputBuffer, n = ib.length, l = ib.getChannelData(0), r = ib.getChannelData(1);
    const q = new Int16Array(2 * n);
    for (let i = 0; i < n; i++) { q[2 * i] = Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))); q[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(r[i] * 32767))); }
    st.ring.push([ctx.currentTime, q]);
    if (st.ring.length > st.ringN) st.ring.shift();
  };
  const z = ctx.createGain(); z.gain.value = 0;
  merger.connect(proc); proc.connect(z); raw.connect(z); z.connect(ctx.destination);
  return true;
};

const release = await holdHeavy('vfy_w1c_r1_fight');
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
browser.on('disconnected', release);
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.routeWebSocket(/.*/, () => {});
const page = await context.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
mkdirSync(OUT, { recursive: true });
const rep = { harness: '_tmp_vfy_w1c_r1_fight', queue: QUEUE, seed: SEED, seconds: SECONDS, cols: ['ct', 'out', 'trim', 'music', 'ambience', 'voice', 'ui', 'busPre', 'threatPre', 'prioPre', 'bgPost', 'threatPost', 'prioPost', 'levDb', 'prioDb', 'longCutDb', 'limiterRedDb', 'fightDuckDb'], polls: [], cues: [], caps: [], err: null };
try {
  await page.goto(`${BASE}/?dev=1&render=0&autopilot=1&autoflow=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
  rep.rate = await page.evaluate(() => window.__valeAudio.graph.ctx.sampleRate);
  await page.evaluate((q) => { const v = window.__vale; (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); }, QUEUE);
  await page.waitForFunction(() => !!window.__vale.state.match.value, null, { timeout: 600000, polling: 500 });
  await page.evaluate(TAP, RING_S);
  rep.you = await page.evaluate(() => { const m = window.__vale.state.match.value; const p = m?.view.players.find((x) => x.player === m.you); return p ? { fighter: p.fighter ?? null, team: p.team } : null; });
  rep.trimDb = await page.evaluate(() => window.__valeAudio.leveller.trimDb);
  log('match', JSON.stringify(rep.you), 'trim', rep.trimDb);
  let lastCap = -1e9, pending = null;
  for (;;) {
    const s = await page.evaluate((FIGHT_M) => {
      const a = window.__valeAudio, m = window.__vale.state.match.value, W = m?.sim?.world;
      const me = m?.view.players.find((p) => p.player === m.you), mine = me && W?.entity(me.entity);
      let foes = 0, allies = 0;
      if (mine) for (const p of m.view.players) { const e = W.entity(p.entity); if (!e || !e.alive || e.id === mine.id) continue; if (Math.hypot(e.x - mine.x, e.y - mine.y) <= FIGHT_M) { if (e.team === mine.team) allies++; else foes++; } }
      return { ct: a.graph.ctx.currentTime, t: m?.view?.time ?? null, alive: !!mine?.alive, foes, allies, cues: a.log.splice(0) };
    }, FIGHT_M);
    rep.polls.push([s.ct, s.t, s.alive ? 1 : 0, s.foes, s.allies]);
    for (const c of s.cues) rep.cues.push([Math.round(s.ct * 100) / 100, s.t === null ? null : Math.round(s.t * 100) / 100, c]);
    if (!pending && rep.caps.length < MAX_CAPS && s.alive && s.foes >= FOES && s.allies >= ALLIES && s.ct - lastCap > PRE_S + POST_S + 20) {
      pending = { trigCt: s.ct, trigT: s.t, foes: s.foes, allies: s.allies }; lastCap = s.ct; log('fight', JSON.stringify(pending));
    }
    if (pending && s.ct >= pending.trigCt + POST_S) {
      const b64 = await page.evaluate(({ a0, a1 }) => {
        const st = window.__cap, parts = st.ring.filter(([t]) => t >= a0 && t <= a1);
        const n = parts.reduce((x, [, q]) => x + q.length, 0), all = new Int16Array(n);
        let o = 0; for (const [, q] of parts) { all.set(q, o); o += q.length; }
        const u8 = new Uint8Array(all.buffer); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
        return { b64: btoa(s), t0: parts[0]?.[0] ?? null, n };
      }, { a0: pending.trigCt - PRE_S, a1: pending.trigCt + POST_S });
      const pcm = Buffer.from(b64.b64, 'base64'), sr = rep.rate;
      const hdr = Buffer.alloc(44);
      hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16);
      hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34);
      hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
      const f = join(OUT, `fight${rep.caps.length}.wav`);
      writeFileSync(f, Buffer.concat([hdr, pcm]));
      rep.caps.push({ ...pending, wav: f, wavCt0: b64.t0, seconds: b64.n / 2 / sr });
      log('captured', f, (b64.n / 2 / sr).toFixed(1), 's');
      pending = null;
    }
    if (s.t === null && rep.cues.length > 5) break;
    if ((s.t ?? 0) >= SECONDS) break;
    if ((Date.now() - t0) / 1000 > SECONDS * 1.6 + 600) { rep.err = 'wall-clock budget'; break; }
    await page.waitForTimeout(1000);
  }
  rep.blocks = await page.evaluate(() => window.__cap.blocks);
  rep.plays = await page.evaluate(() => window.__cap.plays);
  rep.stats = await page.evaluate(() => ({ ...window.__valeAudio.leveller.stats }));
} catch (e) { rep.err = String(e?.message ?? e); }
rep.pageErrors = errs.slice(0, 20);
await browser.close().catch(() => {});
writeFileSync(join(OUT, 'trace.json'), JSON.stringify(rep));
log(rep.err ? `ERROR ${rep.err}` : 'DONE', 'caps', rep.caps.length, 'blocks', rep.blocks?.length ?? 0, '→', OUT);
process.exit(rep.err ? 2 : 0);
