// VALE harness (tmp, orch1 wobble diag) — annotated evidence frames. Same bench as _tmp_wobble_live.mjs (real Chrome
// 1920x1080, real renderer, bots on every seat, spectator, fog off, game camera at its widest zoom). Steps a wave of
// Wicks through a stretch of road with the camera parked, records the marching Wicks' sim positions every frame, then
// draws on the final frame: road centre (the map lane polyline = the drawn road's centre, yellow), road edges +-3.6 m
// (thin), the polyline vertices with their turn angles, each Wick's trail (team 0 cyan, team 1 orange; white where it is
// fighting rather than marching) and the measured peak offset per vertex.
//
//   VALE_URL=http://localhost:5277 python3 art/blender/common/heavy.py run -- node _harness/_tmp_wobble_shots.mjs <seed> <lane> <team> <camX> <camY> <t0> <t1> <name>
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBench, B } from './gfx_lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [seed, lane, team, cx, cy, t0, t1, name] = process.argv.slice(2);
const OUT = join(HERE, '..', '_design', 'reviews', 'orch1', 'evidence', 'wobble');
mkdirSync(OUT, { recursive: true });
const map = JSON.parse(readFileSync(join(HERE, '..', 'content', 'maps', 'map_rift.json'), 'utf8'));
const path = map.lanes.find((l) => l.id === lane).path;
const tw = map.structures.filter((s) => s.id.includes(lane.split('_')[1]) && !s.id.includes('bell')).map((s) => ({ id: s.id, at: s.at }));

const { browser, page } = await openBench({ q: 'high', t: Number(t0) - 3, seed: Number(seed), manual: true });
try {
  const res = await B(page, async (b, a) => {
    const R = b.renderer, W = b.host.sim.world; R.palette.viewer.team = -1; R.fog.enabled = false; R.rig.spectator = true;
    const M = await import('/src/sim/units/minions.ts');
    b.focus(a.cx, a.cy); b.zoom(36);
    const trails = new Map();
    const startT = W.time;
    while (W.time < a.t1) {
      b.frames(1, 1 / 30);
      if (W.time < a.t0) continue;
      for (const e of W.entities) {
        if (e.kind !== 'minion' || !e.alive || e.team !== a.team) continue;
        if (Math.hypot(e.x - a.cx, e.y - a.cy) > 26) continue;
        const m = M.minionState(e);
        const march = e.order === 2 && m && !m.chasing && W.tick >= m.flankUntil && (e.atkTarget ?? -1) === -1;
        const act = R.actors.get(e.id);
        if (!trails.has(e.id)) trails.set(e.id, []);
        trails.get(e.id).push([e.x, e.y, march ? 1 : 0, act ? act.root.position.x : e.x, act ? act.root.position.z : e.y]);
      }
    }
    b.focus(a.cx, a.cy); R.render(0); R.render(0);
    const gl = R.gl.domElement;
    const c = document.createElement('canvas'); c.width = gl.width; c.height = gl.height;
    const g = c.getContext('2d');
    g.drawImage(gl, 0, 0);
    const S = (x, y) => { const p = b.screen(x, y, 0.05); return [p.x * c.width / innerWidth, p.y * c.height / innerHeight]; };
    const line = (pts, color, w, dash) => { g.strokeStyle = color; g.lineWidth = w; g.setLineDash(dash ?? []); g.beginPath(); pts.forEach((p, i) => { const [x, y] = S(p[0], p[1]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke(); g.setLineDash([]); };
    // road edges (the road band is +-3.6 m round the polyline) and centre
    const P = a.path;
    for (const sgn of [-1, 1]) for (let i = 0; i < P.length - 1; i++) {
      const [ax, ay] = P[i], [bx, by] = P[i + 1], L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L * 3.6 * sgn, ny = (bx - ax) / L * 3.6 * sgn;
      line([[ax + nx, ay + ny], [bx + nx, by + ny]], 'rgba(255,255,255,0.45)', 1.5, [6, 6]);
    }
    line(P, '#ffd400', 3);
    g.font = 'bold 22px sans-serif';
    for (let i = 1; i < P.length - 1; i++) {
      const [x, y] = S(P[i][0], P[i][1]);
      const t1 = Math.atan2(P[i][1] - P[i - 1][1], P[i][0] - P[i - 1][0]), t2 = Math.atan2(P[i + 1][1] - P[i][1], P[i + 1][0] - P[i][0]);
      g.fillStyle = '#ffd400'; g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
      g.fillStyle = '#000'; g.fillText(`v${i} ${((t2 - t1) * 180 / Math.PI).toFixed(1)}°`, x + 11, y - 9); g.fillStyle = '#ffd400'; g.fillText(`v${i} ${((t2 - t1) * 180 / Math.PI).toFixed(1)}°`, x + 10, y - 10);
    }
    for (const t of a.tw) { const [x, y] = S(t.at[0], t.at[1]); g.strokeStyle = '#ff3b3b'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, 18, 0, 7); g.stroke(); g.fillStyle = '#ff3b3b'; g.fillText(t.id, x + 22, y + 6); }
    const col = a.team === 0 ? '#28e0ff' : '#ff9a28';
    for (const [id, T] of trails) {
      for (let i = 1; i < T.length; i++) {
        const [x0, y0] = S(T[i - 1][0], T[i - 1][1]), [x1, y1] = S(T[i][0], T[i][1]);
        g.strokeStyle = T[i][2] ? col : 'rgba(255,255,255,0.8)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      }
    }
    g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(0, 0, c.width, 120);
    g.fillStyle = '#fff'; g.font = 'bold 26px sans-serif';
    g.fillText(`${a.name}  seed ${a.seed}  ${a.lane} team ${a.team}  match ${Math.floor(startT / 60)}:${String(Math.floor(startT % 60)).padStart(2, '0')}-${Math.floor(W.time / 60)}:${String(Math.floor(W.time % 60)).padStart(2, '0')}`, 20, 38);
    g.font = '22px sans-serif';
    g.fillText('yellow: road centre (lane polyline; the drawn road is +-3.6 m round it, dashed)   coloured: Wick sim trails while marching   white: fighting', 20, 72);
    g.fillText('red rings: towers / lantern of this road   screen-down = world +y', 20, 104);
    // the last frame's projected size of 1 m (scale)
    const s0 = S(a.cx, a.cy), s1 = S(a.cx, a.cy + 1);
    return { png: c.toDataURL('image/png'), trails: [...trails].map(([id, T]) => [id, T.length]), pxPerM_y: s1[1] - s0[1], t: W.time };
  }, { seed: Number(seed), lane, team: Number(team), cx: Number(cx), cy: Number(cy), t0: Number(t0), t1: Number(t1), path, tw, name });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(res.png.split(',')[1], 'base64'));
  console.log(name, 'trails', res.trails.length, 'px/m', res.pxPerM_y.toFixed(1), 't', res.t.toFixed(1));
} finally { await browser.close(); }
