// verifier-only (look close r1): own 1920x1080 frames per map: laning, a 5v5 fight, an ultimate, a kill. Canvas pixels (no DOM HUD).
//   VALE_URL=http://localhost:<port> python3 art/blender/common/heavy.py run -- node _harness/_tmp_vfy_lc_frames.mjs [rift,bridge,fray]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '_tmp_vfy_lc_shots'); mkdirSync(OUT, { recursive: true });
const MAPS = (process.argv[2] ?? 'rift,bridge,fray').split(',');
const T = { rift: [110, 760], bridge: [95, 560], fray: [45, 260] };
const log = [];

for (const mode of MAPS) {
  const [tLane, tFight] = T[mode];
  const s = await openBench({ q: 'high', seed: 11, mode, t: tLane, w: 1920, h: 1080, dsf: 1, manual: true, dyn: false });
  const page = s.page;
  const grab = async (name, meta = {}) => {
    const b64 = await page.evaluate(() => document.getElementById('c').toDataURL('image/png').split(',')[1]);
    const file = `lc_${mode}_${name}${process.env.LC_SUFFIX ?? ''}.png`; writeFileSync(join(OUT, file), Buffer.from(b64, 'base64'));
    const st = await B(page, (b) => { const x = b.stats(); return { calls: x.calls, tris: x.triangles, vfx: x.vfx, particles: x.particles, tele: x.telegraphs, t: +b.time().toFixed(1) }; });
    log.push({ file, ...st, ...meta }); console.log('cap', file, JSON.stringify(st), JSON.stringify(meta));
  };
  const zoom = () => B(page, (b) => b.zoom(b.catalog.maps.find((m) => m.id === b.host.setup.map)?.camera?.distance ?? 31));
  const view = () => B(page, (b) => { const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true; for (let i = 0; i < 4; i++) R.render(0); });
  const settle = async () => { for (let i = 0; i < 20; i++) { const p = await B(page, (b) => { for (let k = 0; k < 3; k++) b.renderer.render(0); return b.renderer.lib?.pending ?? 0; }); if (!p) break; await page.waitForTimeout(500); } };
  await zoom(); await view();
  // laning: densest minion clash (fight() weights fighters of both sides; early, the wave fronts)
  const lane = await B(page, (b) => { const f = b.fight(); if (f) b.focus(f.x, f.y); b.frames(6, 1 / 30); if (f) b.focus(f.x, f.y); return f; });
  await view(); await settle(); await grab('laning', { at: lane });
  // keep seat 0 (the bench's local player) alive from here: its death eases the whole world to grey (the death screen)
  await B(page, (b) => { const f0 = b.frames; b.frames = (n = 1, dt = 1 / 30) => { let r; for (let i = 0; i < n; i++) { const v = b.host.view, id = v.players.find((p) => p.player === 0)?.entity, e = id !== undefined ? v.entity(id) : null; if (e && e.alive) e.hp = e.maxHp; r = f0(1, dt); } return r; }; });
  // 5v5 fight
  await B(page, (b, t) => { b.ff(t - b.time()); b.frames(30, 1 / 30); const v = b.host.view, id = v.players.find((p) => p.player === 0)?.entity; for (let i = 0; i < 1800 && !(v.entity(id)?.alive); i++) b.frames(1, 1 / 30); }, tFight);
  let best = null;
  for (let i = 0; i < 60; i++) {
    const r = await B(page, () => {
      const b = window.__VALE_BENCH__, v = b.host.view, fs = v.entities.filter((e) => e.kind === 'fighter' && e.alive);
      let best = null;
      for (const f of fs) { const near = fs.filter((e) => Math.hypot(e.x - f.x, e.y - f.y) < 12); const a = near.filter((e) => e.team === 0).length, c = near.length - a; const sc = Math.min(a, c) * 10 + near.length; if (a && c && (!best || sc > best.sc)) best = { sc, a, c, x: near.reduce((q, e) => q + e.x, 0) / near.length, y: near.reduce((q, e) => q + e.y, 0) / near.length }; }
      return best;
    });
    if (r && (!best || r.sc > best.sc)) best = r;
    if (best && best.a >= 4 && best.c >= 4) break;
    await B(page, (b) => b.frames(15, 1 / 30));
  }
  if (!best) { const f = await B(page, (b) => b.fight()); best = { ...f, a: 0, c: 0 }; }
  // pull fighters in to make a full 5v5 when the bots are spread (scripted move, as the clutter gate allows)
  if (best.a < 4 || best.c < 4) {
    await B(page, (b, p) => { const v = b.host.view; for (const e of v.entities) if (e.kind === 'fighter' && e.alive) { const k = e.team === 0 ? -1 : 1; e.x = p.x + k * (2 + Math.random() * 3); e.y = p.y + (Math.random() - 0.5) * 8; e.vx = 0; e.vy = 0; } v.hashDirty = true; b.frames(45, 1 / 30); }, best);
    best.scripted = true;
  }
  await B(page, (b, p) => { b.focus(p.x, p.y); b.frames(2, 1 / 30); b.focus(p.x, p.y); }, best);
  await view(); await settle(); await grab('fight5v5', { best });
  await B(page, (b, p) => { b.frames(12, 1 / 30); b.focus(p.x, p.y); }, best); await view(); await grab('fight5v5_b');
  // an ultimate: the fighter nearest the centre with a ranked ult, cast at its nearest enemy (bot driver removed for that seat)
  const ab = 'abilities.ts';
  const cast = await page.evaluate(async (p) => {
    const b = window.__VALE_BENCH__, w = b.host.view, A = await import('/src/sim/' + p.ab);
    const fs = w.entities.filter((e) => e.kind === 'fighter' && e.alive).sort((a, c) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(c.x - p.x, c.y - p.y));
    const tried = [];
    for (const e of fs) {
      const s = e.slots[3]; if (!s) continue;
      if (s.rank <= 0) { e.level = Math.max(e.level, 6); A.levelUpAbility(w, e, 'ult'); }
      s.cooldown = 0; s.recastLock = 0; e.res = e.maxRes;
      const foe = fs.filter((q) => q.team !== e.team).sort((a, c) => Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(c.x - e.x, c.y - e.y))[0];
      if (!foe) continue;
      for (const [pl, d] of b.host.drivers ?? []) { const pe = w.players?.[pl]; if (pe && pe.entity === e.id) b.host.drivers.delete(pl); }
      const r = A.tryCast(w, e, 3, foe.x, foe.y, foe.id); tried.push(`${e.def}:${r}`);
      if (r === 'ok' || r === 'moving') return { def: e.def, foe: foe.def, r, x: (e.x + foe.x) / 2, y: (e.y + foe.y) / 2, tried };
    }
    return { tried };
  }, { ...best, ab });
  console.log('ult', JSON.stringify(cast));
  let el = 0;
  for (const at of [0.2, 0.45, 0.8, 1.6]) {
    const n = Math.max(1, Math.round((at - el) * 30)); el = at;
    await B(page, (b, p) => { b.frames(p.n, 1 / 30); if (p.x !== undefined) b.focus(p.x, p.y); for (let i = 0; i < 2; i++) b.renderer.render(0); }, { n, x: cast.x ?? best.x, y: cast.y ?? best.y });
    await view(); await grab(`ult_${String(Math.round(at * 100)).padStart(3, '0')}`, { cast });
  }
  // a kill: the enemy fighter nearest the centre takes lethal true damage from the nearest opposing fighter
  const kill = await page.evaluate(async (p) => {
    const b = window.__VALE_BENCH__, c = await import('/src/sim/combat.ts'), w = b.host.view;
    const fs = w.entities.filter((e) => e.kind === 'fighter' && e.alive).sort((a, q) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(q.x - p.x, q.y - p.y));
    const me0 = w.players.find((q) => q.player === 0)?.entity; const v = fs.find((e) => e.id !== me0); const k = fs.find((e) => e.team !== v.team);
    if (!v || !k) return null;
    const out = { victim: v.def, killer: k.def, x: v.x, y: v.y };
    for (let i = 0; i < 12 && v.alive; i++) { const sh = (v.shields ?? []).reduce((a, x) => a + x.amount, 0); c.dealDamage(w, k, v, (v.hp + sh + 10) * 4, 'true'); }
    out.dead = !v.alive; return out;
  }, best);
  console.log('kill', JSON.stringify(kill));
  el = 0;
  for (const at of [0.05, 0.3, 0.7, 1.4]) {
    const n = Math.max(1, Math.round((at - el) * 30)); el = at;
    await B(page, (b, p) => { b.frames(p.n, 1 / 30); b.focus(p.x, p.y); for (let i = 0; i < 2; i++) b.renderer.render(0); }, { n, x: kill?.x ?? best.x, y: kill?.y ?? best.y });
    await view(); await grab(`kill_${String(Math.round(at * 100)).padStart(3, '0')}`, { kill });
  }
  if (s.logs.length) log.push({ mode, consoleErrors: s.logs.slice(0, 8) });
  await s.browser.close();
}
writeFileSync(join(OUT, 'frames.json'), JSON.stringify(log, null, 1));
