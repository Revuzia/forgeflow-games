// Minimal debug viewer of the soft-body SIM mesh (not the pretty render): flat-shaded facets tinted by strain
// (cyan = compressed, red = stretched), a dim wireframe ghost of the rest shape, the table, and the finger-tip spheres.
// It is driven by a scripted scenario from the URL (?scn=side_poke|hold_squash|pull_lobe|peak_flop|float_shove|pinch)
// and steps the sim with a FIXED dt of 1/60 s (no wall clock), so the filmstrips are reproducible.
// Extra URL params: ?p=<json SoftParams override> ?g=<genome seed or g1.code> ?gf= ?gb= ?gs= ?gz= (firmness, bounce,
// stretch, size overrides) ?detail=<3|4> ?px=<press x offset for hold_squash>.
// window.__PV__ is the harness hook (see bottom).
import * as THREE from 'three';
import { SoftBody } from '../../src/physics/softbody.ts';
import { genomeFromParam, quantizeGenome } from '../../src/core/genome.ts';
import type { V3 } from '../../src/contracts.ts';

type Ctx = { n: Record<string, number>; hit: Record<string, V3 | null>; vtx: number; R: number };
interface Scenario {
  title: string;
  frames: number[];
  tick: (t: number, b: SoftBody, c: Ctx) => void;
  camTarget?: [number, number, number];
  yawDeg?: number; pitchDeg?: number;
  camDist?: number;
  float?: boolean;
}

const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

function touch(b: SoftBody, id: 0 | 1, from: V3, dir: V3): V3 | null {
  const hit = b.raycast(from, dir);
  if (!hit) return null;
  b.fingerDown(id, { point: hit.point, normal: hit.normal, dir });
  return hit.point;
}

const REL = 1.4;
const PX = Number(new URLSearchParams(location.search).get('px') ?? 0);
const SCENARIOS: Record<string, Scenario> = {
  // straight-down tap on the swirl-peak tip
  top_peak_poke: {
    title: 'tap straight down on the peak tip (0.30-0.42 s, pressure 0.6)',
    frames: [0.3, 0.34, 0.38, 0.42, 0.45, 0.5, 0.55, 0.62, 0.72, 0.85, 1.0, 1.4],
    camDist: 3.0, yawDeg: 24, pitchDeg: 12,
    tick(t, b, c) {
      if (t >= 0.3 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(0, 3, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.6); }
      if (t >= 0.42 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // straight-down HOLD on the peak, full ramp
  top_peak_hold: {
    title: 'press straight down on the peak tip, ramp 0.5 s to 1.0, hold, release 1.2 s',
    frames: [0.5, 0.65, 0.8, 0.95, 1.15, 1.22, 1.26, 1.3, 1.36, 1.46, 1.7, 2.1],
    camDist: 3.0, yawDeg: 24, pitchDeg: 12,
    tick(t, b, c) {
      if (t >= 0.4 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(0, 3, 0), v3(0, -1, 0)); }
      if (c.n.down && !c.n.up) b.fingerPressure(0, clamp01((t - 0.4) / 0.5));
      if (t >= 1.2 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // very low side press right at the table edge
  edge_low: {
    title: 'side press at y=0.05 (just above the table), ramp 0.9 s, hold, release 1.4 s',
    frames: [0.5, 0.8, 1.1, 1.38, 1.44, 1.48, 1.54, 1.62, 1.75, 1.95, 2.3, 2.9],
    camDist: 3.2, yawDeg: 24, pitchDeg: 9,
    tick(t, b, c) {
      if (t >= 0.4 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(3, 0.05, 0), v3(-1, 0, 0)); }
      if (c.n.down && !c.n.up) b.fingerPressure(0, clamp01((t - 0.4) / 0.9));
      if (t >= 1.4 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // press down on the shoulder close to the foot rim (x=0.42)
  edge_rim: {
    title: 'press straight down near the foot rim (x=0.42), ramp 0.9 s, hold, release 1.4 s',
    frames: [0.5, 0.8, 1.1, 1.38, 1.44, 1.48, 1.54, 1.62, 1.75, 1.95, 2.3, 2.9],
    camDist: 3.2, yawDeg: 24, pitchDeg: 9,
    tick(t, b, c) {
      if (t >= 0.4 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(0.42, 3, 0), v3(0, -1, 0)); }
      if (c.n.down && !c.n.up) b.fingerPressure(0, clamp01((t - 0.4) / 0.9));
      if (t >= 1.4 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // 1-frame tap (down + pressure 1 + up on the very next frame) on the dome flank
  fast_tap1: {
    title: '1-frame tap on the flank at y=0.4: down at 0.30, up at the next frame',
    frames: [0.3, 0.317, 0.333, 0.35, 0.383, 0.417, 0.45, 0.5, 0.58, 0.7, 0.9, 1.3],
    camDist: 3.2, yawDeg: 24, pitchDeg: 9,
    tick(t, b, c) {
      if (t >= 0.3 && !c.n.down) { c.n.down = 1; c.n.dt0 = t; touch(b, 0, v3(3, 0.4, 0), v3(-1, 0, 0)); b.fingerPressure(0, 1); }
      if (c.n.down && !c.n.up && t >= c.n.dt0 + 0.0166) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // 3-frame (50 ms) tap straight down on the dome top-shoulder
  fast_tap3: {
    title: '3-frame tap straight down at x=0.2: pressure 1 for 50 ms',
    frames: [0.3, 0.317, 0.333, 0.35, 0.383, 0.417, 0.45, 0.5, 0.58, 0.7, 0.9, 1.3],
    camDist: 3.2, yawDeg: 24, pitchDeg: 9,
    tick(t, b, c) {
      if (t >= 0.3 && !c.n.down) { c.n.down = 1; c.n.dt0 = t; touch(b, 0, v3(0.2, 3, 0), v3(0, -1, 0)); b.fingerPressure(0, 1); }
      if (c.n.down && !c.n.up && t >= c.n.dt0 + 0.049) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // fast rub across the top
  rub: {
    title: 'press x=-0.3 from the top at 0.6, drag across to x=0.3 in 0.3 s, up at 0.9',
    frames: [0.35, 0.45, 0.55, 0.62, 0.7, 0.78, 0.86, 0.92, 0.98, 1.1, 1.3, 1.7],
    camDist: 3.2, yawDeg: 24, pitchDeg: 14,
    tick(t, b, c) {
      if (t >= 0.3 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(-0.3, 3, 0), v3(0, -1, 0)); }
      if (c.n.down && !c.n.up) {
        b.fingerPressure(0, 0.6);
        if (t >= 0.5) { const k = clamp01((t - 0.5) / 0.3); const h = b.raycast(v3(-0.3 + 0.6 * k, 3, 0), v3(0, -1, 0)); if (h) b.fingerMove(0, h.point); }
      }
      if (t >= 0.9 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // pull far past the max pull and let go
  pull_far: {
    title: 'pull a flank lobe 2.2 m out (past the limit), hold 0.3 s, let go at 1.4',
    frames: [0.6, 0.8, 1.0, 1.2, 1.38, 1.42, 1.46, 1.5, 1.56, 1.66, 1.85, 2.3],
    camDist: 5.2, camTarget: [0.5, 0.5, 0], yawDeg: 24, pitchDeg: 9,
    tick(t, b, c) {
      if (t >= 0.4 && !c.n.down) {
        c.n.down = 1;
        const hit = b.raycast(v3(3, 0.42, 0), v3(-1, 0, 0));
        if (hit) { c.hit.p = hit.point; b.grab(0, hit.vertex, hit.point); }
      }
      if (c.n.down && !c.n.up && c.hit.p) {
        const k = clamp01((t - 0.45) / 0.7);
        b.grabMove(0, v3(c.hit.p.x + 2.2 * k, c.hit.p.y + 0.5 * k, c.hit.p.z));
      }
      if (t >= 1.4 && !c.n.up) { c.n.up = 1; b.grabRelease(0); }
    },
  },
  // pull the peak itself straight up
  pull_peak: {
    title: 'grab the peak tip, pull up 1.0 m, let go at 1.2',
    frames: [0.5, 0.65, 0.8, 0.95, 1.15, 1.22, 1.26, 1.3, 1.36, 1.46, 1.7, 2.1],
    camDist: 4.2, camTarget: [0, 0.8, 0], yawDeg: 24, pitchDeg: 9,
    tick(t, b, c) {
      if (t >= 0.4 && !c.n.down) {
        c.n.down = 1;
        const hit = b.raycast(v3(0, 3, 0), v3(0, -1, 0));
        if (hit) { c.hit.p = hit.point; b.grab(0, hit.vertex, hit.point); }
      }
      if (c.n.down && !c.n.up && c.hit.p) {
        const k = clamp01((t - 0.45) / 0.6);
        b.grabMove(0, v3(c.hit.p.x, c.hit.p.y + 1.0 * k, c.hit.p.z));
      }
      if (t >= 1.2 && !c.n.up) { c.n.up = 1; b.grabRelease(0); }
    },
  },
  // close-up of the peak tip long after a tap (permanent-fold check); ?px= = hit offset x
  peak_rest_close: {
    title: 'tap on the peak (x=PX) 0.30-0.42 s then close-up of the tip at rest (t=0.35,0.5,1,2,3,4,5,6,...)',
    frames: [0.3, 0.36, 0.5, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0],
    camDist: 1.5, camTarget: [0, 0.85, 0], yawDeg: 24, pitchDeg: 18,
    tick(t, b, c) {
      if (t >= 0.3 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(PX, 3, 0), v3(0, -1, 0)); b.fingerPressure(0, 0.6); }
      if (t >= 0.42 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
  // close-up of the hold-squash top (the dark notch in the filmstrip)
  hold_close: {
    title: 'hold-squash from the top, close-up from above (ramp 0.9 s), release 1.4',
    frames: [0.9, 1.1, 1.3, 1.4, 1.42, 1.44, 1.46, 1.48, 1.5, 1.54, 1.6, 1.7],
    camDist: 2.4, camTarget: [0, 0.6, 0], yawDeg: 24, pitchDeg: 32,
    tick(t, b, c) {
      if (t >= 0.4 && !c.n.down) { c.n.down = 1; touch(b, 0, v3(0, 3, 0), v3(0, -1, 0)); }
      if (c.n.down && !c.n.up) b.fingerPressure(0, clamp01((t - 0.4) / 0.9));
      if (t >= 1.4 && !c.n.up) { c.n.up = 1; b.fingerUp(0); }
    },
  },
};

interface Snap {
  t: number; pos: Float32Array; strain: Float32Array;
  tips: Array<{ x: number; y: number; z: number; r: number } | null>;
  top: number; foot: number; cy: number; cx: number; cz: number;
  comp: number; rate: number; stretch: number; vol: number; kin: number; grounded: boolean; fingers: number; grabbed: boolean;
}
interface LogRow { t: number; comp: number; rate: number; stretch: number; vol: number; kin: number; grounded: boolean; top: number; foot: number; cx: number; cy: number; cz: number }

const q = new URLSearchParams(location.search);
const scnName = q.get('scn') ?? 'side_poke';
const sc = SCENARIOS[scnName] ?? SCENARIOS.top_peak_poke;
let genome = genomeFromParam(q.get('g'));
// ?gf= ?gb= ?gs= ?gz= override firmness / bounce / stretch / size (0..1) for the genome-extremes filmstrips
{
  const ov = { ...genome };
  const take = (k: string, key: 'firmness' | 'bounce' | 'stretch' | 'size'): void => { const v = q.get(k); if (v !== null && Number.isFinite(Number(v))) ov[key] = Number(v); };
  take('gf', 'firmness'); take('gb', 'bounce'); take('gs', 'stretch'); take('gz', 'size');
  genome = quantizeGenome(ov);
}
let params: Record<string, number> | undefined;
try { const raw = q.get('p'); if (raw) params = JSON.parse(raw); } catch { params = undefined; }
const detail = Number(q.get('detail') ?? 3);

const body = new SoftBody(genome, { detail, params });
if (sc.float) body.gravity = false;
if (sc.float) body.reset();

// ---- run the scenario with a fixed dt, capture snapshots at the requested times
const DT = 1 / Number(q.get('fps') ?? 60);
const snaps: Snap[] = [];
const log: LogRow[] = [];
const events: Array<{ t: number; kind: string; intensity: number; finger: number; heldFor: number }> = [];
const ctx: Ctx = { n: {}, hit: {}, vtx: -1, R: body.restRadius };

function snapshot(t: number): Snap {
  const P = body.positions;
  let top = -1e9, foot = 1e9;
  for (let i = 0; i < body.vertexCount; i++) { const y = P[i * 3 + 1]; if (y > top) top = y; if (y < foot) foot = y; }
  const m = body.metrics;
  return {
    t, pos: Float32Array.from(P), strain: Float32Array.from(body.strain),
    tips: [body.tip(0), body.tip(1)].map((k) => (k ? { x: k.x, y: k.y, z: k.z, r: k.r } : null)),
    top, foot, cy: body.center.y, cx: body.center.x, cz: body.center.z,
    comp: m.compression, rate: m.compressionRate, stretch: m.stretch, vol: m.volume, kin: m.kinetic, grounded: m.grounded, fingers: m.fingers, grabbed: m.grabbed,
  };
}

const tEnd = sc.frames[sc.frames.length - 1] + 1e-6;
let fi = 0;
const t0 = performance.now();
for (let step = 0, t = 0; t < tEnd + DT; step++) {
  sc.tick(t, body, ctx);
  body.step(DT);
  t = (step + 1) * DT;
  const m = body.metrics;
  {
    let top = -1e9, foot = 1e9;
    for (let i = 0; i < body.vertexCount; i++) { const y = body.positions[i * 3 + 1]; if (y > top) top = y; if (y < foot) foot = y; }
    log.push({ t, comp: m.compression, rate: m.compressionRate, stretch: m.stretch, vol: m.volume, kin: m.kinetic, grounded: m.grounded, top, foot, cx: body.center.x, cy: body.center.y, cz: body.center.z });
  }
  const out: Array<{ kind: string; intensity: number; finger: number; heldFor: number }> = [];
  body.drainEvents(out as never);
  for (const e of out) events.push({ t, kind: e.kind, intensity: e.intensity, finger: e.finger, heldFor: e.heldFor });
  while (fi < sc.frames.length && t >= sc.frames[fi] - 1e-9) { snaps.push(snapshot(t)); fi++; }
}
const simMs = performance.now() - t0;

// ---- render the 4x3 filmstrip
const W = 1600, H = 1200, TW = 400, TH = 400;
const canvas = document.getElementById('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.setScissorTest(true);
renderer.setClearColor(0x14102a, 1);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffe2c0, 0x33224d, 1.1));
const key = new THREE.DirectionalLight(0xffb347, 2.0); key.position.set(2, 4, 3); scene.add(key);
const rim = new THREE.DirectionalLight(0x59d6e6, 1.0); rim.position.set(-3, 2, -2); scene.add(rim);

const table = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.MeshBasicMaterial({ color: 0x2a2150 }));
table.rotation.x = -Math.PI / 2; table.position.y = -0.002; scene.add(table);
const grid = new THREE.GridHelper(4.4, 22, 0x5b3a86, 0x3b2c6a); grid.position.y = 0.0005; scene.add(grid);

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(body.vertexCount * 3), 3));
geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(body.vertexCount * 3), 3));
geo.setIndex(new THREE.BufferAttribute(body.indices, 1));
const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide }));
scene.add(mesh);
const wire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x000000, wireframe: true, transparent: true, opacity: 0.12, depthTest: true }));
scene.add(wire);

// rest ghost
let restMinY = 1e9;
for (let i = 0; i < body.vertexCount; i++) restMinY = Math.min(restMinY, body.restLocal[i * 3 + 1]);
const ghostPos = new Float32Array(body.restLocal.length);
for (let i = 0; i < body.vertexCount; i++) { ghostPos[i * 3] = body.restLocal[i * 3]; ghostPos[i * 3 + 1] = body.restLocal[i * 3 + 1] - restMinY; ghostPos[i * 3 + 2] = body.restLocal[i * 3 + 2]; }
const ggeo = new THREE.BufferGeometry();
ggeo.setAttribute('position', new THREE.BufferAttribute(ghostPos, 3));
ggeo.setIndex(new THREE.BufferAttribute(body.indices, 1));
const ghost = new THREE.Mesh(ggeo, new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.16 }));
scene.add(ghost);
const topLine = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.004), new THREE.MeshBasicMaterial({ color: 0x59d6e6, transparent: true, opacity: 0.55 }));
topLine.position.set(0, ghostPos.reduce((m, _v, i) => (i % 3 === 1 ? Math.max(m, ghostPos[i]) : m), 0), -1.4);
scene.add(topLine);

const tipMeshes = [0, 1].map(() => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xff5a4d, transparent: true, opacity: 0.35 }));
  m.visible = false; scene.add(m); return m;
});

const cam = new THREE.PerspectiveCamera(28, TW / TH, 0.1, 50);
const dist = sc.camDist ?? 3.5;
const tgt = sc.camTarget ?? [0, 0.5, 0];
const yaw = ((sc.yawDeg ?? 24) * Math.PI) / 180, pitch = ((sc.pitchDeg ?? 9) * Math.PI) / 180;
cam.position.set(tgt[0] + dist * Math.sin(yaw) * Math.cos(pitch), tgt[1] + dist * Math.sin(pitch), tgt[2] + dist * Math.cos(yaw) * Math.cos(pitch));
cam.lookAt(tgt[0], tgt[1], tgt[2]);

const labels = document.getElementById('labels') as HTMLDivElement;
const title = document.createElement('div');
title.id = 'title'; title.textContent = `${scnName}: ${sc.title}   sim ${simMs.toFixed(0)} ms for ${log.length} steps`;
labels.appendChild(title);

function drawSnap(s: Snap, idx: number): void {
  (geo.attributes.position.array as Float32Array).set(s.pos);
  geo.attributes.position.needsUpdate = true;
  const col = geo.attributes.color.array as Float32Array;
  for (let i = 0; i < body.vertexCount; i++) {
    const d = Math.max(-1, Math.min(1, (s.strain[i] - 1) / 0.25));
    const base = [1.0, 0.72, 0.36];
    const tint = d >= 0 ? [1.0, 0.25, 0.2] : [0.25, 0.8, 1.0];
    const a = Math.abs(d) * 0.85;
    col[i * 3] = base[0] + (tint[0] - base[0]) * a; col[i * 3 + 1] = base[1] + (tint[1] - base[1]) * a; col[i * 3 + 2] = base[2] + (tint[2] - base[2]) * a;
  }
  geo.attributes.color.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  for (let k = 0; k < 2; k++) {
    const tip = s.tips[k];
    tipMeshes[k].visible = !!tip;
    if (tip) { tipMeshes[k].position.set(tip.x, tip.y, tip.z); tipMeshes[k].scale.setScalar(tip.r); }
  }
  const col4 = idx % 4, row = Math.floor(idx / 4);
  const x = col4 * TW, y = H - (row + 1) * TH;
  renderer.setViewport(x, y, TW, TH);
  renderer.setScissor(x, y, TW, TH);
  renderer.render(scene, cam);
}

snaps.forEach((s, i) => {
  drawSnap(s, i);
  const d = document.createElement('div');
  d.style.left = `${(i % 4) * TW}px`; d.style.top = `${Math.floor(i / 4) * TH + 22}px`;
  d.textContent = `t=${s.t.toFixed(2)}s  comp ${s.comp.toFixed(2)}  rate ${s.rate.toFixed(1)}\nvol ${s.vol.toFixed(3)}  kin ${s.kin.toFixed(2)}  str ${s.stretch.toFixed(2)}\ntop ${s.top.toFixed(3)}  foot ${s.foot.toFixed(3)}  fing ${s.fingers}${s.grabbed ? ' G' : ''}${s.grounded ? '' : ' AIR'}`;
  labels.appendChild(d);
});
// tile borders
const border = document.createElement('div');
border.style.cssText = 'position:absolute;left:0;top:0;width:1600px;height:1200px;pointer-events:none;background:' +
  'linear-gradient(#ffffff22,#ffffff22) 399px 0/2px 100% no-repeat,linear-gradient(#ffffff22,#ffffff22) 799px 0/2px 100% no-repeat,linear-gradient(#ffffff22,#ffffff22) 1199px 0/2px 100% no-repeat,' +
  'linear-gradient(#ffffff22,#ffffff22) 0 399px/100% 2px no-repeat,linear-gradient(#ffffff22,#ffffff22) 0 799px/100% 2px no-repeat';
labels.appendChild(border);

declare global { interface Window { __PV__?: unknown } }
window.__PV__ = {
  ready: true,
  scenario: scnName,
  names: Object.keys(SCENARIOS),
  frames: snaps.map((s) => ({ t: s.t, comp: s.comp, rate: s.rate, stretch: s.stretch, vol: s.vol, kin: s.kin, top: s.top, foot: s.foot, cx: s.cx, cy: s.cy, cz: s.cz, grounded: s.grounded, fingers: s.fingers })),
  log, events, simMs,
  stateHash: body.stateHash(),
  safetyResets: body.debug.safetyResets,
  restTop: ghostPos.reduce((m, _v, i) => (i % 3 === 1 ? Math.max(m, ghostPos[i]) : m), 0),
};
