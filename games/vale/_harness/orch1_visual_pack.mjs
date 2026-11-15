// VALE harness - orch1 evidence collector (visual). Captures 1920x1080 canvas PNGs of the current build at the real
// game camera (High preset unless a shot says otherwise) through the render bench (real catalog, real renderer, bots on
// every seat, deterministic sim). It collects; it judges nothing and changes no game code (damage / kill hooks are the
// same harness hooks shot_structures.mjs uses).
//
//   python3 art/blender/common/heavy.py run -- node _harness/orch1_visual_pack.mjs <session> [--out dir]
//   sessions: rift | bridge | fray | fight | cb:<mode> | fighters:<a|b> | structures:<map> | life
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
/** save the canvas as <file> and record it */
async function cap(file, rec) {
  await grab(file);
  const time = await matchTime();
  records.push({ file, width: 1920, height: 1080, seed: SEED, time_s: time, time: mmss(time), ...rec });
  console.log('cap', file, mmss(time));
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
const FIGHT_T0 = 420, FIGHT_SCAN = 2400;
async function openFight(extra = '') {
  await open({ mode: 'rift', t: FIGHT_T0, extra });
  await B(page, (b) => b.rebuild());                        // the identical match again from T0 (frame 0 of every replay)
  await B(page, (b) => b.frames(2, 1 / 30));
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
        const near = fs.filter((e) => Math.hypot(e.x - f.x, e.y - f.y) < 10);
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
    await cap(`teamfight_rift_${label}.png`, meta({ what: `5v5 teamfight, ${label === 'peak' ? 'peak ability/VFX frame' : label === 'lead' ? 'one and a half seconds before the peak' : 'one and a half seconds after the peak'}`, quality: 'high' }));
  }
  // same peak frame at Low / High / Ultra (frozen sim, render(0))
  await replayTo(best);
  for (const q of ['low', 'high', 'ultra']) {
    await B(page, (b, q) => b.setQuality(q), q);
    await B(page, (b, p) => { b.focus(p.x, p.y); for (let i = 0; i < 8; i++) b.renderer.render(0); }, best);
    await still(6);
    const st = await B(page, (b) => { const s = b.stats(); return { calls: s.calls, triangles: s.triangles, scale: s.renderScale, w: s.width, h: s.height }; });
    await cap(`quality_teamfight_${q}.png`, meta({ what: `the same teamfight peak frame on the ${q} preset`, quality: q, stats: st }));
  }
  await B(page, (b) => b.setQuality('high'));
  // same on a quiet scene: mid lane at the river crossing, base west, jungle
  for (const [name, x, y] of [['river_mid', 85, 55], ['base_aubade', 14.5, 55], ['jungle_glasshorn', 61.6, 41.5]]) {
    await B(page, (b) => b.setQuality('high'));
    for (const q of ['low', 'high', 'ultra']) {
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
    await cap(`colorblind_teamfight_${cb}_${label}.png`, { kind: 'colorblind', what: `the teamfight peak frame with the ${cb} colour-blind mode (identical sim frame as teamfight_rift_peak.png)`, map: 'rift', quality: 'high', colorblind: cb, world: [+best.x.toFixed(1), +best.y.toFixed(1)] });
  }
  await finish();
}

// ------------------------------------------------------------------ fighters (two sessions of 8, base skin, game camera)
async function fightersRun(which) {
  const ids = JSON.parse(readFileSync(join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'visual', '_parts', 'fighter_ids.json'), 'utf8'));
  const group = which === 'a' ? ids.slice(0, 8) : ids.slice(8);
  await open({ mode: 'rift', t: 25, extra: `&picks=${group.join(',')}` });
  await B(page, (b) => b.frames(60, 1 / 30));
  for (const id of group) {
    const me = await B(page, (b, f) => { const v = b.host.view; const e = v.entities.find((x) => x.kind === 'fighter' && x.def === f); return e ? { id: e.id, team: e.team, x: e.x, y: e.y } : null; }, id);
    if (!me) { console.log('no entity for', id); continue; }
    // game camera
    await B(page, (b, p) => { b.zoom(b.catalog.maps.find((m) => m.id === b.host.setup.map).camera.distance); b.focusEntity(p.id); b.frames(20, 1 / 30); b.focusEntity(p.id); b.frames(1, 1 / 30); }, me);
    const sc = await B(page, (b, p) => { const e = b.host.view.entity(p.id); return b.screen(e.x, e.y, 1.0); }, me);
    await cap(`_raw_fighter_${id}_game.png`, { kind: 'fighter_raw', fighter: id, team: me.team, screen: sc, quality: 'high', map: 'rift', camera: 'game (distance from the map camera)' });
    // closest camera the game allows
    await B(page, (b, p) => { b.zoom(0); b.focusEntity(p.id); b.frames(20, 1 / 30); b.focusEntity(p.id); b.frames(1, 1 / 30); }, me);
    const sc2 = await B(page, (b, p) => { const e = b.host.view.entity(p.id); return { ...b.screen(e.x, e.y, 1.0), dist: b.renderer.camera.zoom }; }, me);
    await cap(`_raw_fighter_${id}_close.png`, { kind: 'fighter_raw', fighter: id, team: me.team, screen: sc2, quality: 'high', map: 'rift', camera: 'closest game camera' });
  }
  await finish();
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
else { console.error('unknown session'); process.exit(2); }
