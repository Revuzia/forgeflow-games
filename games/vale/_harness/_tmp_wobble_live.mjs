// VALE harness (tmp, orch1 wobble diag) — owner 2026-11-15: Wicks on the high lane leave the road near the 2nd tower,
// dipping below it and curving back. LIVE BROWSER lens: real Chrome 1920x1080, the render bench (real renderer, bots on
// every seat, deterministic sim), spectator + fog off. Steps 1/30 s frames from 1:30 to 8:00 and records, every frame,
// every Wick's sim position, its drawn (interpolated) position, order, lane-AI state and body-lane / nav-path state;
// a JPEG every 2 s with the camera cycling over the four high/low lane segments between the outer and inner towers.
//
//   VALE_URL=http://localhost:5277 python3 art/blender/common/heavy.py run -- node _harness/_tmp_wobble_live.mjs <seed> [--from 90] [--to 480] [--shots dir]
//   → <scratch>/wobble_<seed>.ndjson (one line per 2 s block) + shots
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { openBench, B } from './gfx_lib.mjs';

const args = process.argv.slice(2);
const SEED = Number(args[0] ?? 7);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const FROM = Number(opt('from', 90)), TO = Number(opt('to', 480));
const OUTD = opt('out', '/private/tmp/claude-501/-Users-sitskovich-Developer-forgeflow-games/03f17c1d-60ba-4393-8820-fb1c6015dccd/scratchpad/wobble');
const SHOTS = opt('shots', join(OUTD, `shots_${SEED}`));
mkdirSync(SHOTS, { recursive: true });
const OUT = join(OUTD, `wobble_${SEED}.ndjson`);
writeFileSync(OUT, '');

// camera spots: each team's high / low inner tower, 6 m toward its outer tower (game camera at its widest zoom)
const SPOTS = [['high_a', 41, 17.5], ['high_s', 129, 17.5], ['low_a', 41, 92.5], ['low_s', 129, 92.5]];

const { browser, page, logs } = await openBench({ q: 'high', t: FROM, seed: SEED, manual: true });
try {
  await B(page, async (b) => {
    const R = b.renderer; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true;
    const M = await import('/src/sim/units/minions.ts');
    window.__W = { M };
  });
  const meta = await B(page, (b) => {
    const W = b.host.sim.world;
    const st = W.entities.filter((e) => e.kind === 'structure').map((e) => ({ id: e.id, def: e.def ?? e.unit?.id, team: e.team, x: e.x, y: e.y, r: e.radius, navR: e.navBlockR }));
    // screen-down direction in world at the high lane (which world direction moves a point down the screen)
    const s0 = b.screen(47, 16, 0), s1 = b.screen(47, 17, 0), s2 = b.screen(48, 16, 0);
    return { t: b.time(), tick: W.tick, dt: W.dt ?? null, structures: st, screenDy_per_worldY: s1.y - s0.y, screenDy_per_worldX: s2.y - s0.y, minionR: W.entities.find((e) => e.kind === 'minion')?.radius ?? null };
  });
  appendFileSync(OUT, JSON.stringify({ meta, seed: SEED }) + '\n');
  console.log('start', meta.t, 'screen dy/worldY', meta.screenDy_per_worldY);
  let k = 0;
  for (let t = FROM; t < TO; t += 2) {
    const rec = await B(page, (b) => {
      const W = b.host.sim.world, R = b.renderer, M = window.__W.M;
      const fr = [];
      for (let i = 0; i < 60; i++) {
        b.frames(1, 1 / 30);
        const row = [];
        for (const e of W.entities) {
          if (e.kind !== 'minion' || !e.alive) continue;
          const m = M.minionState(e);
          const a = R.actors.get(e.id);
          const rp = a ? a.root.position : null;
          // [id, team, unit, simX, simY, drawX, drawY, order, chasing, flank, wp, laneLen, laneIdx, pathLen, pathIdx, atkTarget, orderTarget, goalX, goalY]
          row.push([e.id, e.team, e.unit?.id ?? e.def, +e.x.toFixed(3), +e.y.toFixed(3), rp ? +rp.x.toFixed(3) : null, rp ? +rp.z.toFixed(3) : null, e.order,
            m ? (m.chasing ? 1 : 0) : -1, m ? (W.tick < m.flankUntil ? 1 : 0) : -1, m ? m.wp : -1, e.lane.length, e.laneIdx, e.path.length, e.pathIdx, e.atkTarget ?? -1, e.orderTarget ?? -1,
            Math.round(e.orderX * 100) / 100, Math.round(e.orderY * 100) / 100]);
        }
        fr.push({ t: +W.time.toFixed(3), tick: W.tick, m: row });
      }
      const alive = W.entities.filter((e) => e.kind === 'structure' && e.alive).map((e) => e.id);
      return { fr, alive };
    });
    const [name, x, y] = SPOTS[k % 4]; k++;
    const shot = await B(page, (b, a) => {
      b.focus(a.x, a.y); b.zoom(36); b.renderer.render(0); b.renderer.render(0);
      const W = b.host.sim.world;
      // screen coords of every Wick (sim pos) for later annotation
      const pts = W.entities.filter((e) => e.kind === 'minion' && e.alive).map((e) => { const s = b.screen(e.x, e.y, 0); return [e.id, +s.x.toFixed(1), +s.y.toFixed(1)]; });
      return { url: document.getElementById('c').toDataURL('image/jpeg', 0.55), pts };
    }, { x, y });
    const file = `s${SEED}_t${String(Math.round(t + 2)).padStart(4, '0')}_${name}.jpg`;
    writeFileSync(join(SHOTS, file), Buffer.from(shot.url.split(',')[1], 'base64'));
    appendFileSync(OUT, JSON.stringify({ t0: t, shot: file, spot: name, pts: shot.pts, alive: rec.alive, fr: rec.fr }) + '\n');
    if (k % 15 === 0) console.log('t', t + 2, 'minions', rec.fr[59].m.length);
  }
} finally {
  if (logs.length) console.log('logs', logs.slice(0, 10));
  await browser.close();
}
