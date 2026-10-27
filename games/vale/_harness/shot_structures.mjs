// VALE harness — r12 M9 structures in the real client at the gameplay camera: screen height against a fighter,
// the occlusion fade, both damage thresholds, the collapse and the ruin, the protected shell.
//   node _harness/shot_structures.mjs [rift|bridge|fray] [--q high] [--name structures] [--states all|scale,occlusion,damage,collapse,shell,respawn]
// Damage comes from a harness hook only: the bench's own sim takes the real dealDamage (src/sim/combat.ts) or an hp
// write on the entity; no sim code changes. Writes _harness/_shots/<name>_<state>.png and
// _harness/_reports/structures_<map>.json (px heights, ratios, fade/shell/stage states over time).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) ?? 'rift';
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const name = opt('name', 'structures');
const states = new Set((opt('states', 'all') === 'all' ? 'scale,occlusion,damage,collapse,shell,respawn' : opt('states', '')).split(','));
const tag = mode === 'rift' ? '' : `_${mode}`;
const { browser, page, logs } = await open(`/_harness/web/render_bench.html?mode=${mode}&q=${opt('q', 'high')}&t=${opt('t', 12)}&dev=1&hud=0&manual=1`, { wait: false, hmr: false });
await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 180000 });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
const err = await B((b) => b.error ?? null);
if (err) { console.error(err); process.exit(1); }
await B((b) => b.frames(30, 1 / 30));
await new Promise((r) => setTimeout(r, 4000));                       // async models land in real time
await B((b) => b.frames(10, 1 / 30));

// in-page helpers: screen boxes of actors, a still frame (render without pumping the sim), teleports, damage
await B((b) => {
  const R = b.renderer;
  const THREE_V = (x, y, z) => ({ x, y, z });
  b.$ = {
    still: (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) R.render(dt); },
    actor: (id) => R.actors.get(id),
    /** screen box (CSS px) of an actor's visible meshes, from every (skinned) vertex: the silhouette's extent */
    box: (id) => {
      const a = R.actors.get(id);
      if (!a || !a.model) return null;
      const cam = R.rig.camera;
      cam.updateMatrixWorld();
      a.root.updateMatrixWorld(true);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const v = new cam.position.constructor();
      a.model.traverseVisible((o) => {
        if (!o.isMesh || o.userData.valeOutline) return;
        const n = o.geometry.getAttribute('position').count;
        for (let i = 0; i < n; i++) {
          o.getVertexPosition(i, v);
          v.applyMatrix4(o.matrixWorld).project(cam);
          const sx = (v.x * 0.5 + 0.5) * R.cssW, sy = (-v.y * 0.5 + 0.5) * R.cssH;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
      });
      return { w: Math.round(x1 - x0), h: Math.round(y1 - y0), x0: Math.round(x0), y0: Math.round(y0) };
    },
    /** standing height in CSS px: the vertical from the ground under the unit to `h` m above it, at its own spot */
    stand: (id, h) => {
      const a = R.actors.get(id);
      if (!a) return null;
      const g = R.worldToScreen(a.x, a.y, a.h), t = R.worldToScreen(a.x, a.y, a.h + h);
      return Math.round(Math.hypot(g.x - t.x, g.y - t.y));
    },
    /** the actor's real top (m above its ground) from every visible (skinned) vertex */
    top: (id) => {
      const a = R.actors.get(id);
      if (!a || !a.model) return 0;
      a.root.updateMatrixWorld(true);
      let y = 0;
      const v = new R.rig.camera.position.constructor();
      a.model.traverseVisible((o) => {
        if (!o.isMesh || o.userData.valeOutline) return;
        const n = o.geometry.getAttribute('position').count;
        for (let i = 0; i < n; i++) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); y = Math.max(y, v.y - a.h); }
      });
      return y;
    },
    ent: (id) => b.host.view.entities.find((e) => e.id === id),
    place: (id, x, y) => { const e = b.$.ent(id); e.x = x; e.y = y; e.order = 0; e.vx = 0; e.vy = 0; b.host.view.hashDirty = true; },
    /** put a unit there, let vision rebuild around it (a few ticks), put it back exactly */
    settle: (id, x, y) => { b.$.place(id, x, y); for (let i = 0; i < 7; i++) { b.host.pump(1 / 30); b.$.place(id, x, y); } b.host.pump(1 / 30); },
    info: () => R.structs.info(),
    structs: () => b.host.view.entities.filter((e) => e.kind === 'structure').map((e) => ({ id: e.id, def: e.def, team: e.team, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, alive: e.alive, targetable: e.targetable })),
  };
  void THREE_V;
});

const report = { map: mode, structures: [], occlusion: {}, damage: [], collapse: [], shell: {}, respawn: null };
const S = await B((b) => b.$.structs());
const you = await B((b) => b.you());
// the camera looks toward −y (sim): "behind" a structure is smaller y
const focusOn = (x, y) => B((b, p) => { b.focus(p[0], p[1]); b.zoom(28.5); b.$.still(45); }, [x, y]);

if (states.has('scale') && S.length) {
  // every structure kind of both sides, your fighter standing beside it (same depth), at the gameplay camera
  const kinds = [...new Set(S.map((s) => `${s.def}:${s.team}`))];
  for (const k of kinds) {
    const s = S.find((x) => `${x.def}:${x.team}` === k);
    await B((b, p) => { b.$.settle(p.you, p.x + p.r, p.y + 0.3); }, { you: you.id, x: s.x, y: s.y, r: s.def === 'hourbell' ? 4.2 : s.def === 'lantern' ? 3.4 : 2.6 });
    await focusOn(s.x + 1.2, s.y);
    const m = await B((b, p) => {
      const fdef = b.host.view.entities.find((e) => e.id === p.f).def;
      const fh = b.catalog.fighters.find((f) => f.id === fdef).art.height;
      const hs = b.catalog.fighters.map((f) => f.art.height).sort((x, y) => x - y);
      const med = (hs[(hs.length - 1) >> 1] + hs[hs.length >> 1]) / 2;
      const top = b.$.top(p.s);
      return { s: b.$.box(p.s), f: b.$.box(p.f), fdef, fh, med, top: +top.toFixed(2), sStand: b.$.stand(p.s, top), fStand: b.$.stand(p.f, fh), medStand: b.$.stand(p.s, med) };
    }, { s: s.id, f: you.id });
    if (m.s && m.f) {
      report.structures.push({
        def: s.def, team: s.team, culture: s.team ? 'serenade' : 'aubade', topM: m.top, standPx: m.sStand, boxPx: m.s,
        fighter: m.fdef, fighterM: m.fh, fighterStandPx: m.fStand, fighterBoxPx: m.f, medianFighterM: m.med, medianFighterStandPx: m.medStand,
        ratioStand: +(m.sStand / m.fStand).toFixed(2), ratioStandMedian: +(m.sStand / m.medStand).toFixed(2), ratioBox: +(m.s.h / m.f.h).toFixed(2),
      });
    }
    if (s.def === 'needle_outer' || s.def === 'hourbell') await shot(page, `${name}${tag}_scale_${s.def}_${s.team ? 'serenade' : 'aubade'}`);
  }
}

const outer = S.find((s) => s.def === 'needle_outer' && s.team === 1) ?? S.find((s) => s.def === 'needle_outer');
// an outer needle with open, walkable lane right behind it (no thicket, no wall): the occlusion case
const occ = await B((b, list) => {
  const w = b.host.view;
  for (const s of list) {
    if (s.def !== 'needle_outer') continue;
    for (const d of [2.4, 2.8, 2.0]) for (const ox of [0, 0.5, -0.5]) {
      const x = s.x + ox, y = s.y - d;
      if (!w.nav.walkable(x, y)) continue;
      if (w.mapDef.thickets.some((poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, yi] = poly[i], [xj, yj] = poly[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; })) continue;
      return { ...s, bx: x, by: y };
    }
  }
  return null;
}, S);
if (states.has('occlusion') && occ) {
  // your fighter right behind the tower from the camera, then beside it
  const outer = occ;
  report.occlusion.structure = { id: occ.id, def: occ.def, team: occ.team, behind: [occ.bx, occ.by] };
  await B((b, p) => { b.$.settle(p.you, p.bx, p.by); }, { you: you.id, ...occ });
  await focusOn(outer.x, outer.y);
  await B((b) => b.$.still(12));
  const on = await B((b, id) => b.$.info().find((s) => s.id === id), outer.id);
  await shot(page, `${name}${tag}_occlusion_on`);
  await B((b, p) => { b.$.settle(p.you, p.x + 3.6, p.y + 1.0); b.$.still(20); }, { you: you.id, x: outer.x, y: outer.y });
  const off = await B((b, id) => b.$.info().find((s) => s.id === id), outer.id);
  await shot(page, `${name}${tag}_occlusion_beside`);
  report.occlusion.behindState = on; report.occlusion.besideState = off;
}

if (states.has('shell')) {
  const prot = S.find((s) => !s.targetable && s.def === 'needle_inner') ?? S.find((s) => !s.targetable);
  if (prot) {
    await B((b, p) => { b.$.settle(p.you, p.x + 3.5, p.y + 1.5); }, { you: you.id, x: prot.x, y: prot.y });
    await focusOn(prot.x, prot.y);
    report.shell.protected = await B((b, id) => b.$.info().find((s) => s.id === id), prot.id);
    await shot(page, `${name}${tag}_shell`);
  }
}

if (states.has('damage') && outer) {
  await B((b, p) => { b.$.settle(p.you, p.x + 3.6, p.y + 1.6); }, { you: you.id, x: outer.x, y: outer.y });
  await focusOn(outer.x, outer.y);
  for (const [f, label] of [[0.6, 'damage66'], [0.3, 'damage33']]) {
    await B((b, p) => { const e = b.$.ent(p.id); e.hp = e.maxHp * p.f; b.$.still(1); }, { id: outer.id, f });
    await B((b) => b.$.still(8));
    await shot(page, `${name}${tag}_${label}_fx`);
    await B((b) => b.$.still(40));
    report.damage.push({ hp: f, ...(await B((b, id) => b.$.info().find((s) => s.id === id), outer.id)) });
    await shot(page, `${name}${tag}_${label}`);
  }
}

if (states.has('collapse') && outer) {
  // the real death path: dealDamage from the bench's sim module (events, protection, nav) — a harness hook only
  await page.evaluate(async (p) => {
    const b = window.__VALE_BENCH__;
    const c = await import('/src/sim/combat.ts');
    const w = b.host.view;
    const e = w.entities.find((x) => x.id === p.id);
    const k = w.entities.find((x) => x.id === p.you);
    c.dealDamage(w, k ?? null, e, e.hp + 10, 'true');
  }, { id: outer.id, you: you.id });
  await B((b) => b.frames(1, 1 / 30));
  let t = 0;
  for (const at of [0.1, 0.35, 0.7, 1.05, 1.4, 1.75, 2.4]) {
    const n = Math.max(1, Math.round((at - t) * 30));
    await B((b, n) => b.frames(n, 1 / 30), n);
    t += n / 30;
    report.collapse.push({ t: +t.toFixed(2), ...(await B((b, id) => b.$.info().find((s) => s.id === id), outer.id)) });
    await shot(page, `${name}${tag}_collapse_${String(Math.round(t * 100)).padStart(3, '0')}`);
  }
  await B((b) => b.frames(60, 1 / 30));
  const ruin = await B((b, id) => ({ info: b.$.info().find((s) => s.id === id), box: b.$.box(id) }), outer.id);
  report.collapse.push({ t: 'ruin', ...ruin });
  await shot(page, `${name}${tag}_ruin`);
  // the shell on the next structure breaks when its protection drops
  const inner = S.find((s) => s.def === 'needle_inner' && s.team === outer.team);
  if (inner) report.shell.afterOuterFell = await B((b, id) => ({ info: b.$.info().find((s) => s.id === id), targetable: b.$.ent(id).targetable }), inner.id);
}

if (states.has('respawn')) {
  // a gate (map entry with `respawn`) falls and comes back as a new entity: its ruin goes and it rises from its plinth
  const lan = S.find((s) => s.def === 'lantern' && s.team === 1);
  const chain = lan ? S.filter((s) => s.team === lan.team && (s.def === 'needle_outer' || s.def === 'needle_inner') && Math.abs(s.y - lan.y) < 8) : [];
  if (lan) {
    for (const s of [...chain, lan]) {
      await page.evaluate(async (p) => {
        const b = window.__VALE_BENCH__;
        const c = await import('/src/sim/combat.ts');
        const w = b.host.view;
        const e = w.entities.find((x) => x.id === p.id);
        if (e && e.alive) c.dealDamage(w, null, e, e.hp + 10, 'true');
      }, { id: s.id });
      await B((b) => b.frames(3, 1 / 30));
    }
    await B((b) => b.frames(90, 1 / 30));
    await B((b, p) => { b.$.settle(p.you, p.x + 3.5, p.y + 2); }, { you: you.id, x: lan.x, y: lan.y });
    await focusOn(lan.x, lan.y);
    report.respawn = { ruin: await B((b, id) => b.$.info().find((s) => s.id === id), lan.id) };
    await shot(page, `${name}${tag}_gate_ruin`);
    const back = await B((b, p) => {
      const t0 = b.host.view.time;
      while (b.host.view.time < t0 + 245 && !b.host.view.entities.some((e) => e.def === 'lantern' && e.team === p.team && e.alive && Math.hypot(e.x - p.x, e.y - p.y) < 0.5)) b.host.pump(0.25);
      const e = b.host.view.entities.find((x) => x.def === 'lantern' && x.team === p.team && x.alive && Math.hypot(x.x - p.x, x.y - p.y) < 0.5);
      return e ? e.id : -1;
    }, lan);
    await B((b, p) => { b.$.settle(p.you, p.x + 3.5, p.y + 2); }, { you: you.id, x: lan.x, y: lan.y });
    await B((b) => b.$.still(3));
    report.respawn.newId = back;
    report.respawn.rising = await B((b, id) => b.$.info().find((s) => s.id === id) ?? null, back);
    await B((b) => b.$.still(10));
    await shot(page, `${name}${tag}_gate_rise`);
    await B((b) => b.$.still(40));
    report.respawn.after = await B((b, id) => b.$.info().find((s) => s.id === id) ?? null, back);
    report.respawn.oldGone = await B((b, id) => !b.$.info().some((s) => s.id === id), lan.id);
    await shot(page, `${name}${tag}_gate_back`);
  }
}

mkdirSync(join(HERE, '_reports'), { recursive: true });
writeFileSync(join(HERE, '_reports', `structures_${mode}.json`), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1).slice(0, 6000));
const bad = logs.filter((l) => /pageerror|\[error\]|\[http 4/.test(l));
if (bad.length) console.log('ERRORS:\n' + bad.slice(0, 20).join('\n'));
await browser.close();
