// VALE harness — the match music's acts and objective layer, live (closing AUD-C4). The real engine and a real RIFT match in
// real Chrome on the fake output device; the other buses are muted and the output is metered per 4096-sample block.
//
//   node _harness/probe_audio_music.mjs [--queue rift_coop] [--m4a] [--out _harness/_reports/fw_CW2_music.json]
//
//   A1  acts rise with the match: act 0 until the clock's first share (20 % of the mode's clock, RIFT 8:00), raised by
//       the clock; act 2 raised by structures down (40 %, needles killed by the probe), never falling back
//   A2  sections follow the act: every section end logged while the act held plays that act's next section, and each
//       act's jump happens live (act 0 S2>S5, act 1 S3>S5, act 2 S5>S2)
//   A3  every mode has a clock the acts can read
//   O1  the objective layer is off away from a pit (far from all: its own tap at least 30 dB under its level at a pit)
//   O2  it fades in by proximity (gain >= 0.9 within 6 s at a pit) and out (<= 0.05 within 8 s away); a road beside a pit
//       only lifts it a little (gain <= 0.3); within the pit window the bed's sum stands 0.5-4.5 dB over the bed without the layer
//   O3  it fades out when the objective falls, the ear still at the pit
//   C1  no clicks at transitions: the sample step and the > 7 kHz peak at each jump (fade start to downbeat + 100 ms), against
//       the same windows at the natural section ends and the rest of the recording
//   L1  level: RMS 8 s each side of a jump within 6 dB; the output's sample peak stays under -0.9 dBFS
//   M1  memory: a jump adds no decoded file; the bed's decoded files are the main stem, the combat layer, the objective
//       layer; the objective layer <= 16 MB and the bed <= 135 MB. A streamed bed (round 5 AUD-4, src/audio/index.ts
//       `stream`): the objective layer is the one whole file, the main stem and combat layer are its two streamed stems,
//       and at most 3 section windows were ever held at once; the bed (whole files + windows held) <= 135 MB
// Exit 0 = gates hold, 1 = a gate fails, 2 = the run failed. Report → _harness/_reports/fw_CW2_music.json. Needs the dev server.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const M4A = args.includes('--m4a');
const OUT = opt('--out', join(HERE, '_reports', M4A ? 'fw_CW2_music_m4a.json' : 'fw_CW2_music.json'));
const QUEUE = opt('--queue', 'rift_coop');
const XF_S = 0.25;      // SECTION_XF_S in src/audio/index.ts
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
const r2 = (x) => (x === null || x === undefined || !Number.isFinite(x) ? x : Math.round(x * 100) / 100);
const dbP = (p) => 10 * Math.log10(p + 1e-20);
const db = (a) => 20 * Math.log10(a + 1e-10);
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.round((p / 100) * (s.length - 1)))]; };

const release = await holdHeavy('probe_audio_music');
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
browser.on('disconnected', release);
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await context.routeWebSocket(/.*/, () => {});
const page = await context.newPage();
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const rep = { probe: 'probe_audio_music', queue: QUEUE, format: M4A ? 'm4a' : 'default', at: new Date().toISOString(), err: null, gates: {}, pass: false };
const acts = () => page.evaluate(() => window.__valeAudio.musicActs);
const clock = () => page.evaluate(() => { const m = window.__vale.state.match.value; return { t: m?.view.time ?? null, ctx: window.__valeAudio.graph.ctx.currentTime }; });

/** wait (bounded) until the section log has an entry the predicate takes */
async function waitSection(pred, seconds, what) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const a = await acts();
    const hit = a.sections.find(pred);
    if (hit) { log(`${what}: section ${hit.from + 1} > ${hit.to + 1} at ctx ${hit.at.toFixed(1)}, act ${hit.act}`); return hit; }
    if (Date.now() > until) throw new Error(`no ${what} within ${seconds} s (act ${a.act}, sections ${JSON.stringify(a.sections.slice(-6))})`);
    await page.waitForTimeout(500);
  }
}
const waitCtx = async (at) => { for (let i = 0; i < 2000; i++) { if ((await clock()).ctx >= at) return; await page.waitForTimeout(100); } throw new Error(`ctx never reached ${at}`); };
const ear = (x, y) => page.evaluate(([px, py]) => { window.__ear = { x: px, y: py }; }, [x, y]);
const gainAfter = async (pred, seconds) => {
  const until = Date.now() + seconds * 1000, a0 = Date.now();
  for (;;) {
    const a = await acts();
    if (pred(a.objGain ?? 0)) return { ok: true, gain: r2(a.objGain), seconds: r2((Date.now() - a0) / 1000) };
    if (Date.now() > until) return { ok: false, gain: r2(a.objGain), seconds };
    await page.waitForTimeout(100);
  }
};

try {
  await page.goto(`${BASE}/?dev=1&render=0&autoflow=1${M4A ? '&audio=m4a' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
  await page.evaluate((q) => { const v = window.__vale; (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); }, QUEUE);
  await page.waitForFunction(() => !!window.__vale.state.match.value, null, { timeout: 600000, polling: 500 });
  await page.waitForFunction(() => { const a = window.__valeAudio; return (window.__vale.state.match.value?.view.time ?? -9) > 1 && a.bed && a.bed.layers.every((l) => !!l.src); }, null, { timeout: 180000, polling: 500 });
  rep.setup = await page.evaluate(() => {
    const a = window.__valeAudio, g = a.graph, ctx = g.ctx, b = a.bed;
    for (const k of ['sfx', 'ui', 'voice', 'ambience']) { const p = g.bus[k].gain; p.cancelScheduledValues(0); p.value = 0; }
    a.threat.gain.cancelScheduledValues(0); a.threat.gain.value = 0;
    window.__ear = { x: 2, y: 2 };
    a.listener(() => window.__ear);
    const hps = [0, 1, 2].map(() => { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; return f; });
    hps[0].connect(hps[1]); hps[1].connect(hps[2]);
    const merger = ctx.createChannelMerger(4);
    const mono = (n) => { const sp = ctx.createGain(); sp.channelCount = 1; sp.channelCountMode = 'explicit'; n.connect(sp); return sp; };
    mono(g.out).connect(merger, 0, 0);
    g.out.connect(hps[0]); mono(hps[2]).connect(merger, 0, 1);
    const obj = b.layers.find((l) => l.role === 'objective');
    if (obj) mono(obj.gain).connect(merger, 0, 2);
    mono(b.gain).connect(merger, 0, 3);
    const proc = ctx.createScriptProcessor(4096, 4, 1);
    const st = window.__music = { rows: [] };
    let last = 0;
    proc.onaudioprocess = (ev) => {
      const ib = ev.inputBuffer, x = ib.getChannelData(0), h = ib.getChannelData(1), o = ib.getChannelData(2), bd = ib.getChannelData(3);
      let ss = 0, step = 0, peak = 0, hf = 0, os = 0, bs = 0;
      for (let i = 0; i < x.length; i++) {
        const v = x[i], d = Math.abs(v - last); last = v;
        ss += v * v; os += o[i] * o[i]; bs += bd[i] * bd[i];
        if (d > step) step = d;
        if (Math.abs(v) > peak) peak = Math.abs(v);
        if (Math.abs(h[i]) > hf) hf = Math.abs(h[i]);
      }
      st.rows.push([ev.playbackTime, ss / x.length, step, peak, hf, os / x.length, a.combat ? 1 : 0, bs / x.length, b.gain.gain.value]);
    };
    const z = ctx.createGain(); z.gain.value = 0; merger.connect(proc); proc.connect(z); z.connect(ctx.destination);
    const m = window.__vale.state.match.value;
    return { bed: b.id, mode: m.view.mode, fmt: a.fmt, rate: ctx.sampleRate, layers: b.layers.map((l) => [l.id, l.role]), objectives: m.view.objectives.map((o) => ({ id: o.id, at: o.at, alive: o.alive })),
      modeClock: [...a.modeClock.entries()], bufferFiles: [...a.buffers.keys()].filter((k) => /mus_/.test(k)).length };
  });
  log('bed', rep.setup.bed, 'format', rep.setup.fmt, 'layers', JSON.stringify(rep.setup.layers));
  const clockS = new Map(rep.setup.modeClock).get(rep.setup.mode);
  rep.clockS = clockS;

  // ── act 0: the jump S2 > S5 live ──
  const j0 = await waitSection((s) => s.jump && s.act === 0, 420, 'act 0 jump');      // the .m4a path plays as composed until its take-over (112 s on)
  rep.jumpAct0 = j0;
  await waitCtx(j0.at + 1);

  // ── the clock raises the act ──
  rep.actRiseClock = await (async () => {
    const before = await acts();
    await page.evaluate(() => window.__vale.state.match.value.setTimeScale?.(16));
    const until = Date.now() + 240000;
    let seen = null;
    for (;;) {
      const [a, c] = [await acts(), await clock()];
      if (a.act >= 1) { seen = { act: a.act, atMatchS: r2(c.t), structuresMax: a.structuresMax }; break; }
      if (Date.now() > until) throw new Error(`act never rose (match ${c.t} s)`);
      await page.waitForTimeout(100);
    }
    await page.evaluate(() => window.__vale.state.match.value.setTimeScale?.(1));
    return { before: before.act, ...seen };
  })();
  log('act rise by clock', JSON.stringify(rep.actRiseClock));

  // ── the objective layer by proximity (Sunsplinter is up by the time the first act has passed) ──
  const objs0 = await page.evaluate(() => window.__vale.state.match.value.view.objectives.filter((o) => o.alive).map((o) => ({ id: o.id, unit: o.unit, at: o.at })));
  rep.objectivesAlive = objs0;
  if (!objs0.length) throw new Error('no living objective at the clock rise');
  const pit = objs0[0];
  await ear(2, 2);
  await page.waitForTimeout(6000);
  const w = { far0: [(await clock()).ctx - 3, (await clock()).ctx] };
  await ear(pit.at[0], pit.at[1]);
  rep.fadeIn = await gainAfter((g) => g >= 0.9, 6);
  await page.waitForTimeout(1500);
  const c1 = (await clock()).ctx; await page.waitForTimeout(4000); w.pit = [c1, (await clock()).ctx];
  await ear(pit.at[0], pit.at[1] > 55 ? 98.5 : 11.5);      // the road beside the pit
  await page.waitForTimeout(5000);
  rep.roadGain = r2((await acts()).objGain);
  await ear(2, 2);
  rep.fadeOut = await gainAfter((g) => g <= 0.05, 8);
  await page.waitForTimeout(2500);
  const c2 = (await clock()).ctx; await page.waitForTimeout(3000); w.far1 = [c2, (await clock()).ctx];
  // the objective falls with the ear at its pit
  await ear(pit.at[0], pit.at[1]);
  rep.fadeIn2 = await gainAfter((g) => g >= 0.9, 6);
  rep.kill = await page.evaluate(async (unit) => {
    const m = window.__vale.state.match.value, W = m.sim.world;
    const v = m.view.entities.find((u) => u.def === unit && u.alive);
    const e = v ? W.entity(v.id) : null;
    if (!e) return { found: false };
    const { killEntity } = await import('/src/sim/combat.ts');
    killEntity(W, e, null);
    return { found: true };
  }, pit.unit);
  rep.fadeOnFall = await gainAfter((g) => g <= 0.05, 8);
  await ear(2, 2);

  // ── act 1: the jump S3 > S5 live ──
  rep.jumpAct1 = await waitSection((s) => s.jump && s.act === 1, 240, 'act 1 jump');
  await waitCtx(rep.jumpAct1.at + 1);

  // ── structures raise the act (needles only: the match goes on) ──
  rep.actRiseStructures = await page.evaluate(async () => {
    const a = window.__valeAudio, m = window.__vale.state.match.value, W = m.sim.world;
    const { killEntity } = await import('/src/sim/combat.ts');
    const before = a.musicActs.act, timeAt = m.view.time;
    const all = m.view.entities.filter((u) => u.kind === 'structure' && u.alive && /needle/.test(u.def ?? '') && !/bell/.test(u.def ?? ''));
    let n = 0;
    for (const v of all) { const e = W.entity(v.id); if (e?.alive && n < 12) { killEntity(W, e, null); n++; } }
    return { before, killed: n, standingSeen: a.musicActs.structuresMax, timeAt };
  });
  await page.waitForTimeout(1500);
  const a2 = await acts();
  rep.actRiseStructures.after = a2.act;
  log('act rise by structures', JSON.stringify(rep.actRiseStructures));

  // ── act 2: the jump S5 > S2 live, then one section further ──
  rep.jumpAct2 = await waitSection((s) => s.jump && s.act === 2, 300, 'act 2 jump');
  await waitCtx(rep.jumpAct2.at + 9);

  // ── what was recorded ──
  const a3 = await acts();
  rep.sections = a3.sections;
  rep.finalAct = a3.act;
  const raw = await page.evaluate(() => window.__music.rows);
  rep.blocks = raw.length;
  const inW = ([c0, c1]) => raw.filter((r) => r[0] >= c0 && r[0] < c1);
  const pow = (rows, k) => rows.reduce((s, r) => s + r[k], 0) / Math.max(1, rows.length);
  const steps = raw.map((r) => r[2]), hfs = raw.map((r) => r[4]);
  const judge = (s) => {
    const rows = inW([s.at - XF_S - 0.1, s.at + 0.1]);
    const before = pow(inW([s.at - 8, s.at - XF_S]), 1), after = pow(inW([s.at + 0.1, s.at + 8]), 1);
    return { at: r2(s.at), jump: `S${s.from + 1}>S${s.to + 1}`, isJump: s.jump, act: s.act, blocks: rows.length, step: Math.max(0, ...rows.map((r) => r[2])), hf: Math.max(0, ...rows.map((r) => r[4])),
      levelStepDb: after && before ? r2(Math.abs(dbP(after) - dbP(before))) : null };
  };
  const rec0 = raw[0]?.[0] ?? 0;
  const judged = a3.sections.filter((s) => s.at > rec0 + 8 && s.at < raw[raw.length - 1][0] - 1).map(judge);
  const jumps = judged.filter((j) => j.isJump), naturals = judged.filter((j) => !j.isJump);
  const refStep = Math.max(pct(steps, 99), ...naturals.map((n) => n.step)), refHf = Math.max(pct(hfs, 99), ...naturals.map((n) => n.hf));
  rep.windows = judged.map((j) => ({ ...j, step: +j.step.toFixed(5), hf: +j.hf.toFixed(5) }));
  rep.clicks = { refStep: +refStep.toFixed(5), refHf: +refHf.toFixed(5), stepP50: +pct(steps, 50).toFixed(5), stepP99: +pct(steps, 99).toFixed(5), hfP99: +pct(hfs, 99).toFixed(5), overStepDb: jumps.map((j) => r2(db(j.step) - db(refStep))), overHfDb: jumps.map((j) => r2(db(j.hf) - db(refHf))) };
  rep.peakDb = r2(db(Math.max(...raw.map((r) => r[3]))));
  const lvl = (win) => ({ outDb: r2(dbP(pow(inW(win), 1))), objDb: r2(dbP(pow(inW(win), 5))), blocks: inW(win).length });
  rep.objective = { far0: lvl(w.far0), pit: lvl(w.pit), far1: lvl(w.far1) };
  const obj = rep.objective;
  // the lift within the pit window itself: the bed's sum with the layer over the bed's sum without it (the bed moves by
  // more than the layer between windows: a section, the combat layer)
  const pr = inW(w.pit), bedP = pow(pr, 7), objP = pr.reduce((s, r) => s + r[5] * r[8] * r[8], 0) / Math.max(1, pr.length);
  obj.bedOverObjDb = r2(dbP(bedP) - dbP(objP));
  obj.liftDb = r2(dbP(bedP) - dbP(Math.max(1e-12, bedP - objP)));

  // the section order: each logged end played its act's next section (MUSIC_ACTS as the build reads it)
  const ACTS = [[0, 1, 4], [0, 1, 2, 4], [1, 2, 3, 4]];
  const want = (act, from) => { const seq = ACTS[act], i = seq.indexOf(from); return i >= 0 ? seq[(i + 1) % seq.length] : (seq.find((x) => x > from) ?? seq[0]); };
  rep.orderBad = a3.sections.filter((s) => s.to !== want(s.act, s.from));
  const gap = (l) => l.every((s, i) => i === 0 || Math.abs((s.at - l[i - 1].at) - 32) < 0.05);
  rep.sectionsEvery32s = gap(a3.sections);

  // memory
  rep.memory = await page.evaluate(async () => {
    const a = window.__valeAudio, rows = [];
    for (const [k, p] of a.buffers.entries()) {
      if (!/mus_/.test(k)) continue;
      const b = await Promise.race([p, new Promise((r) => setTimeout(r, 200, null))]);
      if (b?.length) rows.push([k.split('/').pop(), +(b.length * b.numberOfChannels * 4 / 1048576).toFixed(1), +b.duration.toFixed(2)]);
    }
    const dec = await a.decoded();
    return { files: rows, decodedMb: +(dec.bytes / 1048576).toFixed(1), stream: a.musicStream };
  });
  // round 5 AUD-4: a streamed bed holds its main stem and combat layer as section windows (src/audio/index.ts `stream`)
  const strm = rep.memory.stream;
  const mb = rep.memory.files.reduce((s, r) => s + r[1], 0) + (strm?.heldMb ?? 0);
  const objFile = rep.memory.files.find((r) => /objective/.test(r[0]));

  const riseT = rep.actRiseClock.atMatchS;
  rep.gates = {
    A1_clockRaisesAct: rep.actRiseClock.before === 0 && rep.actRiseClock.act === 1 && riseT >= 0.2 * clockS - 2 && riseT <= 0.2 * clockS + 30,
    A1_structuresRaiseAct: rep.actRiseStructures.before === 1 && rep.actRiseStructures.after === 2 && rep.actRiseStructures.timeAt < 0.4 * clockS,
    A1_neverFalls: a3.act === 2 && a3.sections.every((s, i) => i === 0 || s.act >= a3.sections[i - 1].act),
    A2_orderFollowsAct: rep.orderBad.length === 0 && rep.sectionsEvery32s,
    A2_jumps: j0.from === 1 && j0.to === 4 && rep.jumpAct1.from === 2 && rep.jumpAct1.to === 4 && rep.jumpAct2.from === 4 && rep.jumpAct2.to === 1,
    A3_clocks: rep.setup.modeClock.length >= 3 && rep.setup.modeClock.every(([, c]) => c > 0),
    O1_offAway: obj.pit.objDb - Math.max(obj.far0.objDb, obj.far1.objDb) >= 30,
    O2_fadeIn: rep.fadeIn.ok && rep.fadeIn2.ok,
    O2_fadeOut: rep.fadeOut.ok,
    O2_roadOnlyALittle: rep.roadGain <= 0.3,
    O2_aWeightNotALevelChange: rep.objective.liftDb >= 0.5 && rep.objective.liftDb <= 4.5,
    O3_fadesOnFall: !!rep.kill?.found && rep.fadeOnFall.ok,
    C1_noClicks: jumps.length >= 3 && naturals.length >= 2 && jumps.every((j) => j.blocks >= 3 && j.step <= refStep * 1.5 && j.hf <= refHf * 1.5),
    L1_level: jumps.every((j) => j.levelStepDb !== null && j.levelStepDb <= 6),
    L1_peak: rep.peakDb <= -0.9,
    M1_files: rep.memory.files.length === rep.setup.bufferFiles && !!objFile && (strm
      ? rep.memory.files.length === 1 && strm.stems.length === 2 && strm.stats.maxHeld <= 3 && strm.windows.length <= 3
      : rep.memory.files.length === 3),
    M1_budget: !!objFile && objFile[1] <= 16 && mb <= 135,
  };
  rep.pass = Object.values(rep.gates).every(Boolean);
} catch (e) { rep.err = String(e?.stack ?? e); }
rep.logs = logs.slice(0, 30);
await browser.close().catch(() => {});
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(rep, null, 1) + '\n');
log(rep.err ? `ERR ${rep.err}` : `gates ${JSON.stringify(rep.gates)}`);
if (rep.objective) log('objective', JSON.stringify(rep.objective), 'road gain', rep.roadGain);
if (rep.clicks) log('clicks', JSON.stringify(rep.clicks), 'peak', rep.peakDb);
log(rep.err ? 'RUN FAILED' : rep.pass ? 'PASS' : 'FAIL', '→', OUT);
process.exit(rep.err ? 2 : rep.pass ? 0 : 1);
