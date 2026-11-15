// probe (lane INPUT/RENDER): a click on a unit's visible body picks that unit (ruling 38 "picking resolves occlusion before
// forgiveness"; ruling 39 closes the last edge class). The real src/render/pick.ts (slop 14 px) against an independent
// truth: the first ray hit on upright body cylinders (half the collision radius, ground to art height). Every fighter
// with every Wick touching it at 16 bearings (25 click samples on each visible body), and 5-8 touching Wick clumps (the
// visible part of each), at 11 screen positions, 1920 x 1080 and 1280 x 720, min / default / max zoom. Clear cases only
// (the two ray hits >= 0.08 m apart). Gate: 0 wrong (orch1 verifier: 216 / 3.2 M pairs and 15 / 217 k clump clicks went
// to the body behind at silhouette edges toward the screen corners, from a box 4 px over the head).
import { PerspectiveCamera, Vector3 } from 'three';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { check, finish } from './fixtures/sim_fixture.ts';

const built = buildContent(defaultOptions({ check: true, allowMissingAssets: true, quiet: true }));
if (!built.catalog) { console.log('SKIP content build failed'); process.exit(77); }
const rc = built.catalog;
const lcg = (seed: number) => { let s = seed; return (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

async function pick(): Promise<{ pairs: { total: number; wrong: number; bad: string[] }; clumps: { total: number; wrong: number; bad: string[] } }> {
  (globalThis as { document?: unknown }).document ??= { elementFromPoint: () => null };
  const { pickUnit } = await import('../src/render/pick.ts');
  const { CAMERA } = await import('../src/render/camera.ts');
  const fighters = rc.fighters.map((f) => ({ id: f.id, H: (f as { art: { height: number; scale: number } }).art.height * (f as { art: { scale: number } }).art.scale, r: (f as { collisionRadius: number }).collisionRadius }));
  const mins = (rc as unknown as { units: { id: string; kind: string; collisionRadius: number; art: { height: number; scale: number } }[] }).units.filter((u) => u.kind === 'minion' && u.id !== 'sparring_post').map((u) => ({ id: u.id, H: u.art.height * u.art.scale, r: u.collisionRadius }));
  const view = (id: number, kind: string, x: number, y: number, radius: number) => ({ id, kind, team: 1, x, y, radius, alive: true, targetable: true, visibleMask: 3, statuses: [], vx: 0, vy: 0 }) as never;
  // body cylinder for the truth: half the collision radius (the rule's "drawn body"), heights 0..H
  const rayHit = (o: Vector3, d: Vector3, x: number, y: number, rr: number, H: number): number => {
    // vertical cylinder axis (x, *, y) radius rr, y in [0,H]; returns t or Infinity
    const ox = o.x - x, oz = o.z - y, a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - rr * rr;
    const disc = b * b - 4 * a * c; if (disc < 0) return Infinity;
    const s = Math.sqrt(disc);
    for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) { if (t <= 0) continue; const hy = o.y + d.y * t; if (hy >= 0 && hy <= H) return t; }
    // top cap
    const tc = (H - o.y) / d.y; if (tc > 0) { const px = o.x + d.x * tc - x, pz = o.z + d.z * tc - y; if (px * px + pz * pz <= rr * rr) return tc; }
    return Infinity;
  };
  let total = 0, wrong = 0, wrongF = 0, wrongM = 0, totF = 0, totM = 0, clumpTot = 0, clumpWrong = 0;
  const bad: string[] = [], clumpBad: string[] = [];
  const rnd = lcg(4711);
  for (const [w, h] of [[1920, 1080], [1280, 720]]) for (const dist of [CAMERA.minDistance, CAMERA.distance, CAMERA.maxDistance]) {
    const cm = new PerspectiveCamera(CAMERA.fovDeg, w / h, 1, 400);
    const p = (CAMERA.pitchDeg * Math.PI) / 180;
    cm.position.set(50, Math.sin(p) * dist, 50 + Math.cos(p) * dist); cm.rotation.set(-p, 0, 0); cm.updateMatrixWorld(true); cm.updateProjectionMatrix();
    const ray = (sx: number, sy: number) => new Vector3((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(cm).sub(cm.position).normalize();
    const scr = (x: number, y: number, hh: number) => { const v = new Vector3(x, hh, y).project(cm); return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h }; };
    for (const [u, vv] of [[0.5, 0.5], [0.08, 0.5], [0.92, 0.5], [0.5, 0.12], [0.5, 0.9], [0.1, 0.12], [0.9, 0.12], [0.1, 0.9], [0.9, 0.9], [0.3, 0.3], [0.7, 0.7]]) {
      const dir = new Vector3(u * 2 - 1, -(vv * 2 - 1), 0.5).unproject(cm).sub(cm.position).normalize();
      const t0 = -cm.position.y / dir.y, gx = cm.position.x + dir.x * t0, gy = cm.position.z + dir.z * t0;
      // pairs: a fighter and a minion touching it at every bearing (behind, beside, in front)
      for (const f of fighters) for (const m of mins) for (let ang = -180; ang < 180; ang += 22.5) {
        const a = (ang * Math.PI) / 180, D = f.r + m.r, mx = gx + Math.sin(a) * D, my = gy - Math.cos(a) * D;
        const units = [
          { id: 1, x: gx, y: gy, h: 0, artHeight: f.H, view: view(1, 'fighter', gx, gy, f.r) },
          { id: 2, x: mx, y: my, h: 0, artHeight: m.H, view: view(2, 'minion', mx, my, m.r) },
        ];
        // click samples on each body's cylinder surface facing the camera (inside by 15 %)
        for (const [tid, ux, uy, uH, ur] of [[1, gx, gy, f.H, f.r], [2, mx, my, m.H, m.r]] as const) {
          for (const hf of [0.15, 0.4, 0.65, 0.85, 0.95]) for (const lat of [-0.7, -0.35, 0, 0.35, 0.7]) {
            const c = scr(ux + lat * ur * 0.5, uy + ur * 0.5 * 0.0, uH * hf);
            if (c.x < 0 || c.x > w || c.y < 0 || c.y > h) continue;
            const d = ray(c.x, c.y);
            const tf = rayHit(cm.position, d, gx, gy, f.r * 0.5, f.H), tm = rayHit(cm.position, d, mx, my, m.r * 0.5, m.H);
            if (!isFinite(tf) && !isFinite(tm)) continue;
            const truth = tf <= tm ? 1 : 2;
            // only clear cases: the ray hits the truth well before the other (or misses the other)
            if (Math.abs(tf - tm) < 0.08) continue;
            if (truth !== tid) continue;   // sample belongs to the visible body
            total++; if (truth === 1) totF++; else totM++;
            const got = pickUnit(cm, w, h, units as never, c.x, c.y, { slop: 14 });
            if (got !== truth) { wrong++; if (truth === 1) wrongF++; else wrongM++; if (bad.length < 12) bad.push(`${w}x${h} d${dist} (${u},${vv}) ${f.id}+${m.id} ${ang}° click on ${truth === 1 ? 'fighter' : 'minion'} h${hf} lat${lat} got ${got}`); }
          }
        }
      }
      // minion clumps: 5-8 touching minions, click the visible part of each (owner: "hard to target specific minions")
      for (let rep = 0; rep < 60; rep++) {
        const units: { id: number; x: number; y: number; h: number; artHeight: number; view: never; r: number }[] = [];
        let tries = 0;
        const cnt = 5 + Math.floor(rnd() * 4);
        while (units.length < cnt && tries++ < 400) {
          const m = mins[Math.floor(rnd() * mins.length)];
          const x = gx + (rnd() - 0.5) * 3.5, y = gy + (rnd() - 0.5) * 3.5;
          if (units.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + m.r - 0.05)) continue;
          units.push({ id: 10 + units.length, x, y, h: 0, artHeight: m.H, view: view(10 + units.length, 'minion', x, y, m.r), r: m.r });
        }
        for (const tgt of units) for (const hf of [0.3, 0.6, 0.85]) for (const lat of [-0.5, 0, 0.5]) {
          const c = scr(tgt.x + lat * tgt.r * 0.5, tgt.y, tgt.artHeight * hf);
          if (c.x < 0 || c.x > w || c.y < 0 || c.y > h) continue;
          const d = ray(c.x, c.y);
          let bestT = Infinity, bestId = -1, second = Infinity;
          for (const o of units) { const t = rayHit(cm.position, d, o.x, o.y, o.r * 0.5, o.artHeight); if (t < bestT) { second = bestT; bestT = t; bestId = o.id; } else if (t < second) second = t; }
          if (bestId !== tgt.id || second - bestT < 0.08) continue;
          clumpTot++;
          const got = pickUnit(cm, w, h, units as never, c.x, c.y, { slop: 14 });
          if (got !== tgt.id) { clumpWrong++; if (clumpBad.length < 10) clumpBad.push(`${w}x${h} d${dist} (${u},${vv}) clump ${units.length} click visible ${tgt.id} h${hf} lat${lat} got ${got}`); }
        }
      }
    }
  }
  const o = { pairs: { total, wrong, fighterClicks: totF, fighterWrong: wrongF, minionClicks: totM, minionWrong: wrongM, bad }, clumps: { total: clumpTot, wrong: clumpWrong, bad: clumpBad } };
  console.log(JSON.stringify(o));
  return o;
}


const r = await pick();
check(`${r.pairs.total} clicks on a fighter or a Wick touching it: 0 pick the other body (${r.pairs.wrong})`, r.pairs.total > 100000 && r.pairs.wrong === 0, r.pairs.bad.slice(0, 6));
check(`${r.clumps.total} clicks on the visible part of a Wick in a clump: 0 pick another (${r.clumps.wrong})`, r.clumps.total > 10000 && r.clumps.wrong === 0, r.clumps.bad.slice(0, 6));
finish('probe_input_pick_truth');
