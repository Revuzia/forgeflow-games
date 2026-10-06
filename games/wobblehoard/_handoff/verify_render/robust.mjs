// Lens 1b: robustness. Each case runs on a fresh small stage (320x200, low) unless stated; records thrown errors, console errors,
// done resolution, bodies left, scene children, renderer memory.  node robust.mjs [case,case...]
import { setup, save } from './common.mjs';
const only = (process.argv[2] ?? '').split(',').filter(Boolean);
const env = await setup({ width: 400, height: 300 });
console.log('body:', env.info);
const results = {};
const heap = async () => { await env.cdp.send('HeapProfiler.collectGarbage'); await env.cdp.send('HeapProfiler.collectGarbage'); return (await env.cdp.send('Runtime.getHeapUsage')).usedSize; };
async function T(name, fn, arg) {
  if (only.length && !only.includes(name)) return;
  const t0 = Date.now();
  let r;
  try { r = await env.page.evaluate(fn, arg); } catch (e) { r = { THREW_OUTSIDE: String(e) }; }
  const errs = await env.page.evaluate(() => { const e = window.__V__.errors.slice(); window.__V__.errors.length = 0; return e; });
  const con = env.bad.splice(0);
  results[name] = { ...r, pageErrors: errs, console: con };
  console.log(`\n== ${name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(JSON.stringify(results[name]).slice(0, 2500));
}

// --- 1. skip at 50 ms / mid-burst / after done vs the natural end (final-frame fingerprint after 3 s of settle) ---
const fpDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return d / (a.length / 4); };
for (const [kind, tier] of [['capsule', 'common'], ['capsule', 'epic'], ['capsule', 'mythic'], ['merge', 'common'], ['merge', 'legendary'], ['merge', 'mythic']]) {
  await T(`skip_${kind}_${tier}`, async ([kind, tier]) => {
    const V = window.__V__; const dt = 1 / 30;
    const fpDiff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3; return d / (a.length / 4); };
    V.newStage(320, 200, 'med');
    const one = async (skipAt, label) => {
      const c = V.ctx; const g = V.GN.genomeFromParam(''); c.play = V.mkBody(g); c.stage.setBody(c.play, g); c.time = 100; V.frames(20, dt);
      const r = await V.run({ kind, tier, dt, skipAt, settle: 0, record: false, noDrop: true });
      const burst = r.beats.find((b) => b.beat === 'burst');
      if (skipAt === 'after') { /* after done: skip on a finished handle must be a no-op */ }
      V.frames(90, dt);
      return { label, fp: V.fingerprint(), beats: r.beats.map((b) => b.beat + '@' + b.t.toFixed(2)).join(' '), frames: r.activeFrames, hidden: r.resultHidden, done: r.doneResolved, bodies: r.bodies, primaryIsResult: r.primaryIsResult, burstT: burst ? burst.t : null, ceremonyAfter: c.stage.info.ceremony, capsule: c.stage.info.capsule, screenLight: c.stage.info.screenLight, cam: { ...c.stage.info.cameraFx } };
    };
    const nat = await one(undefined, 'natural');
    const burstT = nat.burstT ?? 1;
    const s50 = await one(0.05, 'skip@50ms');
    const s0 = await one(0, 'skip@0');
    const sb = await one(burstT + 0.04, 'skip@burst+40ms');
    const sl = await one(nat.frames * dt - 0.05, 'skip@end-50ms');
    const out = {};
    for (const s of [s50, s0, sb, sl]) out[s.label] = { diffVsNatural: +fpDiff(nat.fp, s.fp).toFixed(3), beats: s.beats, hiddenFrames: s.hidden, done: s.done, bodies: s.bodies, primaryIsResult: s.primaryIsResult, ceremonyAfter: s.ceremonyAfter, capsule: s.capsule, light: s.screenLight };
    out.natural = { beats: nat.beats, frames: nat.frames, bodies: nat.bodies };
    return out;
  }, [kind, tier]);
}
// skip after done + double skip + skip during crossfade
await T('skip_after_done_and_double', async () => {
  const V = window.__V__, dt = 1 / 30; V.newStage(320, 200, 'low');
  const st = V.ctx.stage; const beats = [];
  const h = st.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('') }], result: { genome: V.resultGenome('rare'), tier: 'rare' }, createBody: V.mkBody }, { onBeat: (b) => beats.push(b) });
  V.frames(12, dt);
  h.skip(); h.skip(); V.frames(1, dt); h.skip(); V.frames(10, dt);
  const afterFirst = beats.slice();
  h.skip(); V.frames(3, dt);
  let threw = null; try { h.skip(); } catch (e) { threw = String(e); }
  return { beats, afterFirst, active: h.active, threw, bodies: st.info.bodies, primaryIsResult: st.primaryBodyId() === h.resultBodyId };
});

// --- 2. a ceremony started while another runs (every combination, at several moments) ---
await T('overlap', async () => {
  const V = window.__V__, dt = 1 / 30; V.newStage(320, 200, 'low');
  const st = V.ctx.stage; const out = [];
  const mkMerge = (tier) => st.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('') }], result: { genome: V.resultGenome(tier), tier }, createBody: V.mkBody });
  const mkCap = (tier) => st.playCapsuleReveal({ result: { genome: V.resultGenome(tier), tier }, createBody: V.mkBody });
  for (const [a, b, at] of [['merge', 'capsule', 0.2], ['merge', 'capsule', 1.45], ['capsule', 'merge', 0.7], ['capsule', 'capsule', 0.66], ['merge', 'merge', 2.9], ['capsule', 'merge', 2.0]]) {
    const g = V.GN.genomeFromParam(''); V.ctx.play = V.mkBody(g); st.setBody(V.ctx.play, g); V.frames(5, dt);
    const m0 = V.mem();
    const h1 = a === 'merge' ? mkMerge('mythic') : mkCap('mythic');
    V.frames(Math.round(at / dt), dt);
    const midLight = st.info.screenLight;
    const h2 = b === 'merge' ? mkMerge('legendary') : mkCap('legendary');
    let d1 = false; h1.done.then(() => { d1 = true; }, () => { d1 = 'REJECTED'; });
    let k = 0; while (h2.active && k < 400) { V.frame(dt, k % 10 === 0); k++; }
    let d2 = false; await h2.done.then(() => { d2 = true; }, () => { d2 = 'REJECTED'; });
    await new Promise((r) => setTimeout(r, 0));
    V.ctx.play = h2.resultBody ?? V.ctx.play;
    V.frames(10, dt);
    out.push({ case: `${a}->${b}@${at}`, h1active: h1.active, d1, d2, h1result: h1.resultBodyId, h2result: h2.resultBodyId, primary: st.primaryBodyId(), bodies: st.info.bodies, capsule: st.info.capsule, midLight, lightAfter: st.info.screenLight, cam: { ...st.info.cameraFx }, memBefore: m0, memAfter: V.mem() });
  }
  return { out };
});

// --- 3. dispose the stage mid-ceremony (several moments), then calls on the disposed stage ---
await T('dispose_mid', async () => {
  const V = window.__V__, dt = 1 / 30; const out = [];
  for (const [kind, at] of [['merge', 0.5], ['merge', 2.85], ['capsule', 1.7], ['capsule', 0.05]]) {
    V.newStage(320, 200, 'low');
    const st = V.ctx.stage;
    const h = kind === 'merge' ? st.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('3') }], result: { genome: V.resultGenome('mythic'), tier: 'mythic' }, createBody: V.mkBody }) : st.playCapsuleReveal({ result: { genome: V.resultGenome('mythic'), tier: 'mythic' }, createBody: V.mkBody });
    V.frames(Math.round(at / dt), dt);
    let threw = null;
    try { st.dispose(); } catch (e) { threw = 'dispose: ' + e; }
    let d = false; await Promise.race([h.done.then(() => { d = true; }, () => { d = 'REJECTED'; }), new Promise((r) => setTimeout(r, 300))]);
    const after = {};
    try { st.update(1 / 30, { time: 99, pointerNdc: null }); st.render(); const h2 = st.playMergeCeremony({ parents: [], result: { genome: V.resultGenome('rare'), tier: 'rare' }, createBody: V.mkBody }); after.h2 = { active: h2.active, body: h2.resultBody }; const c2 = st.dropCapsule(); after.cap = { landed: c2.landed, pt: c2.screenPoint() }; st.setBody(V.mkBody(V.GN.genomeFromParam('')), V.GN.genomeFromParam('')); after.bodies = st.info.bodies; st.dispose(); } catch (e) { threw = (threw ?? '') + ' after: ' + e; }
    const m = st.memory();
    out.push({ kind, at, threw, done: d, memAfterDispose: { g: m.geometries, t: m.textures, p: m.programs }, after });
    V.ctx = null;
  }
  return { out };
});

// --- 4. lose / restore the WebGL context mid-ceremony (+ skip while lost, resize while lost) ---
await T('context_loss_mid', async () => {
  const V = window.__V__, dt = 1 / 30; V.newStage(320, 200, 'med');
  const st = V.ctx.stage, out = {};
  const h = st.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('3') }], result: { genome: V.resultGenome('legendary'), tier: 'legendary' }, createBody: V.mkBody });
  V.frames(Math.round(2.45 / dt), dt, true);   // just after the burst
  out.lose = st.loseContext();
  await new Promise((r) => setTimeout(r, 150));
  out.lostFlag = st.info.contextLost;
  V.frames(5, dt, true);
  st.resize(300, 220, 1);
  h.skip();
  V.frames(6, dt, true);
  out.activeAfterSkip = h.active;
  let d = false; await Promise.race([h.done.then(() => { d = true; }), new Promise((r) => setTimeout(r, 300))]); out.done = d;
  V.ctx.play = h.resultBody;
  // a new ceremony while still lost
  const h2 = st.playCapsuleReveal({ result: { genome: V.resultGenome('epic'), tier: 'epic' }, createBody: V.mkBody });
  V.frames(20, dt, true);
  out.restore = st.restoreContext();
  for (let i = 0; i < 60 && st.info.contextLost; i++) await new Promise((r) => setTimeout(r, 50));
  out.lostAfterRestore = st.info.contextLost;
  let k = 0; while (h2.active && k < 300) { V.frame(dt, true); k++; }
  V.ctx.play = h2.resultBody ?? V.ctx.play;
  V.frames(10, dt, true);
  const l = V.lum(); out.lumAfter = l.L; out.maxPix = l.maxPix; out.bodies = st.info.bodies;
  // and the default framebuffer after restore draws the scene (non-background)
  const fp = V.fingerprint(32, 20); let nonBg = 0; for (let i = 0; i < fp.length; i += 4) if (Math.abs(fp[i] - 0x14) > 8 || Math.abs(fp[i + 1] - 0x10) > 8 || Math.abs(fp[i + 2] - 0x2a) > 8) nonBg++;
  out.nonBgFrac = nonBg / (fp.length / 4);
  out.mem = V.mem();
  return out;
});

// --- 5. capsule edge cases: remove mid-squeeze, stale handle to a reveal, drop during calm fade, two drops ---
await T('capsule_edges', async () => {
  const V = window.__V__, dt = 1 / 30; V.newStage(320, 200, 'low');
  const st = V.ctx.stage, out = {};
  const c1 = st.dropCapsule({ onLand: () => { out.land1 = (out.land1 ?? 0) + 1; } });
  V.frames(60, dt);
  out.c1landed = c1.landed;
  for (let i = 0; i < 8; i++) { c1.setSqueeze(i / 15); V.frame(dt, false); }
  c1.remove();                                  // finger still down, capsule removed mid-squeeze
  c1.setSqueeze(0.9); c1.wobble(2); V.frames(3, dt);
  out.afterRemove = { landed: c1.landed, pt: c1.screenPoint(), hit: c1.hitTest(160, 100, 500), capsule: st.info.capsule };
  const h = st.playCapsuleReveal({ result: { genome: V.resultGenome('rare'), tier: 'rare' }, createBody: V.mkBody, capsule: c1 });   // stale handle
  V.frames(3, dt);
  out.staleRevealCapsuleVisible = st.info.capsule;
  let k = 0; while (h.active && k < 300) { V.frame(dt, k % 20 === 0); k++; }
  V.ctx.play = h.resultBody;
  out.afterReveal = { capsule: st.info.capsule, bodies: st.info.bodies };
  // calm: drop, then reveal before the fade finished
  st.setCalmEffects(true);
  const c2 = st.dropCapsule({ onLand: () => { out.land2 = (out.land2 ?? 0) + 1; } });
  V.frames(5, dt);
  const h2 = st.playCapsuleReveal({ result: { genome: V.resultGenome('common'), tier: 'common' }, createBody: V.mkBody, capsule: c2 });
  k = 0; while (h2.active && k < 300) { V.frame(dt, k % 20 === 0); k++; }
  V.ctx.play = h2.resultBody; st.setCalmEffects(false);
  out.calmEarlyReveal = { land2: out.land2 ?? 0, capsule: st.info.capsule, bodies: st.info.bodies };
  // two drops in a row: the first handle goes dead
  const a = st.dropCapsule(); V.frames(50, dt); const b = st.dropCapsule(); V.frames(50, dt);
  out.twoDrops = { aLanded: a.landed, aPt: a.screenPoint(), bLanded: b.landed, bPt: !!b.screenPoint() };
  b.remove(); V.frames(2, dt);
  out.mem = V.mem();
  return out;
});

// --- 6. shell misuse mid-ceremony: clearBodies, removeBody(result), setBody, setBodyTier, addBody, calm toggle, resize ---
await T('misuse_mid', async () => {
  const V = window.__V__, dt = 1 / 30; const out = [];
  for (const act of ['clearBodies', 'removeResult', 'removePrimary', 'setBody', 'addBody', 'calmOn', 'resize', 'setQualityLow']) {
    V.newStage(320, 200, 'med');
    const st = V.ctx.stage; let threw = null;
    const h = st.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('3') }], result: { genome: V.resultGenome('epic'), tier: 'epic' }, createBody: V.mkBody });
    V.frames(30, dt);
    try {
      if (act === 'clearBodies') st.clearBodies();
      if (act === 'removeResult') st.removeBody(h.resultBodyId);
      if (act === 'removePrimary') st.removeBody(st.primaryBodyId());
      if (act === 'setBody') { const g = V.GN.genomeFromParam('2'); V.ctx.play = V.mkBody(g); st.setBody(V.ctx.play, g); }
      if (act === 'addBody') { const g = V.GN.genomeFromParam('2'); st.addBody(V.mkBody(g), g, { tier: 'rare', position: { x: 1, y: 0, z: 0 } }); }
      if (act === 'calmOn') st.setCalmEffects(true);
      if (act === 'resize') st.resize(200, 400, 2);
      if (act === 'setQualityLow') st.setQuality('low');
      let k = 0; while (h.active && k < 300) { V.frame(dt, k % 5 === 0); k++; }
      if (act !== 'setBody') V.ctx.play = h.resultBody;
      V.frames(5, dt, true);
    } catch (e) { threw = String(e && e.stack || e); }
    let d = false; await Promise.race([h.done.then(() => { d = true; }, () => { d = 'REJECTED'; }), new Promise((r) => setTimeout(r, 300))]);
    const prim = st.primaryBodyId();
    const pv = st.views.find((v) => v.id === prim);
    out.push({ act, threw, done: d, bodies: st.info.bodies, primary: prim, primaryHasView: !!pv, primaryVisible: pv ? pv.visible : null, resultId: h.resultBodyId, resultInViews: !!st.views.find((v) => v.id === h.resultBodyId), resultBody: !!h.resultBody, visibleViews: st.views.filter((v) => v.visible).length, sceneChildren: st.scene.children.length, mem: V.mem() });
  }
  return { out };
});

// --- 7. createBody that throws (2nd parent / result) and hooks that throw ---
await T('throwing_callbacks', async () => {
  const V = window.__V__, dt = 1 / 30; const out = [];
  for (const which of [1, 2, 'cap']) {
    V.newStage(320, 200, 'low');
    const st = V.ctx.stage; let n = 0; let threw = null;
    const before = { views: st.views.length, visible: st.views.filter((v) => v.visible).length, children: st.scene.children.length };
    const cb = (g) => { n++; if (which === 'cap' ? n === 1 : n === which + 1) throw new Error('createBody boom'); return V.mkBody(g); };
    try {
      if (which === 'cap') { const c = st.dropCapsule(); V.frames(60, dt); st.playCapsuleReveal({ result: { genome: V.resultGenome('legendary'), tier: 'legendary' }, createBody: cb, capsule: c }); }
      else st.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('3') }], result: { genome: V.resultGenome('legendary'), tier: 'legendary' }, createBody: cb });
    } catch (e) { threw = String(e); }
    V.frames(30, dt, true);
    out.push({ throwOnCall: which, threw, before, after: { views: st.views.length, visible: st.views.filter((v) => v.visible).length, primaryVisible: !!st.views.find((v) => v.id === st.primaryBodyId())?.visible, children: st.scene.children.length, capsule: st.info.capsule, ceremony: st.info.ceremony } });
  }
  // a hook that throws on every beat
  V.newStage(320, 200, 'low');
  const r = await V.run({ kind: 'merge', tier: 'rare', dt, throwInHook: true, record: false });
  out.push({ hookThrows: true, beats: r.beats.map((b) => b.beat).join('>'), done: r.doneResolved, bodies: r.bodies });
  return { out };
});

// --- 8. big / odd dt: beats must not be skipped (quick + calm capsule at 10 fps; merge at 10 fps), NaN dt ---
await T('coarse_dt', async () => {
  const V = window.__V__; const out = [];
  V.newStage(320, 200, 'low');
  for (const o of [{ kind: 'capsule', tier: 'common', quick: true, calm: true }, { kind: 'capsule', tier: 'uncommon', quick: true, calm: false }, { kind: 'merge', tier: 'common', calm: true }, { kind: 'capsule', tier: 'mythic', calm: true }]) {
    const g = V.GN.genomeFromParam(''); V.ctx.play = V.mkBody(g); V.ctx.stage.setBody(V.ctx.play, g);
    const r = await V.run({ ...o, dt: 0.1, record: false, noDrop: true });
    out.push({ ...o, beats: r.beats.map((b) => b.beat + '@' + b.t.toFixed(2)).join(' '), seconds: r.seconds, duration: r.duration });
  }
  V.ctx.stage.setCalmEffects(false);
  // NaN / negative dt in the middle of a ceremony
  const st = V.ctx.stage;
  const h = st.playCapsuleReveal({ result: { genome: V.resultGenome('epic'), tier: 'epic' }, createBody: V.mkBody });
  let threw = null;
  try { for (let i = 0; i < 20; i++) st.update(i % 2 ? NaN : -1, { time: NaN, pointerNdc: null }); st.render(); for (let i = 0; i < 200 && h.active; i++) V.frame(1 / 30, false); } catch (e) { threw = String(e); }
  out.push({ nanDt: true, threw, active: h.active });
  return { out };
});

// --- 8b. events the stage-stepped ceremony bodies emitted: who drains them? (the shell adopts resultBody after done and drains) ---
await T('stale_events', async () => {
  const V = window.__V__, dt = 1 / 30; const out = [];
  V.newStage(320, 200, 'low');
  for (const [kind, tier] of [['capsule', 'rare'], ['merge', 'legendary'], ['capsule', 'common']]) {
    const g = V.GN.genomeFromParam(''); V.ctx.play = V.mkBody(g); V.ctx.stage.setBody(V.ctx.play, g); V.frames(10, dt);
    const r = await V.run({ kind, tier, dt, record: false, noDrop: true });
    const evs = []; V.ctx.play.drainEvents(evs);   // the first drain the shell does after adopting the result
    const t = r.seconds;
    out.push({ kind, tier, ceremonySeconds: t, staleEvents: evs.length, kinds: evs.reduce((m, e) => { m[e.kind] = (m[e.kind] ?? 0) + 1; return m; }, {}), landIntensities: evs.filter((e) => e.kind === 'land').map((e) => +e.intensity.toFixed(2)) });
  }
  return { real: V.real, out };
});

// --- 9. determinism: the same ceremony twice from the same state gives the same frames ---
await T('determinism', async () => {
  const V = window.__V__, dt = 1 / 30; const sig = [];
  for (let run = 0; run < 2; run++) {
    V.newStage(240, 160, 'low');
    V.ctx.time = 0;
    const fps = [];
    const h = V.ctx.stage.playMergeCeremony({ parents: [{ genome: V.GN.genomeFromParam('') }, { genome: V.GN.genomeFromParam('3') }], result: { genome: V.resultGenome('mythic'), tier: 'mythic' }, createBody: V.mkBody });
    let f = 0; while (h.active) { V.frame(dt, false); if (f % 15 === 0) fps.push(V.fingerprint(24, 16)); f++; }
    sig.push({ fps, hash: h.resultBody.stateHash() });
  }
  let maxd = 0; for (let i = 0; i < sig[0].fps.length; i++) { const a = sig[0].fps[i], b = sig[1].fps[i]; let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k])); maxd = Math.max(maxd, d); }
  return { samples: sig[0].fps.length, maxPixelDiff: maxd, hashes: [sig[0].hash, sig[1].hash] };
});

// --- 10. 20 ceremonies in a row (mixed kinds / tiers / calm / skip): renderer memory + scene children + JS heap ---
if (!only.length || only.includes('twenty')) {
  await env.page.evaluate(() => { window.__V__.newStage(320, 200, 'med'); });
  const series = [];
  for (let i = 0; i < 20; i++) {
    const r = await env.page.evaluate(async (i) => {
      const V = window.__V__, TI = V.TI, dt = 1 / 30;
      const kind = i % 2 ? 'merge' : 'capsule', tier = TI[i % 6];
      const r = await V.run({ kind, tier, dt, record: false, calm: i % 5 === 4, skipAt: i % 3 === 2 ? 0.9 : undefined, parents: i % 4 === 3 ? 3 : 2, tierUp: i % 7 === 6 });
      V.frames(10, dt, true);
      return { i, kind, tier, done: r.doneResolved, bodies: r.bodies, mem: V.mem(), particles: V.ctx.stage.info.particles };
    }, i);
    r.heapMB = +((await heap()) / 1048576).toFixed(2);
    series.push(r);
    console.log(JSON.stringify(r));
  }
  results.twenty = { series, console: env.bad.splice(0) };
}

save('robust.json', results);
console.log('\nconsole problems left:', env.bad.length, env.bad.slice(0, 20));
await env.close();
