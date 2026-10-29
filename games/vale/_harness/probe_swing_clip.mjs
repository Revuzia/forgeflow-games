// VALE harness — a basic attack's swing VFX follows the clip the swing plays (W5b burdam-hesmi handoff, engine-12).
// The real renderer (render bench, real Chrome GPU, heavy slot), a match host of its own (seat 0 the fighter under test,
// seat 5 an enemy dummy 1.4 m in front of her, refilled every frame; waves and bots off), content/vfx.json on disk in
// place of the catalog's VFX defs. The fighter auto-attacks for --s seconds; for every swing it records:
//   anim    the sim's clip role for that swing (EntityView.anim on the attack's tick: attack1 / attack2 / crit)
//   clip    the clip the director passed the VFX (SpawnOpts.clip: the role through the model's fallback chain)
//   fired   the windupVfx layers that fired (render/vfx/defs.ts `clip`), and each ribbon's arc (a0 -> a1 deg, tilt)
//   glint   the impact glint's world position against both fists (prop.R = weapon_r, prop.L = weapon_l) on its frame
// Gate (default fighter hesmi): every attack2 swing sweeps the mirrored arc (a0 < 0 < a1) and glints within 5 cm of
// the LEFT fist; every attack1 swing the authored arc (a0 > 0 > a1), within 5 cm of the RIGHT fist; never both sets.
// Shots of the first impact frame of each clip: _harness/_shots/<tag>_swing_<fighter>_<clip>.png
//
//   node _harness/probe_swing_clip.mjs [--fighter hesmi] [--s 8] [--tag integ_engine]
//   → _harness/_reports/<tag>_swing_clip_<fighter>.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const FIGHTER = opt('fighter', 'hesmi'), SECS = +opt('s', 8), TAG = opt('tag', 'integ_engine');
const REPS = join(HERE, '_reports'); mkdirSync(REPS, { recursive: true });
const strip = (v) => (Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, strip(x)])) : v);
const defs = strip(JSON.parse(readFileSync(join(HERE, '../content/vfx.json'), 'utf8')));
const report = { at: new Date().toISOString(), fighter: FIGHTER, swings: [], pass: true, fails: [] };
const fail = (m) => { report.pass = false; report.fails.push(m); console.log('FAIL', m); };

const { browser, page, logs } = await open('/_harness/web/render_bench.html?mode=rift&q=high&t=0&dev=1&hud=0&manual=1', { wait: false, hmr: false });
const B = (fn, a) => page.evaluate(([src, x]) => (0, eval)(`(${src})`)(window.__VALE_BENCH__, x), [fn.toString(), a]);
try {
  await page.waitForFunction(() => window.__VALE_BENCH__?.ready === true || window.__VALE_BENCH__?.error, null, { timeout: 300000 });
  await B(async (b, d) => { const { VfxDef } = await import('/src/contracts/catalog.ts'); b.renderer.vfx.redefine(d.map((x) => VfxDef.parse(x))); }, defs);
  const info = await B(async (b, fighter) => {
    const { LocalMatchHost } = await import('/src/session/match_host.ts');
    const cat = b.catalog, base = b.host.setup, R = b.renderer;
    const f = cat.fighters.find((x) => x.id === fighter);
    const swingId = f.attack.present?.windupVfx;
    const foe = cat.fighters.find((x) => x.id !== fighter && x.id === 'marund')?.id ?? cat.fighters.find((x) => x.id !== fighter).id;
    const setup = { ...base, matchId: `swing-${fighter}`, seats: base.seats.map((s, i) => {
      const fid = i === 0 ? fighter : i === 5 ? foe : s.fighter === fighter ? (cat.fighters.find((x) => x.id !== fighter && !base.seats.some((q) => q.fighter === x.id))?.id ?? s.fighter) : s.fighter;
      const skin = cat.skins.find((k) => k.fighter === fid && k.tier === 'base')?.id ?? cat.skins.find((k) => k.fighter === fid)?.id ?? '';
      return { ...s, fighter: fid, skin };
    }) };
    const h = new LocalMatchHost(cat, setup, 0, { autopilot: false, maxTimeScale: 16, pregameSeconds: 0 });
    h.start();
    await R.preload(setup);
    R.setScene(h);
    const W = h.sim.world;
    b.__H = h; b.__W = W;
    for (let i = 0; i < W.systems.length; i++) W.systems[i] = W.systems[i].filter((fn) => fn.name !== 'waveSystem' && fn.name !== 'minionSystem');
    b.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) { h.pump(dt); R.render(dt); } };
    const me = W.players[0].entity, dummy = W.players[5].entity;
    const place = () => {
      const a = W.entity(me), d = W.entity(dummy);
      a.x = 74; a.y = 55; a.vx = a.vy = 0; a.facing = 0;
      d.x = 75.4; d.y = 55; d.vx = d.vy = 0; d.facing = Math.PI; d.autoAttack = false;
    };
    place();
    // what the director hands the VFX, and where the glint lands
    b.__swings = [];
    const spawn0 = R.vfx.spawnHandle.bind(R.vfx);
    R.vfx.spawnHandle = (id, o) => {
      const hh = spawn0(id, o);
      if (id === swingId && o?.sourceId === me) {
        const v = h.view.entity(me);
        b.__swings.push({ h: hh, clip: o.clip ?? null, anim: v?.anim ?? null, t: h.view.time, glint: null });
      }
      return hh;
    };
    const anchor0 = R.vfx.anchorPos.bind(R.vfx);
    const S = R.vfx.world;
    R.vfx.anchorPos = (it, l, out) => {
      const r = anchor0(it, l, out);
      // the glint: a sprite layer, parsed into a one-particle emitter (defs.ts) on a hand / weapon socket
      if (it.def.id === swingId && l.type === 'emitter' && l.count === 1 && l.socket && l.socket !== 'base') {
        const sw = b.__swings.find((s) => s.h === it.uid);
        if (sw && !sw.glint) {
          const P = r.clone(), L = r.clone(), Rr = r.clone();
          S.socketPos(me, 'weapon_l', L); S.socketPos(me, 'weapon_r', Rr);
          sw.glint = { socket: l.socket, at: [P.x, P.y, P.z].map((x) => +x.toFixed(3)), dL: +P.distanceTo(L).toFixed(3), dR: +P.distanceTo(Rr).toFixed(3), fists: +L.distanceTo(Rr).toFixed(3) };
          // the layers that fired by the impact (the ribbons at 0.78, this glint at 0.97 of the swing)
          sw.layers = it.def.layers.map((q, i) => ({ i, type: q.type, clip: q.clip, socket: q.socket, fired: !!it.fired[i],
            arc: q.arc ? [+(q.arc.a0 * 180 / Math.PI).toFixed(1), +(q.arc.a1 * 180 / Math.PI).toFixed(1), +(q.arc.tilt * 180 / Math.PI).toFixed(1)] : undefined }));
          b.__glintNow = sw.glint.fists > 0.3 ? sw.clip : null;   // a shot once the model (and its fists) has landed
        }
      }
      return r;
    };
    b.__fired = () => b.__swings;
    b.__keep = () => { const a = W.entity(me), d = W.entity(dummy); d.hp = d.maxHp; d.x = 75.4; d.y = 55; a.res = a.maxRes; };
    b.focus(74.7, 55); b.zoom(cat.maps.find((x) => x.id === setup.map).camera.distance * 0.6);
    b.__step(20);
    h.sim.command(0, { type: 'attack', target: dummy });
    return { me, dummy, foe, swingId, sockets: f.art.sockets ?? {}, clips: Object.keys(f.art.clips ?? {}) };
  }, FIGHTER);
  report.info = info;
  console.log(`${FIGHTER} vs ${info.foe}: ${info.swingId}; clips ${info.clips.filter((c) => /attack|crit/.test(c)).join(', ')}; weapon_l ${info.sockets.weapon_l ?? '-'}, weapon_r ${info.sockets.weapon_r ?? '-'}`);
  await page.waitForTimeout(6000);                                      // the fighters' models land
  const shotFor = new Set();
  for (let f = 0; f < SECS * 30; f++) {
    // step frames one at a time; while the dummy is a fresh target the fighter keeps swinging
    const g = await B((b) => {
      b.__keep(); b.__glintNow = null; b.__step(1);
      const W = b.__W, a = W.entity(b.__W.players[0].entity);
      if (!a.atkTarget || a.atkTarget < 0) b.__H.sim.command(0, { type: 'attack', target: b.__W.players[5].entity });
      return b.__glintNow;
    });
    if (g && !shotFor.has(g)) { shotFor.add(g); await shot(page, `${TAG}_swing_${FIGHTER}_${g}`); }
  }
  await B((b) => b.__step(20));
  report.swings = await B((b) => b.__fired().map((s) => ({ ...s, layers: s.layers })));
  for (const [k, s] of report.swings.entries()) {
    const fired = (s.layers ?? []).filter((l) => l.fired);
    const arcs = fired.filter((l) => l.arc).map((l) => l.arc);
    const setA = fired.some((l) => l.clip && l.clip.includes('attack1')), setB = fired.some((l) => l.clip && l.clip.includes('attack2'));
    console.log(`swing ${k} t ${s.t.toFixed(2)} anim ${s.anim} clip ${s.clip}  arcs ${arcs.map((a) => `${a[0]}->${a[1]} tilt ${a[2]}`).join(' / ')}  glint ${s.glint ? `${s.glint.socket} dL ${s.glint.dL} dR ${s.glint.dR} (fists ${s.glint.fists} apart)` : '-'}`);
    if (setA && setB) fail(`swing ${k}: both clip sets fired`);
    if (!s.glint) { fail(`swing ${k}: no glint recorded`); continue; }
    if (s.clip === 'attack2') {
      if (!arcs.length || arcs.some((a) => !(a[0] < 0 && a[1] > 0))) fail(`swing ${k} (attack2): arc not mirrored ${JSON.stringify(arcs)}`);
      if (!(s.glint.dL <= 0.05)) fail(`swing ${k} (attack2): glint ${s.glint.dL} m from the left fist`);
    } else if (s.clip === 'attack1') {
      if (!arcs.length || arcs.some((a) => !(a[0] > 0 && a[1] < 0))) fail(`swing ${k} (attack1): arc ${JSON.stringify(arcs)}`);
      if (!(s.glint.dR <= 0.05)) fail(`swing ${k} (attack1): glint ${s.glint.dR} m from the right fist`);
    }
    if (s.anim && s.clip && s.anim !== s.clip && !(s.anim === 'crit')) fail(`swing ${k}: the sim played ${s.anim}, the VFX got ${s.clip}`);
  }
  const by = (c) => report.swings.filter((s) => s.clip === c).length;
  report.counts = { attack1: by('attack1'), attack2: by('attack2'), crit: by('crit') };
  if (!report.counts.attack1 || !report.counts.attack2) fail(`swings per clip ${JSON.stringify(report.counts)}: both clips must be seen`);
} catch (e) {
  fail(String(e?.stack ?? e));
} finally {
  report.logs = logs.slice(0, 10);
  const out = join(REPS, `${TAG}_swing_clip_${FIGHTER}.json`);
  writeFileSync(out, JSON.stringify(report, null, 1));
  console.log(`swings ${JSON.stringify(report.counts ?? {})}; console ${logs.length} warning(s)/error(s)`);
  console.log(`swing_clip: ${report.pass ? 'PASS' : `FAIL (${report.fails.length})`} → ${out}`);
  await browser.close();
}
process.exit(report.pass ? 0 : 1);
