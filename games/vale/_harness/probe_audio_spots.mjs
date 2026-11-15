// VALE harness — the ambience bus as heard on named spots of each map (ruling 37 spot probe; promoted by orch1 W1-C from
// the verify_ambience verifier's own probe, modeled on probe_audio_runtime.mjs pits).
//
//   node _harness/probe_audio_spots.mjs [--queue rift_coop|bridge_standard|fray_standard] [--seed 3] [--window 14] [--raw] [--out <json>]
//
// A real match (render off, autopilot), every objective camp spawned early, then the engine's listener placed on each
// spot (RIFT: three lanes, two canopy points, two shallows points, 10 m east and north of each pit; BRIDGE: deck middle,
// quarter, two updraft edges; FRAY: centre, edge, a lantern, a bunting) and on the map's busiest emitter point, for
// --window s (26 s at the busy spots). Music, ambience and sfx buses and every emitter's gain node are metered K-weighted
// per 4096-sample block; blocks under a fight or voice duck are dropped when at least a third stay. Gate (rulings 34 /
// 37): at every spot the whole ambience bus sits >= AMB_UNDER_MUSIC_LU (8) under the music bus. --raw also writes the
// raw ambience bus (L/R float32) at the busy spots for an offline decode. Exit 0 = PASS, 1 = a spot fails, 2 = the run failed.
import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { holdHeavy } from './heavy_slot.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const QUEUE = opt('--queue', 'rift_coop'), SEED = opt('--seed', '3'), WIN = Number(opt('--window', 14)), RAW = args.includes('--raw');
const OUT = opt('--out', join(HERE, '_reports', `probe_audio_spots_${QUEUE}_${SEED}.json`));
mkdirSync(dirname(OUT), { recursive: true });
const BASE = process.env.VALE_URL ?? 'http://localhost:5190';
const AMB_UNDER_MUSIC_LU = 8;
const release = await holdHeavy('probe_audio_spots ' + QUEUE);
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
browser.on('disconnected', release);
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await context.routeWebSocket(/.*/, () => {});
const page = await context.newPage();
const rep = { queue: QUEUE, seed: SEED, err: null, spots: [] };
try {
  await page.goto(`${BASE}/?dev=1&render=0&autopilot=1&autoflow=1&seed=${SEED}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__vale && !!window.__valeAudio, null, { timeout: 60000 });
  await page.waitForTimeout(1500); await page.keyboard.press('Shift');
  await page.waitForFunction(() => window.__valeAudio?.graph?.ctx?.state === 'running', null, { timeout: 20000 });
  await page.evaluate((q) => { const v = window.__vale; (v.state.queueFor ? v.state.queueFor({ queue: q }) : v.session.queue({ queue: q })); }, QUEUE);
  await page.waitForFunction(() => !!window.__vale.state.match.value, null, { timeout: 600000, polling: 500 });
  await page.waitForFunction(() => (window.__vale.state.match.value?.view.time ?? 0) > 15, null, { timeout: 180000, polling: 500 });
  await page.evaluate(() => { const W = window.__vale.state.match.value.sim.world; for (const c of W.ext.camps?.list ?? []) if (c.def.objective && c.spawnAt > W.time) c.spawnAt = W.time; });
  await page.waitForTimeout(4000);
  rep.rate = await page.evaluate(() => window.__valeAudio.graph.ctx.sampleRate);
  // emitters + their points
  rep.emitters = await page.evaluate(() => { const a = window.__valeAudio; return [...a.amb, ...a.pits.values()].map((e) => ({ role: e.role, cue: e.cue, n: e.pts.length, pts: e.pts, gain: e.def.gain })); });
  // capture graph
  await page.evaluate(() => {
    const a = window.__valeAudio, g = a.graph, ctx = g.ctx;
    const K = (src) => { const hs = ctx.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681.974; hs.gain.value = 3.9998;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.135; hp.Q.value = -6.015; src.connect(hs); hs.connect(hp); return hp; };
    const ems = [...a.amb, ...a.pits.values()];
    window.__ems = ems;
    const stems = [g.bus.music, g.bus.ambience, g.bus.sfx, ...ems.map((e) => e.gain)].map(K);
    window.__names = ['music', 'ambience', 'sfx', ...ems.map((e) => e.role)];
    const N = stems.length * 2 + 2, merger = ctx.createChannelMerger(N);
    stems.forEach((node, i) => { const sp = ctx.createChannelSplitter(2); node.connect(sp); sp.connect(merger, 0, 2 * i); sp.connect(merger, 1, 2 * i + 1); });
    const rsp = ctx.createChannelSplitter(2); g.bus.ambience.connect(rsp); rsp.connect(merger, 0, N - 2); rsp.connect(merger, 1, N - 1);
    const proc = ctx.createScriptProcessor(4096, N, 1);
    window.__cap = []; window.__raw = null;
    proc.onaudioprocess = (ev) => { const ib = ev.inputBuffer, n = ib.length;
      const row = [ctx.currentTime, a.ambDuck?.gain.value ?? 1, a.vduck?.get('ambience')?.gain.value ?? 1, g.bus.ambience.gain.value];
      for (let s2 = 0; s2 < stems.length; s2++) { let ss = 0; for (let c = 0; c < 2; c++) { const d = ib.getChannelData(2 * s2 + c); for (let i = 0; i < n; i++) ss += d[i] * d[i]; } row.push(ss / n); }
      window.__cap.push(row);
      if (window.__raw) { window.__raw.L.push(Array.from(ib.getChannelData(N - 2))); window.__raw.R.push(Array.from(ib.getChannelData(N - 1))); } };
    const z = ctx.createGain(); z.gain.value = 0; merger.connect(proc); proc.connect(z); z.connect(ctx.destination);
    window.__keep = [proc, merger, z];
  });
  const names = await page.evaluate(() => window.__names);
  // spots
  const map = await page.evaluate(() => window.__vale.state.match.value.view.map ?? null).catch(() => null);
  const E = rep.emitters;
  const pick = (cue, f) => { const e = E.find((x) => x.cue === cue); return e && e.pts.length ? f(e.pts) : null; };
  const near = (pts, p) => pts.reduce((b, q) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(b.x - p.x, b.y - p.y) ? q : b));
  const spots = [];
  // busiest candidate: every emitter point, scored by the count of emitter groups with a point within 10 m and 20 m
  const all = E.flatMap((e) => e.pts.map((p) => ({ ...p, cue: e.cue })));
  const score = (p) => E.reduce((s, e) => s + (e.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 10) ? e.gain ** 2 : e.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) <= 20) ? 0.3 * e.gain ** 2 : 0), 0);
  const busiest = all.length ? all.reduce((b, p) => (score(p) > score(b) ? p : b)) : null;
  if (QUEUE.startsWith('rift')) {
    spots.push({ name: 'lane_mid (road_seat 85,55)', x: 85, y: 55 });
    spots.push({ name: 'lane_top (road_high 48.7,15.5)', x: 48.7, y: 15.5 });
    spots.push({ name: 'lane_bot (road_low 48.7,94.5)', x: 48.7, y: 94.5 });
    const cj = pick('amb_rift_canopy', (pts) => pts[Math.floor(pts.length / 3)]); if (cj) spots.push({ name: 'jungle canopy point', ...cj });
    const cj2 = pick('amb_rift_canopy', (pts) => pts[Math.floor((2 * pts.length) / 3)]); if (cj2) spots.push({ name: 'jungle canopy point 2', ...cj2 });
    const w = pick('amb_rift_water', (pts) => near(pts, { x: 85, y: 55 })); if (w) spots.push({ name: 'river shallows (nearest mid)', ...w });
    const w2 = pick('amb_rift_water', (pts) => pts[0]); if (w2) spots.push({ name: 'river shallows pt0', ...w2 });
    const objs = await page.evaluate(() => window.__vale.state.match.value.view.objectives.map((o) => ({ id: o.id, unit: o.unit, at: o.at })));
    for (const o of objs) { spots.push({ name: `pit ${o.unit} +10m east`, x: o.at[0] + 10, y: o.at[1] }); spots.push({ name: `pit ${o.unit} +10m north`, x: o.at[0], y: o.at[1] - 10 }); }
  } else if (QUEUE.startsWith('bridge')) {
    spots.push({ name: 'deck middle (78,22)', x: 78, y: 22 });
    const u = pick('amb_bridge_updraft', (pts) => near(pts, { x: 78, y: 0 })); if (u) spots.push({ name: 'deck edge (updraft pt nearest mid, north)', ...u });
    const u2 = pick('amb_bridge_updraft', (pts) => near(pts, { x: 40, y: 44 })); if (u2) spots.push({ name: 'deck edge (updraft pt, south-west)', ...u2 });
    spots.push({ name: 'deck quarter (45,22)', x: 45, y: 22 });
  } else {
    spots.push({ name: 'arena centre (32,32)', x: 32, y: 32 });
    const l = pick('amb_fray_lantern', (pts) => pts[0]); if (l) spots.push({ name: 'lantern pt0', ...l });
    const b = pick('amb_fray_bunting', (pts) => pts[0]); if (b) spots.push({ name: 'bunting pt0', ...b });
    spots.push({ name: 'arena edge (12,32)', x: 12, y: 32 });
  }
  if (busiest) spots.push({ name: `busiest (score ${score(busiest).toFixed(3)}, ${busiest.cue})`, x: busiest.x, y: busiest.y });
  const mark = () => page.evaluate(() => window.__valeAudio.graph.ctx.currentTime);
  for (const s of spots) {
    await page.evaluate((p) => { window.__valeAudio.listener(() => p); }, { x: s.x, y: s.y });
    await page.waitForTimeout(3000);
    const isBusy = s.name.startsWith('busiest') || s.name.startsWith('jungle canopy point 2') || s.name.startsWith('deck edge (updraft pt nearest') || s.name.startsWith('lantern');
    if (isBusy && RAW) await page.evaluate(() => { window.__raw = { L: [], R: [] }; });
    const t = [await mark()]; await page.waitForTimeout((isBusy ? 26 : WIN) * 1000); t.push(await mark());
    if (isBusy && RAW) { s.raw = await page.evaluate(() => { const r = window.__raw; window.__raw = null; return r; }); }
    s.att = await page.evaluate(() => window.__ems.map((e) => ({ role: e.role, att: Math.round(e.att * 1000) / 1000, playing: !!e.src })));
    s.t = t;
    console.log('spot', s.name);
  }
  await page.evaluate(() => window.__valeAudio.listener(null));
  const cap = await page.evaluate(() => window.__cap);
  const LU = (e) => -0.691 + 10 * Math.log10(Math.max(e, 1e-20));
  for (const s of spots) {
    const rows = cap.filter((r) => r[0] >= s.t[0] && r[0] < s.t[1]);
    const clean = rows.filter((r) => r[1] > 0.95 && r[2] > 0.95);
    const use = clean.length >= rows.length / 3 ? clean : rows;
    const mean = (k) => use.reduce((a, r) => a + r[k], 0) / Math.max(1, use.length);
    const m = LU(mean(4)), am = LU(mean(5)), sf = LU(mean(6));
    const per = {};
    names.slice(3).forEach((n, i) => { const k = 7 + i; const e = use.reduce((a, r) => a + r[k] * (r[1] * r[2] * r[3]) ** 2, 0) / Math.max(1, use.length); const v = LU(e); if (v > -80) per[n] = Math.round((m - v) * 10) / 10; });
    s.result = { blocks: rows.length, cleanBlocks: clean.length, usedClean: use === clean, musicLUFS: Math.round(m * 10) / 10, ambLUFS: Math.round(am * 10) / 10, sfxLUFS: Math.round(sf * 10) / 10,
      ambUnderMusicLU: Math.round((m - am) * 10) / 10, emitterUnderMusicLU: per };
    if (s.raw) { const L = s.raw.L.flat(), R = s.raw.R.flat(); const buf = Buffer.alloc(L.length * 8); for (let i = 0; i < L.length; i++) { buf.writeFloatLE(L[i], 8 * i); buf.writeFloatLE(R[i], 8 * i + 4); }
      const f = OUT.replace(/\.json$/, `_${spots.indexOf(s)}.f32`); writeFileSync(f, buf); s.rawFile = f; delete s.raw; }
    delete s.t;
  }
  rep.spots = spots;
  rep.minAmbUnderMusicLU = Math.min(...spots.map((s) => s.result.ambUnderMusicLU));
  rep.failing = spots.filter((s) => !(s.result.ambUnderMusicLU >= AMB_UNDER_MUSIC_LU)).map((s) => s.name);
} catch (e) { rep.err = String(e?.message ?? e); }
rep.pass = !rep.err && rep.spots.length > 0 && rep.failing?.length === 0;
writeFileSync(OUT, JSON.stringify(rep, null, 1));
for (const s of rep.spots) console.log(s.name, JSON.stringify(s.result));
console.log(rep.err ? `ERR ${rep.err}` : `${rep.pass ? 'PASS' : 'FAIL'} min ambience under music ${rep.minAmbUnderMusicLU} LU (want >= ${AMB_UNDER_MUSIC_LU}) → ${OUT}`);
await browser.close().catch(() => {});
process.exit(rep.err ? 2 : rep.pass ? 0 : 1);
