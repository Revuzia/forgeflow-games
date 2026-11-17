// VERIFIER (laneline r1, tmp): live Wick trails in real Chrome (render bench, every seat played, spectator, fog off).
// One run per seed: the match is pumped frame by frame (1/30 s, real renderer) from t0 to t1; every Wick inside the four
// boxes (top road between base and 2nd tower for team 0 and team 1, then the bottom road the same) is recorded each frame
// (sim x,y, marching flag, its column slot, the rendered actor position). At the end the camera parks on each box and an
// annotated frame is written: road centre (yellow), road edges +-3.6 m (dashed), the two towers, every Wick trail (team 0
// cyan / team 1 orange while marching, white while fighting). Prints per box: marching-sample |d| and |d - slot| p50/p95/max.
//   VALE_URL=http://localhost:PORT VFY_OUT=<dir> VFY_TAG=after node _harness/_tmp_vfy_laneline_live.mjs <seed> [t0=90] [t1=480]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [seed, t0 = '90', t1 = '480'] = process.argv.slice(2);
const OUT = process.env.VFY_OUT ?? join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'wobble_after');
const TAG = process.env.VFY_TAG ?? 'after';
mkdirSync(OUT, { recursive: true });
const map = JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', 'map_rift.json'), 'utf8'));
const lanes = Object.fromEntries(map.lanes.map((l) => [l.id, l.path]));
const BOXES = [
  { name: 'top_team0_base_to_2nd', lane: 'road_high', team: 0, cx: 30, cy: 27, towers: ['a_high_lantern', 'a_high_needle_inner'] },
  { name: 'top_team1_base_to_2nd', lane: 'road_high', team: 1, cx: 140, cy: 27, towers: ['s_high_lantern', 's_high_needle_inner'] },
  { name: 'bot_team0_base_to_2nd', lane: 'road_low', team: 0, cx: 30, cy: 83, towers: ['a_low_lantern', 'a_low_needle_inner'] },
  { name: 'bot_team1_base_to_2nd', lane: 'road_low', team: 1, cx: 140, cy: 83, towers: ['s_low_lantern', 's_low_needle_inner'] },
].map((b) => ({ ...b, path: lanes[b.lane], tw: map.structures.filter((s) => b.towers.includes(s.id)).map((s) => ({ id: s.id, at: s.at })) }));

const { browser, page } = await openBench({ q: 'high', t: Number(t0) - 3, seed: Number(seed), manual: true });
try {
  const res = await B(page, async (b, a) => {
    const R = b.renderer, W = b.host.sim.world; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true;
    const M = await import('/src/sim/units/minions.ts');
    b.zoom(36);
    const trails = a.boxes.map(() => new Map());
    const startT = W.time;
    let fr = 0;
    while (W.time < a.t1) {
      // the camera rests on each box in turn for 20 s of match time (the render-sim gap is meaningful on the box in view)
      const bi = Math.floor(W.time / 20) % 4;
      if (fr === 0 || bi !== a.boxes.cur) { a.boxes.cur = bi; b.focus(a.boxes[bi].cx, a.boxes[bi].cy); }
      b.frames(1, 1 / 30); fr++;
      if (W.time < a.t0) continue;
      for (const e of W.entities) {
        if (e.kind !== 'minion' || !e.alive) continue;
        a.boxes.forEach((bx, i) => {
          if (e.team !== bx.team || Math.hypot(e.x - bx.cx, e.y - bx.cy) > 22) return;
          const m = M.minionState(e);
          if (!m || m.path.length < 3) return;
          const march = e.order === 2 && !m.chasing && W.tick >= m.flankUntil && (e.atkTarget ?? -1) === -1;
          const act = R.actors.get(e.id);
          const T = trails[i];
          if (!T.has(e.id)) T.set(e.id, []);
          T.get(e.id).push([+e.x.toFixed(3), +e.y.toFixed(3), march ? 1 : 0, m.slot ?? 0, act ? +act.root.position.x.toFixed(3) : e.x, act ? +act.root.position.z.toFixed(3) : e.y]);
        });
      }
    }
    const shots = [];
    for (let i = 0; i < 4; i++) {
      const bx = a.boxes[i];
      b.focus(bx.cx, bx.cy); R.render(0); R.render(0);
      const gl = R.gl.domElement;
      const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
      const g = c.getContext('2d');
      g.drawImage(gl, 0, 0);
      const S = (x, y) => { const p = b.screen(x, y, 0.05); return [p.x * c.width / innerWidth, p.y * c.height / innerHeight]; };
      const line = (pts, color, w, dash) => { g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash ?? []); g.beginPath(); pts.forEach((p, k) => { const [x, y] = S(p[0], p[1]); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]); };
      const P = bx.path;
      for (const sgn of [-1, 1]) for (let k = 0; k < P.length - 1; k++) {
        const [ax, ay] = P[k], [qx, qy] = P[k + 1], L = Math.hypot(qx - ax, qy - ay), nx = -(qy - ay) / L * 3.6 * sgn, ny = (qx - ax) / L * 3.6 * sgn;
        line([[ax + nx, ay + ny], [qx + nx, qy + ny]], 'rgba(255,255,255,0.45)', 1.5, [6, 6]);
      }
      const col = bx.team === 0 ? '#28e0ff' : '#ff9a28';
      for (const [, T] of trails[i]) for (let k = 1; k < T.length; k++) {
        const [x0, y0] = S(T[k - 1][0], T[k - 1][1]), [x1, y1] = S(T[k][0], T[k][1]);
        g.strokeStyle = T[k][2] ? col : 'rgba(255,255,255,0.8)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
      line(P, '#ffd400', 2.5);
      g.font = 'bold 22px sans-serif';
      for (const t of bx.tw) { const [x, y] = S(t.at[0], t.at[1]); g.strokeStyle = '#ff3b3b'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 18, 0, 7); g.stroke(); g.fillStyle = '#ff3b3b'; g.fillText(t.id, x + 22, y + 6); }
      g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, c.width, 120);
      g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif';
      const mm = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      g.fillText(`${a.tag.toUpperCase()}  ${bx.name}  seed ${a.seed}  ${bx.lane} team ${bx.team}  match ${mm(Math.max(a.t0, startT))}-${mm(W.time)}`, 20, 38);
      g.font = '22px sans-serif';
      g.fillText('yellow: road centre (lane polyline; drawn road +-3.6 m dashed)   coloured: Wick sim trails while marching   white: fighting', 20, 72);
      g.fillText('red rings: lantern and 2nd tower (inner needle) of this road', 20, 104);
      shots.push(c.toDataURL('image/png'));
    }
    return { shots, trails: trails.map((T) => [...T].map(([id, s]) => [id, s])), t: W.time, frames: fr };
  }, { seed: Number(seed), t0: Number(t0), t1: Number(t1), boxes: BOXES, tag: TAG });
  // stats per box: marching samples, |d| from the lane line and |d - slot|, rendered-vs-sim gap
  const proj = (P, x, y) => {
    let bd = Infinity, sd = 0;
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i]; const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)); const qx = x - ax - dx * t, qy = y - ay - dy * t; const d2 = qx * qx + qy * qy;
      if (d2 < bd) { bd = d2; sd = (dx * qy - dy * qx) >= 0 ? 1 : -1; }
    }
    return Math.sqrt(bd) * sd;
  };
  const pct = (a, p) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const out = [];
  res.shots.forEach((png, i) => {
    const bx = BOXES[i]; const dir = bx.team === 0 ? 1 : -1;
    writeFileSync(join(OUT, `${TAG}_s${seed}_${bx.name}.png`), Buffer.from(png.split(',')[1], 'base64'));
    const dd = [], off = [], gap = [];
    for (const [, T] of res.trails[i]) for (const s of T) {
      if (!s[2]) continue;
      const d = proj(bx.path, s[0], s[1]) * dir;
      dd.push(Math.abs(d)); off.push(Math.abs(d - s[3])); gap.push(Math.hypot(s[4] - s[0], s[5] - s[1]));
    }
    const f = (a) => `p50 ${pct(a, 0.5).toFixed(2)} p95 ${pct(a, 0.95).toFixed(2)} max ${Math.max(...a).toFixed(2)}`;
    const line = `${TAG} s${seed} ${bx.name}: wicks ${res.trails[i].length} marching samples ${dd.length}  |d| ${f(dd)}  |d-slot| ${f(off)}  render-sim gap ${f(gap)}`;
    console.log(line); out.push(line);
  });
  writeFileSync(join(OUT, `${TAG}_s${seed}_stats.txt`), out.join('\n') + `\nframes ${res.frames} end t ${res.t.toFixed(1)}\n`);
} finally { await browser.close(); }
