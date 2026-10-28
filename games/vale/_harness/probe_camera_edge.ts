// VALE probe — env F1 step 4: how much out-of-play ground the in-match camera shows at the map's edges.
//
// Pure geometry on the real CameraRig (src/render/camera.ts, no GPU): the focus is requested at each base spawn, at
// every edge midpoint and every corner (an edge pan pinned against the clamp), the rig settles, and a 96×54 grid of
// screen rays is cast onto the ground plane (y = 0). `oob` = the share of rays that land outside [0, W] × [0, H] (or
// miss the ground: sky). Each spot is measured with the focus clamp inset 0 m (the old rule) and the shipped inset
// (CAMERA.boundsInset), at the default distance and at max zoom-out.
//   node _harness/probe_camera_edge.ts [--out <json>]  → _harness/_reports/fw_W1_camera_edge.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Raycaster, Vector2, Vector3, Plane } from 'three';
import { CAMERA, CameraRig } from '../src/render/camera.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? process.argv[oi + 1] : join(HERE, '_reports', 'fw_W1_camera_edge.json');
mkdirSync(dirname(OUT), { recursive: true });

interface MapJ { id: string; size: [number, number]; bases?: { spawn: [number, number] }[] }
const maps = ['rift', 'bridge', 'fray'].map((m) => JSON.parse(readFileSync(join(ROOT, 'content', 'maps', `map_${m}.json`), 'utf8')) as MapJ);

const W = 1920, H = 1080, GX = 96, GY = 54;
const ground = new Plane(new Vector3(0, 1, 0), 0);
const ray = new Raycaster();
const ndc = new Vector2();
const hit = new Vector3();

function oobShare(rig: CameraRig, sx: number, sz: number): number {
  let out = 0;
  for (let j = 0; j < GY; j++) for (let i = 0; i < GX; i++) {
    ndc.set(((i + 0.5) / GX) * 2 - 1, 1 - ((j + 0.5) / GY) * 2);
    ray.setFromCamera(ndc, rig.camera);
    const p = ray.ray.intersectPlane(ground, hit);
    if (!p || p.x < 0 || p.x > sx || p.z < 0 || p.z > sz) out++;
  }
  return out / (GX * GY);
}

function measure(m: MapJ, x: number, z: number, inset: number, distance: number): { focus: [number, number]; oob: number } {
  const rig = new CameraRig(W / H);
  rig.setViewport(W, H);
  rig.setBounds(m.size[0], m.size[1], inset);
  rig.setZoom(distance);
  rig.mode = 'free';
  rig.focusOn(x, z);
  rig.update(1 / 60);
  return { focus: [+rig.focus.x.toFixed(2), +rig.focus.z.toFixed(2)], oob: +oobShare(rig, m.size[0], m.size[1]).toFixed(3) };
}

const report: Record<string, unknown> = { at: new Date().toISOString(), inset: CAMERA.boundsInset, grid: [GX, GY], maps: {} };
const summary: string[] = [];
for (const m of maps) {
  const [sx, sz] = m.size;
  const spots: [string, number, number][] = [
    ...(m.bases ?? []).map((b, i) => [`spawn${i}`, b.spawn[0], b.spawn[1]] as [string, number, number]),
    ['edgeW', 0, sz / 2], ['edgeE', sx, sz / 2], ['edgeN', sx / 2, 0], ['edgeS', sx / 2, sz],
    ['cornerNW', 0, 0], ['cornerNE', sx, 0], ['cornerSW', 0, sz], ['cornerSE', sx, sz],
  ];
  const rows = spots.map(([k, x, z]) => {
    const r: Record<string, unknown> = { spot: k, at: [x, z] };
    for (const [tag, d] of [['def', CAMERA.distance], ['max', CAMERA.maxDistance]] as const) {
      const a = measure(m, x, z, 0, d), b = measure(m, x, z, CAMERA.boundsInset, d);
      r[tag] = { before: a.oob, after: b.oob, focusAfter: b.focus };
    }
    return r;
  });
  const mean = (tag: 'def' | 'max', w: 'before' | 'after', f: (s: string) => boolean): number => {
    const v = rows.filter((r) => f(r.spot as string)).map((r) => (r[tag] as Record<string, number>)[w]);
    return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(3) : 0;
  };
  const edge = (s: string): boolean => s.startsWith('edge'), spawn = (s: string): boolean => s.startsWith('spawn'), corner = (s: string): boolean => s.startsWith('corner');
  const agg = {
    spawn: { before: mean('def', 'before', spawn), after: mean('def', 'after', spawn) },
    edge: { before: mean('def', 'before', edge), after: mean('def', 'after', edge) },
    corner: { before: mean('def', 'before', corner), after: mean('def', 'after', corner) },
    edgeMaxZoom: { before: mean('max', 'before', edge), after: mean('max', 'after', edge) },
  };
  (report.maps as Record<string, unknown>)[m.id] = { size: m.size, agg, rows };
  summary.push(`${m.id}: spawn ${agg.spawn.before}→${agg.spawn.after}  edge ${agg.edge.before}→${agg.edge.after}  corner ${agg.corner.before}→${agg.corner.after}  edge@max ${agg.edgeMaxZoom.before}→${agg.edgeMaxZoom.after}`);
}
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`out-of-play share of the frame (inset 0 → ${CAMERA.boundsInset} m)`);
for (const s of summary) console.log('  ' + s);
console.log('→', OUT);
