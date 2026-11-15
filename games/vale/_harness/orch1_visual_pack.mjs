// VALE harness - orch1 evidence collector (visual). Captures 1920x1080 canvas PNGs of the current build at the real
// game camera (High preset unless a shot says otherwise) through the render bench (real catalog, real renderer, bots on
// every seat, deterministic sim). It collects; it judges nothing and changes no game code (damage / kill hooks are the
// same harness hooks shot_structures.mjs uses).
//
//   python3 art/blender/common/heavy.py run -- node _harness/orch1_visual_pack.mjs <session> [--out dir]
//   sessions: rift | bridge | fray | fight | cb:<mode> | fighters:<a|b> | structures:<map> | life | camps | moments
//   orch1 W1-D (GFX-11 / FU-16 / VFX-O1 / VFX-O9): the fight, cb, fighters, camps and moments sessions run as a SPECTATOR (viewer team -1, fog off)
//   so every fighter of both teams is in view, wait for ModelLibrary.pending == 0, and cap() refuses to write a frame in which an on-screen
//   fighter has no attached body or no visible mesh (it waits up to 40 s first, then throws). PNGs are lossless from the canvas; the post step
//   keeps them lossless (WebP q95 only above its size cap, never a palette). Every record carries `bodies` (fighters alive / visible / missing).
// Writes PNGs into --out (default _design/reviews/orch1/evidence/visual) and one parts file per session in <out>/_parts/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const session = args[0];
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'visual'));
const SEED = Number(opt('seed', 7));
mkdirSync(join(OUT, '_parts'), { recursive: true });
const map = (id) => JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', `map_${id}.json`), 'utf8'));
const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const tag = (t) => `t${String(Math.round(t)).padStart(4, '0')}`;

const records = [];
let page = null;
const matchTime = () => B(page, (b) => +b.time().toFixed(2));
async function grab(file) {
  const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]);
  writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'));
}
let ASSERT = false;                      // true: cap() asserts every on-screen fighter's body is attached and visible
/** spectator + fog off: every seat of either team is in view (flags only: no sim step) */
const spectate = () => B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; for (let i = 0; i < 3; i++) R.render(0); });
/** ModelLibrary.pending and, per alive fighter, whether its body is attached and (when on screen) its meshes are visible */
const bodies = () => B(page, (b) => {
  const R = b.renderer, v = b.host.view, W = R.gl.domElement.width, H = R.gl.domElement.height;
  const fs = v.entities.filter((e) => e.kind === 'fighter' && e.alive);
  const missing = []; let visible = 0, onScreen = 0;
  for (const f of fs) {
    const a = R.actors.get(f.id);
    const sc = b.screen(f.x, f.y, 1.0);
    const on = sc.x > -40 && sc.x < W + 40 && sc.y > -40 && sc.y < H + 40;
    let meshes = 0, shown = 0;
    if (a) a.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { meshes++; if (o.visible) shown++; } });
    if (on) onScreen++;
    const ok = !!a && !!a.model && meshes > 0 && (!on || (a.root.visible && shown > 0));
    if (ok) visible++; else missing.push(`${f.def}#${f.id}${a ? (a.model ? ' meshes hidden' : ' no body') : ' no actor'}`);
  }
  return { pending: R.lib?.pending ?? 0, fighters: fs.length, onScreen, visible, missing };
});
/** wait (real time, render only: the sim does not move) until every template landed and every fighter has its body */
async function settle(maxS = 40) {
  let s = null;
  for (let i = 0; i < maxS * 2; i++) {
    await B(page, (b) => { for (let k = 0; k < 3; k++) b.renderer.render(0); });
    s = await bodies();
    if (s.pending === 0 && s.missing.length === 0) return s;
    await page.waitForTimeout(500);
  }
  return s;
}
/** save the canvas as <file> and record it */
async function cap(file, rec) {
  let bod = null;
  if (ASSERT) {
    bod = await settle();
    if (bod.pending !== 0 || bod.missing.length) throw new Error(`cap ${file}: bodies not ready (pending ${bod.pending}, missing ${bod.missing.join(', ')})`);
    await still(2);
  }
  await grab(file);
  const time = await matchTime();
  records.push({ file, width: 1920, height: 1080, seed: SEED, time_s: time, time: mmss(time), ...(bod ? { bodies: bod } : {}), ...rec });
  console.log('cap', file, mmss(time), bod ? `bodies ${bod.visible}/${bod.fighters}` : '');
}
const still = (n = 3) => B(page, (b, k) => { for (let i = 0; i < k; i++) b.renderer.render(0); }, n);
const focus = (x, y, n = 24) => B(page, (b, p) => { b.focus(p[0], p[1]); b.frames(p[2], 1 / 30); }, [x, y, n]);
const gameZoom = () => B(page, (b) => b.zoom(b.catalog.maps.find((m) => m.id === b.host.setup.map)?.camera?.distance ?? 31));
/** fast-forward to match time t (no render), then settle the renderer */
async function goto(t) {
  const r = await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.frames(40, 1 / 30); return { now: b.time(), ended: b.host.ended }; }, t);
  return r;
}
const finish = async () => {
  writeFileSync(join(OUT, '_parts', `${session.replace(/[^a-z0-9]+/gi, '_')}.json`), JSON.stringify({ session, records }, null, 1));
  await page.context().browser().close();
};
const open = async (o) => { const s = await openBench({ q: 'high', seed: SEED, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false, ...o }); page = s.page; s.logs.length && console.log('console errors', s.logs.slice(0, 5)); await gameZoom(); return s; };

// ------------------------------------------------------------------ map sessions
function spotsFor(id) {
  const m = map(id);
  const near = (path, x) => path.reduce((a, p) => (Math.abs(p[0] - x) < Math.abs(a[0] - x) ? p : a));
  const S = [];
  if (id === 'rift') {
    const [W] = m.size;
    for (const l of m.lanes) S.push([`lane_${l.id.replace('road_', '')}`, `${l.name} (${l.id}) at its west third`, near(l.path, 55)]);
    S.push(['base_aubade', 'west base (team 0) fountain side', [m.bases[0].spawn[0] + 6, m.bases[0].spawn[1]]]);
    S.push(['base_serenade', 'east base (team 1) fountain side', [m.bases[1].spawn[0] - 6, m.bases[1].spawn[1]]]);
    for (const id2 of ['a_glasshorn', 'a_resinback', 's_stilltusks', 's_gloamoths']) {
      const c = m.camps.find((x) => x.id === id2); S.push([`jungle_${id2}`, `jungle clearing ${id2}`, c.units[0].at]);
    }
    S.push(['river_north', 'river (Noonline) north of mid', [W / 2, 43]]);
    S.push(['river_south', 'river (Noonline) south of mid', [W / 2, 67]]);
    for (const id2 of ['longshade', 'sunsplinter']) { const c = m.camps.find((x) => x.id === id2); S.push([`pit_${id2}`, `objective pit ${id2}`, c.units[0].at]); }
  } else if (id === 'bridge') {
    const y = m.lanes[0].path[0][1];
    S.push(['span_west_base', 'west base (team 0)', [m.bases[0].spawn[0] + 6, m.bases[0].spawn[1]]]);
    S.push(['span_west', 'span west quarter', [40, y]]);
    S.push(['span_centre', 'span centre (snap point)', [78, y]]);
    S.push(['span_east', 'span east quarter', [116, y]]);
    S.push(['span_east_base', 'east base (team 1)', [m.bases[1].spawn[0] - 6, m.bases[1].spawn[1]]]);
  } else {
    S.push(['plate_centre', 'Noonplate centre', [32, 32]]);
    S.push(['plate_nw', 'Noonplate north-west quadrant', [20, 20]]);
    S.push(['plate_se', 'Noonplate south-east quadrant', [44, 44]]);
    S.push(['plate_rim_w', 'Noonplate west rim', [8, 32]]);
  }
  return S;
}

async function mapSession(id, times) {
  const mode = id;
  await open({ mode, t: 10 });
  const spots = spotsFor(id);
  if (id === 'rift') await clashScan();
  for (const t of times) {
    const r = await goto(t);
    console.log(`${id}: reached ${r.now} s (ended ${r.ended})`);
    for (const [name, what, [x, y]] of spots) {
      await focus(x, y);
      await cap(`map_${id}_${tag(r.now)}_${name}.png`, { kind: 'map', what, map: id, quality: 'high', world: [x, y], ended: r.ended });
    }
    if (r.ended) break;
  }
  await finish();
}

/** mid-lane minion clash: opposing Wicks in contact on the mid road */
async function clashScan() {
  const found = await B(page, (b) => {
    let best = null;
    for (let i = 0; i < 360; i++) {                       // up to 3 min of match, half a second a step
      b.frames(15, 1 / 30);
      const v = b.host.view;
      const mins = v.entities.filter((e) => e.kind === 'minion' && e.alive);
      const fighters = v.entities.filter((e) => e.kind === 'fighter' && e.alive);
      for (const a of mins) {
        if (a.team !== 0 || Math.abs(a.y - 55) > 6) continue;
        for (const c of mins) {
          if (c.team === a.team || Math.hypot(a.x - c.x, a.y - c.y) > 2.6) continue;
          const cx = (a.x + c.x) / 2, cy = (a.y + c.y) / 2;
          const n = mins.filter((m) => Math.hypot(m.x - cx, m.y - cy) < 6).length;
          const f = fighters.filter((m) => Math.hypot(m.x - cx, m.y - cy) < 14).length;
          const sc = n - f * 4;
          if (!best || sc > best.sc) best = { sc, n, f, x: cx, y: cy, t: v.time };
        }
      }
      if (best && best.n >= 6 && best.f === 0 && v.time > best.t + 0) { b.__clash = best; return best; }
      if (best && best.n >= 4 && i > 200) { b.__clash = best; return best; }
    }
    return best;
  });
  console.log('clash found', found);
  if (!found) return;
  for (let k = 0; k < 3; k++) {
    await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(6, 1 / 30); }, found);
    await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(1, 1 / 30); }, found);   // minions drift; the camera stays on the clash
    await cap(`clash_mid_lane_${k + 1}.png`, { kind: 'minion_clash', what: `mid-lane minion clash (${found.n} Wicks within 6 m, ${found.f} fighters within 14 m), frame ${k + 1} of 3 half a second apart`, map: 'rift', quality: 'high', world: [+found.x.toFixed(1), +found.y.toFixed(1)] });
    await B(page, (b) => b.frames(15, 1 / 30));
  }
}

// ------------------------------------------------------------------ teamfight (+ quality tiers, colour-blind)
const FIGHT_T0 = Number(opt('t0', 720)), FIGHT_SCAN = Number(opt('scan', 4500));
async function openFight(extra = '') {
  await open({ mode: 'rift', t: FIGHT_T0, extra });
  await B(page, (b) => b.rebuild());                        // the identical match again from T0 (frame 0 of every replay)
  await B(page, (b) => b.frames(2, 1 / 30));
  await spectate(); ASSERT = true;                          // GFX-11: spectator seating, bodies asserted before every cap
}
async function scanFight() {
  return B(page, (b, N) => {
    let best = null;
    const stepsPerLook = 3;
    for (let i = 0; i < N; i += stepsPerLook) {
      const s = b.frames(stepsPerLook, 1 / 30);
      const v = b.host.view;
      const fs = v.entities.filter((e) => e.kind === 'fighter' && e.alive);
      for (const f of fs) {
        const near = fs.filter((e) => Math.hypot(e.x - f.x, e.y - f.y) < 14);
        const a = near.filter((e) => e.team === 0).length, c = near.filter((e) => e.team === 1).length;
        if (!a || !c) continue;
        const sc = Math.min(a, c) * 4000 + (s.vfx ?? 0) * 6 + (s.particles ?? 0) + (s.telegraphs ?? 0) * 20;
        if (!best || sc > best.sc) {
          const x = near.reduce((q, e) => q + e.x, 0) / near.length, y = near.reduce((q, e) => q + e.y, 0) / near.length;
          best = { sc, frame: i + stepsPerLook + 2, x, y, a, c, vfx: s.vfx, particles: s.particles, tele: s.telegraphs, t: v.time };
        }
      }
    }
    return best;
  }, FIGHT_SCAN);
}
const replayTo = (best) => B(page, (b, p) => { b.rebuild(); b.frames(2, 1 / 30); b.frames(p.frame - 2, 1 / 30); b.focus(p.x, p.y); for (let i = 0; i < 4; i++) b.renderer.render(0); }, best);

async function fightSession() {
  await openFight();
  const best = await scanFight();
  console.log('fight best', best);
  writeFileSync(join(OUT, '_parts', 'fight_best.json'), JSON.stringify(best));
  if (!best) throw new Error('no teamfight found');
  const meta = (extra = {}) => ({ kind: 'teamfight', map: 'rift', world: [+best.x.toFixed(1), +best.y.toFixed(1)], fighters_team0: best.a, fighters_team1: best.c, vfx_actors: best.vfx, particles: best.particles, telegraphs: best.tele, ...extra });
  // lead-up, peak, aftermath of the same fight
  for (const [label, off] of [['lead', -45], ['peak', 0], ['after', 45]]) {
    await B(page, (b, p) => { b.rebuild(); b.frames(Math.max(2, p.frame + p.off), 1 / 30); b.focus(p.x, p.y); for (let i = 0; i < 4; i++) b.renderer.render(0); }, { ...best, off });
    await spectate();
    await cap(`teamfight_rift_${label}.png`, meta({ what: `5v5 teamfight, ${label === 'peak' ? 'peak ability/VFX frame' : label === 'lead' ? 'one and a half seconds before the peak' : 'one and a half seconds after the peak'}`, quality: 'high' }));
  }
  // same peak frame at Low / High / Ultra (frozen sim, render(0))
  await replayTo(best); await spectate();
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    await B(page, (b, q) => b.setQuality(q), q);
    await B(page, (b, p) => { b.focus(p.x, p.y); for (let i = 0; i < 8; i++) b.renderer.render(0); }, best);
    await still(6);
    const st = await B(page, (b) => { const s = b.stats(); return { calls: s.calls, triangles: s.triangles, scale: s.renderScale, w: s.width, h: s.height }; });
    await cap(`quality_teamfight_${q}.png`, meta({ what: `the same teamfight peak frame on the ${q} preset`, quality: q, stats: st }));
  }
  await B(page, (b) => b.setQuality('high'));
  ASSERT = false;                                           // the quiet scenes carry whoever stands there
  // same on a quiet scene: mid lane at the river crossing, base west, jungle
  for (const [name, x, y] of [['river_mid', 85, 55], ['base_aubade', 14.5, 55], ['jungle_glasshorn', 61.6, 41.5]]) {
    await B(page, (b) => b.setQuality('high'));
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      await B(page, (b, p) => { b.setQuality(p.q); b.focus(p.x, p.y); b.frames(20, 1 / 30); for (let i = 0; i < 6; i++) b.renderer.render(0); }, { q, x, y });
      const st = await B(page, (b) => { const s = b.stats(); return { calls: s.calls, triangles: s.triangles, scale: s.renderScale }; });
      await cap(`quality_${name}_${q}.png`, { kind: 'quality', what: `${name} at the game camera on the ${q} preset (a still taken 20 frames after the camera moved)`, map: 'rift', quality: q, world: [x, y], stats: st });
    }
    await B(page, (b) => b.setQuality('high'));
  }
  await finish();
}

async function cbSession(cb) {
  const best = JSON.parse(readFileSync(join(OUT, '_parts', 'fight_best.json'), 'utf8'));
  await openFight(`&cb=${cb}`);
  for (const [label, off] of [['peak', 0]]) {
    await B(page, (b, p) => { b.rebuild(); b.frames(Math.max(2, p.frame + p.off), 1 / 30); b.focus(p.x, p.y); for (let i = 0; i < 4; i++) b.renderer.render(0); }, { ...best, off });
    await spectate();
    await cap(`colorblind_teamfight_${cb}_${label}.png`, { kind: 'colorblind', what: `the teamfight peak frame with the ${cb} colour-blind mode (identical sim frame as teamfight_rift_peak.png)`, map: 'rift', quality: 'high', colorblind: cb, world: [+best.x.toFixed(1), +best.y.toFixed(1)] });
  }
  await finish();
}

// ------------------------------------------------------------------ fighters (two sessions of 8, base skin, game camera)
const ALL16 = ['ardit', 'burdam', 'dunsom', 'ervet', 'hesmi', 'ilsheta', 'kemdo', 'lisvel', 'marund', 'nurrow', 'odrum', 'rishal', 'sukri', 'tunlan', 'ulkro', 'vashil'];
/** the fighter's silhouette: the same camera with its meshes shown and hidden; the pixels that differ (the body, not a ground shadow) */
const silhouetteOf = (id) => B(page, (b, id) => {
  const R = b.renderer, canvas = document.getElementById('c'), a = R.actors.get(id), e = b.host.view.entity(id);
  const mid = b.screen(e.x, e.y, 1.0), W = 300, H = 380;
  const x0 = Math.max(0, Math.min(canvas.width - W, Math.round(mid.x - W / 2))), y0 = Math.max(0, Math.min(canvas.height - H, Math.round(mid.y - H * 0.62)));
  const meshes = []; a.root.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) meshes.push(o); });
  const was = meshes.map((m) => m.visible);
  const read = () => { const o = document.createElement('canvas'); o.width = W; o.height = H; const c = o.getContext('2d', { willReadFrequently: true }); c.drawImage(canvas, x0, y0, W, H, 0, 0, W, H); return c.getImageData(0, 0, W, H).data; };
  R.render(0); const F = read();
  meshes.forEach((m) => { m.visible = false; }); R.render(0); const G = read();
  meshes.forEach((m, i) => { m.visible = was[i]; }); R.render(0);
  let n = 0;
  for (let i = 0; i < W * H; i++) { const d = Math.max(Math.abs(F[i * 4] - G[i * 4]), Math.abs(F[i * 4 + 1] - G[i * 4 + 1]), Math.abs(F[i * 4 + 2] - G[i * 4 + 2])); if (d >= 20) n++; }
  // the body alone into an empty target (nothing in front of it): its pixel count is the unoccluded size
  const skip = []; a.root.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) { skip.push([o, o.layers.mask]); o.layers.disableAll(); } });
  for (const m of a.flashMeshes ?? []) m.traverse((o) => { skip.push([o, o.layers.mask]); o.layers.disableAll(); });
  const gl = R.gl, cw = canvas.width, ch = canvas.height, RT = new (R.overlay.teleTarget.constructor)(cw, ch), mask = new Uint8Array(cw * ch * 4);
  const cc = gl.getClearColor(new (R.tmpColor.constructor)()), ca = gl.getClearAlpha(), ac = gl.autoClear;
  try { gl.setRenderTarget(RT); gl.setClearColor(0x000000, 0); gl.clear(true, true, false); gl.autoClear = false; gl.render(a.root, R.rig.camera); gl.readRenderTargetPixels(RT, 0, 0, cw, ch, mask); }
  finally { gl.setRenderTarget(null); gl.setClearColor(cc, ca); gl.autoClear = ac; for (const [o, m] of skip) o.layers.mask = m; RT.dispose(); }
  let bodyPx = 0; for (let i = 3; i < mask.length; i += 4) if (mask[i] >= 128) bodyPx++;
  R.render(0);
  return { meshes: meshes.length, silhouettePx: n, bodyPx, visibleShare: bodyPx ? +Math.min(1, n / bodyPx).toFixed(2) : 0, box: [x0, y0, W, H] };
}, id);

async function fightersRun(which) {
  let ids = ALL16;
  try { ids = JSON.parse(readFileSync(join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'visual', '_parts', 'fighter_ids.json'), 'utf8')); } catch { /* the roster */ }
  const group = which === 'a' ? ids.slice(0, 8) : ids.slice(8);
  await open({ mode: 'rift', t: 25, extra: `&picks=${group.join(',')}` });
  await B(page, (b) => b.frames(60, 1 / 30));
  await spectate();                                         // every seat of either team is in view whatever its side
  ASSERT = true;
  const empty = [];
  for (const id of group) {
    const me = await B(page, (b, f) => { const v = b.host.view; const e = v.entities.find((x) => x.kind === 'fighter' && x.def === f); return e ? { id: e.id, def: e.def, team: e.team, x: e.x, y: e.y } : null; }, id);
    if (!me) { console.log('no entity for', id); empty.push(id); continue; }
    for (const [cam, zoomTo] of [['game', null], ['close', 0]]) {
      await B(page, (b, p) => { const e0 = b.host.view.entity(p.id); b.zoom(p.z ?? b.catalog.maps.find((m) => m.id === b.host.setup.map).camera.distance); b.focusEntity(p.id); b.frames(20, 1 / 30); b.focusEntity(p.id); b.frames(1, 1 / 30); void e0; }, { id: me.id, z: zoomTo });
      await spectate();
      const chk = await B(page, (b, p) => { const e = b.host.view.entity(p.id); return { def: e.def, alive: e.alive }; }, me);
      if (chk.def !== id) throw new Error(`entity ${me.id} is ${chk.def}, expected ${id}`);
      const sc = await B(page, (b, p) => { const e = b.host.view.entity(p.id); return { ...b.screen(e.x, e.y, 1.0), dist: b.renderer.camera.zoom }; }, me);
      await settle();
      // every fighter is shot on the same open mid-lane ground (a seat can sit behind canopy or a wall: Ilsheta and Tunlan did)
      const lane = map('rift').lanes[0].path; const [lx, ly] = lane[Math.floor(lane.length / 2)];
      const relocated = { from: [+me.x.toFixed(1), +me.y.toFixed(1)], to: [lx, ly] };
      await B(page, (b, p) => { const e = b.host.view.entity(p.id); e.x = p.x; e.y = p.y; e.vx = 0; e.vy = 0; b.host.view.hashDirty = true; b.frames(6, 1 / 30); b.focusEntity(p.id); b.frames(1, 1 / 30); b.focusEntity(p.id); }, { id: me.id, x: lx, y: ly });
      await spectate(); await settle();
      Object.assign(sc, await B(page, (b, p) => { const e = b.host.view.entity(p.id); return b.screen(e.x, e.y, 1.0); }, me));
      const sil = await silhouetteOf(me.id);
      if (sil.silhouettePx < 400 || sil.visibleShare < 0.6) { console.log('EMPTY or occluded crop', id, cam, sil); empty.push(`${id}/${cam}`); }
      await cap(`_raw_fighter_${id}_${cam}.png`, { kind: 'fighter_raw', fighter: id, entity_id: me.id, entity_def: chk.def, team: me.team, screen: sc, silhouette: sil, relocated, quality: 'high', map: 'rift', camera: cam === 'game' ? 'game (distance from the map camera)' : 'closest game camera', spectator: true });
    }
  }
  await finish();
  if (empty.length) { console.error('empty fighter crops:', empty.join(', ')); process.exitCode = 1; }
}

// ------------------------------------------------------------------ monster camps: at spawn, mid-fight, on the death tick
async function campsSession() {
  await open({ mode: 'rift', t: 100 });
  await B(page, (b) => b.host.drivers.delete(0));
  const m = map('rift');
  const me = await B(page, (b) => { const v = b.host.view; const id = v.players.find((p) => p.player === 0).entity; return { id, def: v.entity(id).def, team: v.entity(id).team }; });
  const place = (x, y) => page.evaluate(async (p) => { const b = window.__VALE_BENCH__, e = b.host.view.entity(p.id); if (!e.alive) { const { respawnFighter } = await import('/src/sim/spawn.ts'); respawnFighter(b.host.view, e, p.x, p.y); } e.x = p.x; e.y = p.y; e.vx = 0; e.vy = 0; e.hp = e.maxHp; b.host.view.hashDirty = true; b.host.sim.command(0, { type: 'stop' }); b.frames(3, 1 / 30); }, { id: me.id, x, y });
  const monstersAt = (x, y) => B(page, (b, p) => b.host.view.entities.filter((e) => e.kind === 'monster' && e.alive && Math.hypot(e.x - p.x, e.y - p.y) < 7).map((e) => ({ id: e.id, def: e.def, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp), state: e.state, x: +e.x.toFixed(1), y: +e.y.toFixed(1) })), { x, y });
  const view = (x, y) => B(page, (b, p) => { b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map).camera.distance); b.focus(p.x, p.y); b.frames(6, 1 / 30); b.focus(p.x, p.y); b.frames(1, 1 / 30); }, { x, y });
  const hitIds = (ids, frac, kill = false) => page.evaluate(async (p) => {
    const b = window.__VALE_BENCH__, c = await import('/src/sim/combat.ts'), w = b.host.view;
    const k = w.entity(p.me);
    for (const id of p.ids) { const e = w.entity(id); if (!e || !e.alive) continue; for (let i = 0; i < (p.kill ? 12 : 1) && e.alive; i++) c.dealDamage(w, k, e, p.kill ? (e.hp + 50) * 4 : e.hp * p.frac, 'true'); }
  }, { me: me.id, ids, frac, kill });
  for (const id of ['a_glasshorn', 'a_resinback', 'a_stilltusks', 's_gloamoths', 'a_strays_north', 'sunsplinter', 'longshade']) {
    // the Pits spawn late (sunsplinter 360 s, longshade 960 s): fast-forward just past each spawn, jungle camps are shot from 100 s
    if (id === 'sunsplinter' || id === 'longshade') {
      const to = id === 'sunsplinter' ? 366 : 966;
      await B(page, (b, t) => { const d = t - b.time(); if (d > 0) b.ff(d); b.host.drivers.delete(0); b.frames(10, 1 / 30); }, to);
    }
    const camp = m.camps.find((c) => c.id === id);
    const [x, y] = camp.units[0].at;
    const ms = await monstersAt(x, y);
    if (!ms.length) { console.log('camp empty at', id, x, y); records.push({ file: null, kind: 'camp_missing', camp: id, world: [x, y], seed: SEED }); continue; }
    await place(x - 4.5, y + 1.5);                         // the fighter stands at the camp's edge
    await view(x, y);
    await cap(`camp_${id}_spawn.png`, { kind: 'camp', camp: id, stage: 'spawn', what: `${id} (${ms.map((q) => q.def).join(', ')}) at its spawn, untouched`, monsters: ms, map: 'rift', quality: 'high', world: [x, y] });
    await hitIds(ms.map((q) => q.id), 0.45);
    await B(page, (b) => b.frames(18, 1 / 30));
    await view(x, y);
    const mid = await monstersAt(x, y);
    await cap(`camp_${id}_midfight.png`, { kind: 'camp', camp: id, stage: 'midfight', what: `${id} 0.6 s after a 45 % hit: the monsters have aggroed`, monsters: mid, map: 'rift', quality: 'high', world: [x, y] });
    await hitIds(ms.map((q) => q.id), 1, true);
    let t = 0;
    for (const at of [0.05, 0.4, 1.2]) {
      const n = Math.max(1, Math.round((at - t) * 30)); await B(page, (b, n) => b.frames(n, 1 / 30), n); t += n / 30;
      await view(x, y);
      await cap(`camp_${id}_death_${String(Math.round(at * 100)).padStart(3, '0')}.png`, { kind: 'camp', camp: id, stage: `death_${at}`, what: `${id} ${at.toFixed(2)} s after the last monster fell (the death tick)`, map: 'rift', quality: 'high', world: [x, y] });
    }
  }
  await finish();
}

// ------------------------------------------------------------------ moments: Pit last hit, level up, own kill, Noon Toll (VFX-O9)
const MOMENT_AT = [0, 0.1, 0.3, 0.8, 1.5];
async function momentsSession() {
  const log = [];
  for (const tier of ['high', 'low']) {
    for (const mode of ['rift', 'fray']) {
      await open({ mode, t: mode === 'rift' ? 368 : 40, q: tier });
      await B(page, (b) => b.host.drivers.delete(0));
      await spectate(); ASSERT = false;
      await B(page, (b) => {                                   // the fired-def log: every id the director fires, with the match time
        const d = b.renderer.director, orig = d.fire.bind(d);
        b.__fired = [];
        d.fire = (id, src, tierN, o) => { const has = !!id && d.vfx.has(id); const h = orig(id, src, tierN, o); b.__fired.push({ id: id ?? null, has, handle: h, t: +b.host.view.time.toFixed(2), src, tier: tierN }); return h; };
      });
      const me = await B(page, (b) => { const v = b.host.view; const id = v.players.find((p) => p.player === 0).entity; const e = v.entity(id); return { id, def: e.def, team: e.team }; });
      const m = map(mode);
      const firedSince = (n0) => B(page, (b, n0) => b.__fired.slice(n0), n0);
      const nFired = () => B(page, (b) => b.__fired.length);
      const shoot = async (name, what, x, y, trigger) => {
        await B(page, (b, p) => { b.zoom(b.catalog.maps.find((q) => q.id === b.host.setup.map).camera.distance); b.focus(p.x, p.y); b.frames(8, 1 / 30); b.focus(p.x, p.y); }, { x, y });
        const n0 = await nFired();
        await trigger();
        let el = 0;
        for (const at of MOMENT_AT) {
          const n = at === 0 ? 1 : Math.max(1, Math.round((at - el) * 30)); await B(page, (b, n, dt) => b.frames(n, dt), at === 0 ? 1 : n, at === 0 ? 1 / 120 : 1 / 30);
          el = at; await B(page, (b, p) => b.focus(p.x, p.y), { x, y });
          await cap(`moment_${name}_${tier}_${String(Math.round(at * 10)).padStart(2, '0')}.png`, { kind: 'moment', moment: name, tier, quality: tier, offset_s: at, what: `${what}, ${at} s after the trigger`, map: mode, world: [x, y] });
        }
        const fired = await firedSince(n0);
        log.push({ moment: name, tier, mode, world: [x, y], fired });
        console.log(`moment ${name} ${tier}: fired ${[...new Set(fired.map((f) => `${f.id}${f.has ? '' : '(missing def)'}`))].join(', ') || 'nothing'}`);
      };
      const place = (x, y) => B(page, (b, p) => { const e = b.host.view.entity(p.id); e.x = p.x; e.y = p.y; e.vx = 0; e.vy = 0; e.hp = e.maxHp; b.host.view.hashDirty = true; b.host.sim.command(0, { type: 'stop' }); b.frames(2, 1 / 30); }, { id: me.id, x, y });
      const kill = (victimId) => page.evaluate(async (p) => {
        const b = window.__VALE_BENCH__, c = await import('/src/sim/combat.ts'), w = b.host.view;
        const k = w.entity(p.me), e = w.entity(p.victim);
        for (let i = 0; i < 12 && e && e.alive; i++) { const sh = (e.shields ?? []).reduce((a, x) => a + x.amount, 0); c.dealDamage(w, k, e, (e.hp + sh + 10) * 4, 'true'); }
      }, { me: me.id, victim: victimId });
      if (mode === 'rift') {
        // Pit last hit (the objective monster of the map), seat 0 lands the kill
        const camp = m.camps.find((c) => c.id === 'sunsplinter'); const [x, y] = camp.units[0].at;
        const ms = await B(page, (b, p) => b.host.view.entities.filter((e) => e.kind === 'monster' && e.alive && Math.hypot(e.x - p.x, e.y - p.y) < 7).map((e) => e.id), { x, y });
        await place(x - 5, y + 2);
        await shoot('pit_last_hit', `Pit monster falls to seat 0's last hit (${ms.length} monster(s))`, x, y, async () => { for (const id of ms) await kill(id); });
        // level up
        await place(60, 55);
        await shoot('level_up', 'seat 0 levels up', 60, 55, () => B(page, (b, p) => { const e = b.host.view.entity(p.id); b.renderer.injectEvents([{ e: 'levelUp', t: b.host.view.time, player: 0, level: 3 }]); }, me));
        // own kill (the bounty)
        const foe = await B(page, (b, p) => b.host.view.entities.find((e) => e.kind === 'fighter' && e.team !== p.team && e.alive)?.id ?? null, me);
        if (foe !== null) {
          await B(page, (b, p) => { const f = b.host.view.entity(p.foe); f.x = 64; f.y = 55; f.vx = 0; f.vy = 0; b.host.view.hashDirty = true; b.frames(2, 1 / 30); }, { foe });
          await place(60, 55);
          await shoot('own_kill', `seat 0 kills an enemy fighter (the bounty pop)`, 62, 55, () => kill(foe));
        }
      } else {
        // the Noon Toll announce on FRAY (lights every fighter standing and rings over the plate)
        await shoot('noon_toll', 'the Noon Toll sounds', 32, 32, () => B(page, (b) => b.renderer.injectEvents([{ e: 'announce', t: b.host.view.time, key: 'noon_toll' }])));
      }
      await B(page, (b) => { /* leave the log in the page */ });
      await page.context().browser().close();
    }
  }
  writeFileSync(join(OUT, '_parts', 'moments_fired.json'), JSON.stringify(log, null, 1));
  writeFileSync(join(OUT, '_parts', 'moments.json'), JSON.stringify({ session: 'moments', records }, null, 1));
}

// ------------------------------------------------------------------ structures: every damage stage
async function structuresSession(id) {
  await open({ mode: id, t: 12 });
  await B(page, (b) => {
    b.$ = {
      ent: (i) => b.host.view.entities.find((e) => e.id === i),
      structs: () => b.host.view.entities.filter((e) => e.kind === 'structure').map((e) => ({ id: e.id, def: e.def, team: e.team, x: e.x, y: e.y, maxHp: e.maxHp, hp: e.hp })),
    };
  });
  const S = await B(page, (b) => b.$.structs());
  const kinds = [...new Set(S.map((s) => s.def))];
  console.log('structures', S.length, kinds.join(','));
  const shotS = async (s, stage, extra = {}) => {
    const scr = await B(page, (b, p) => b.screen(p.x, p.y, 3), s);
    await cap(`_raw_struct_${id}_${s.def}_team${s.team}_${stage}.png`, { kind: 'structure_raw', structure: s.def, structure_id: s.id, team: s.team, stage, screen: scr, map: id, quality: 'high', world: [s.x, s.y], ...extra });
  };
  const view = (s) => B(page, (b, p) => { b.focus(p.x, p.y); b.frames(20, 1 / 30); b.focus(p.x, p.y); b.frames(1, 1 / 30); }, s);
  // damage stages with the entity's hp written (the sim's own thresholds read the hp fraction)
  for (const s of S) {
    await view(s);
    for (const [f, label] of [[1, 'hp100'], [0.6, 'hp60'], [0.3, 'hp30']]) {
      await B(page, (b, p) => { const e = b.$.ent(p.id); e.hp = e.maxHp * p.f; for (let i = 0; i < 40; i++) b.renderer.render(0); }, { id: s.id, f });
      await shotS(s, label, { hp_fraction: f, what: `${s.def} team ${s.team} at ${Math.round(f * 100)} % hp` });
    }
    await B(page, (b, p) => { const e = b.$.ent(p.id); e.hp = e.maxHp; }, s);
  }
  // collapse and ruin through the real death path (dealDamage), outermost first
  for (const s of S) {
    await view(s);
    await page.evaluate(async (p) => {
      const b = window.__VALE_BENCH__;
      const c = await import('/src/sim/combat.ts');
      const w = b.host.view;
      const e = w.entities.find((x) => x.id === p.id);
      for (let i = 0; i < 12 && e && e.alive; i++) {
        const sh = (e.shields ?? []).reduce((a, x) => a + x.amount, 0);
        c.dealDamage(w, null, e, (e.hp + sh + 10) * 4, 'true');
      }
    }, s);
    let t = 0;
    for (const at of [0.35, 1.05, 2.4]) {
      const n = Math.max(1, Math.round((at - t) * 30));
      await B(page, (b, n) => b.frames(n, 1 / 30), n); t += n / 30;
      await shotS(s, `collapse_${String(Math.round(t * 100)).padStart(3, '0')}`, { what: `${s.def} team ${s.team} ${t.toFixed(2)} s after it was killed` });
    }
    await B(page, (b) => b.frames(60, 1 / 30));
    await shotS(s, 'ruin', { what: `${s.def} team ${s.team} ruin, 4.4 s after it was killed` });
  }
  await finish();
}

// ------------------------------------------------------------------ death, recall, respawn
async function lifeSession() {
  await open({ mode: 'rift', t: 200 });
  const me = await B(page, (b) => {
    const v = b.host.view; b.host.drivers.delete(0);
    const id = v.players.find((p) => p.player === 0).entity;
    return { id, def: v.entity(id).def };
  });
  const spot = [44, 55];
  const place = (x, y) => B(page, (b, p) => { const e = b.host.view.entity(p.id); e.x = p.x; e.y = p.y; e.vx = 0; e.vy = 0; e.hp = e.maxHp; b.host.view.hashDirty = true; b.host.sim.command(0, { type: 'stop' }); b.frames(3, 1 / 30); b.focusEntity(p.id); }, { id: me.id, x, y });
  const camMe = () => B(page, (b, id) => { b.focusEntity(id); b.frames(1, 1 / 30); b.focusEntity(id); b.renderer.render(0); }, me.id);
  const info = () => B(page, (b, id) => { const e = b.host.view.entity(id); return { state: e.state, alive: e.alive, hp: Math.round(e.hp), x: +e.x.toFixed(1), y: +e.y.toFixed(1) }; }, me.id);
  // recall
  await place(...spot); await B(page, (b) => b.frames(30, 1 / 30)); await camMe();
  await cap('life_recall_00_before.png', { kind: 'recall', what: `${me.def} standing in mid lane before the recall`, map: 'rift', quality: 'high', entity: await info() });
  await B(page, (b) => b.host.sim.command(0, { type: 'recall' }));
  let el = 0;
  for (const at of [0.5, 2, 4, 6.5]) {
    const n = Math.round((at - el) * 30); await B(page, (b, n) => b.frames(n, 1 / 30), n); el = at; await camMe();
    await cap(`life_recall_${String(Math.round(at * 10)).padStart(2, '0')}_channel.png`, { kind: 'recall', what: `recall channel ${at} s in (the channel is 7 s)`, map: 'rift', quality: 'high', entity: await info() });
  }
  for (const at of [7.2, 8.0]) {
    const n = Math.round((at - el) * 30); await B(page, (b, n) => b.frames(n, 1 / 30), n); el = at; await camMe();
    await cap(`life_recall_${String(Math.round(at * 10)).padStart(2, '0')}_departure.png`, { kind: 'recall', what: `${at} s after the recall command (departure)`, map: 'rift', quality: 'high', entity: await info() });
  }
  await B(page, (b) => b.frames(45, 1 / 30)); await camMe();
  await cap('life_recall_99_base.png', { kind: 'recall', what: 'after the recall, back at the fountain', map: 'rift', quality: 'high', entity: await info() });
  // death
  await place(...spot); await B(page, (b) => b.frames(30, 1 / 30)); await camMe();
  const enemy = await B(page, (b) => b.host.view.entities.find((e) => e.kind === 'fighter' && e.team === 1)?.id ?? null);
  await page.evaluate(async (p) => {
    const b = window.__VALE_BENCH__;
    const c = await import('/src/sim/combat.ts');
    const w = b.host.view;
    const e = w.entity(p.me), k = w.entities.find((x) => x.id === p.enemy) ?? null;
    for (let i = 0; i < 12 && e.alive; i++) { const sh = (e.shields ?? []).reduce((a, x) => a + x.amount, 0); c.dealDamage(w, k, e, (e.hp + sh + 10) * 4, 'true'); }
  }, { me: me.id, enemy });
  el = 0;
  for (const at of [0.1, 0.5, 1.2, 3]) {
    const n = Math.max(1, Math.round((at - el) * 30)); await B(page, (b, n) => b.frames(n, 1 / 30), n); el += n / 30; await camMe();
    await cap(`life_death_${String(Math.round(at * 10)).padStart(2, '0')}.png`, { kind: 'death', what: `${at} s after the fighter died`, map: 'rift', quality: 'high', entity: await info() });
  }
  // respawn: step until alive again
  const res = await B(page, (b, id) => { for (let i = 0; i < 30 * 70; i++) { b.frames(1, 1 / 30); if (b.host.view.entity(id).alive) return i / 30; } return -1; }, me.id);
  console.log('respawn after', res, 's');
  await camMe();
  await cap('life_respawn_00.png', { kind: 'respawn', what: `the fighter respawns (about ${res.toFixed(1)} s after death)`, map: 'rift', quality: 'high', entity: await info() });
  for (const at of [0.5, 1.5]) {
    await B(page, (b, n) => b.frames(n, 1 / 30), 15); await camMe();
    await cap(`life_respawn_${String(Math.round(at * 10)).padStart(2, '0')}.png`, { kind: 'respawn', what: `${at} s after the respawn`, map: 'rift', quality: 'high', entity: await info() });
  }
  await finish();
}

const [kind, arg] = (session ?? '').split(':');
const times = { rift: [150, 480, 960], bridge: [60, 300, 720], fray: [20, 120, 360] };
if (['rift', 'bridge', 'fray'].includes(kind)) await mapSession(kind, times[kind]);
else if (kind === 'fight') await fightSession();
else if (kind === 'cb') await cbSession(arg);
else if (kind === 'fighters') await fightersRun(arg);
else if (kind === 'structures') await structuresSession(arg);
else if (kind === 'life') await lifeSession();
else if (kind === 'camps') await campsSession();
else if (kind === 'moments') await momentsSession();
else { console.error('unknown session'); process.exit(2); }
