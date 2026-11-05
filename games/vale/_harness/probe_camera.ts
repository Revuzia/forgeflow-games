// VALE probe — CW1 critic:camera + critic:input-feel (the geometry half; the real-client half is
// _harness/probe_input_latency.mjs). Pure node: the shipped GLBs (textures stripped) and the real CameraRig
// (src/render/camera.ts) at 1920×1080.
//
//   heights   every fighter base and skin model in its idle pose (8 samples): the BODY crown (the highest vertex within
//             0.35 m of the head bone in plan view) drawn above the feet on the fighter's own screen column; for
//             reference the top of everything (weapons held high) and the silhouette's full screen height over 8
//             facings (median), at the closing review's 28.5 m and at the default distance. Gate (critic camera; r12
//             §2): the body is 105-130 px at 28.5 m, compact builds 85-105 px, ruling 11 (WARN; FAIL with --gate-heights).
//   rig       edge-pan speed in px/s (pointer at the right edge, free mode) at panSpeed 0 / 0.5 / 1; locked is the
//             default and keeps a running fighter at the exact centre (follow lag 0 px); the lock toggle (setMode
//             locked) and the re-centre key (centerOnSelf) land on the fighter on the same frame; respawn (self gone
//             5 s, back at the fountain) re-centres in locked, semi and free.
//   motion    foot slip: the run clip's planted foot (within 3 cm of its lowest point; src/render/stride.ts) in the
//             model's frame, played at the renderer's rate (moveSpeed / runRef, clamped 0.35-2.2) while the body moves
//             at base moveSpeed: the planted foot's world speed (m/s and % of moveSpeed) with the authored
//             art.runRefSpeed and with the runRef the renderer now measures from the clip (stride.ts plantedRunRef).
//             Gate: median planted-foot speed <= 10 % of moveSpeed for every fighter. Turn: the drawn heading (src/render/turn.ts) for a 180° and a 90° order at 60 Hz:
//             time to within 5° and the peak drawn rate (deg/s); the sim's own heading changes in one tick.
//
//   node _harness/probe_camera.ts [--out <json>] [--only heights,rig,motion] [--gate-heights]   → _harness/_reports/fw_CW1_camera.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { type AnimationClip, AnimationMixer, type Object3D, PropertyBinding, type SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAMERA, CameraRig } from '../src/render/camera.ts';
import { turnToward } from '../src/render/turn.ts';
import { footTracks, plantedRunRef, stanceVelocities } from '../src/render/stride.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', join(HERE, '_reports', 'fw_CW1_camera.json'));
const ONLY = new Set(arg('only', 'heights,rig,motion').split(','));
mkdirSync(dirname(OUT), { recursive: true });

const req = createRequire(join(ROOT, 'package.json'));
const { NodeIO } = await import(req.resolve('@gltf-transform/core')) as typeof import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions')) as typeof import('@gltf-transform/extensions');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
async function load(file: string): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const glb = await io.writeBinary(doc);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const g = await new Promise<{ scene: Object3D; animations: AnimationClip[] }>((res, rej) => new GLTFLoader().parse(ab, '', res as never, rej));
  return { scene: g.scene, clips: g.animations };
}

const W = 1920, H = 1080, F0 = 200;
function rigAt(distance: number): CameraRig {
  const r = new CameraRig(W / H);
  r.setViewport(W, H); r.setBounds(400, 400, 0); r.mode = 'free'; r.setZoom(distance); r.focusOn(F0, F0); r.update(1 / 60);
  return r;
}
const pxPerM = (d: number): number => (H / 2) / Math.tan((CAMERA.fovDeg / 2) * Math.PI / 180) / d;

const fails: string[] = [];
/** the 105-130 px band is reported (WARN) by default and gated with --gate-heights. Owner ruling 11: the band applies to
 *  standard builds; a compact build (Sukri: a harness may name content) may sit at 85-105 px; every other fighter reaches
 *  105 px through art.scale. Compared after rounding to whole px (Marund Long Evening 130.4 counts as inside). */
const GATE_HEIGHTS = process.argv.includes('--gate-heights');
const COMPACT = new Set(['sukri']);
const heightBand = (fighter: string): [number, number] => (COMPACT.has(fighter) ? [85, 105] : [105, 130]);
const warns: string[] = [];
const report: Record<string, unknown> = { at: new Date().toISOString(), camera: CAMERA };
const fighters = readdirSync(join(ROOT, 'content', 'fighters')).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(ROOT, 'content', 'fighters', f), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id));
const modelFile = (ref: string): string => join(ROOT, 'art', 'out', ref.replace(/^assets\//, ''));

// ── heights ──────────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.has('heights')) {
  const rows: Record<string, unknown>[] = [];
  const rigs = { 28.5: rigAt(28.5), [CAMERA.distance]: rigAt(CAMERA.distance) } as Record<number, CameraRig>;
  const v = new Vector3();
  const sy = (r: CameraRig, x: number, y: number, z: number): number => { v.set(F0 + x, y, F0 + z).project(r.camera); return (1 - v.y) * H / 2; };
  console.log('heights (px at 1080p): crown on its column / silhouette median over 8 facings');
  for (const f of fighters) {
    const skins = JSON.parse(readFileSync(join(ROOT, 'content', 'skins', `${f.id}.json`), 'utf8')) as { id: string; model: string; tier: string }[];
    for (const s of skins) {
      const file = modelFile(s.model);
      if (!existsSync(file)) { rows.push({ fighter: f.id, skin: s.id, missing: s.model }); continue; }
      const { scene, clips } = await load(file);
      const idle = clips.find((c) => c.name === (f.art.clips?.idle ?? 'idle'));
      scene.scale.setScalar(f.art.scale ?? 1);
      const mixer = new AnimationMixer(scene);
      const meshes: SkinnedMesh[] = [];
      scene.traverse((o) => { const m = o as SkinnedMesh; if (m.isMesh && m.geometry?.attributes.position) meshes.push(m); });
      const act = idle ? mixer.clipAction(idle) : null;
      act?.play();
      const crowns: number[] = [], heads: number[] = [];
      const hn = f.art.sockets?.head ?? 'head';
      const head = scene.getObjectByName(PropertyBinding.sanitizeNodeName(hn)) ?? scene.getObjectByName(hn);
      const sil: Record<number, number[]> = { 28.5: [], [CAMERA.distance]: [] };
      for (let k = 0; k < 8; k++) {
        if (act && idle) { act.time = idle.duration * k / 8; mixer.update(0); }
        scene.updateMatrixWorld(true);
        const pts: number[] = [];
        for (const m of meshes) {
          const n = m.geometry.attributes.position.count, stride = Math.max(1, Math.floor(n / 4000));
          for (let i = 0; i < n; i += stride) { m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld); pts.push(v.x, v.y, v.z); }
        }
        let top = 0, headTop = 0;
        const hb = head ? head.getWorldPosition(new Vector3()) : null;
        for (let i = 0; i < pts.length; i += 3) {
          top = Math.max(top, pts[i + 1]);
          // the body's crown: the highest vertex within 0.35 m (plan view) of the head bone (weapons held aside or
          // overhead do not count)
          if (hb && Math.hypot(pts[i] - hb.x, pts[i + 2] - hb.z) <= 0.35 && pts[i + 1] >= hb.y - 0.1) headTop = Math.max(headTop, pts[i + 1]);
        }
        crowns.push(top);
        heads.push(headTop || top);
        for (const d of [28.5, CAMERA.distance]) {
          const r = rigs[d];
          for (let a = 0; a < 8; a++) {
            const th = 2 * Math.PI * a / 8, c = Math.cos(th), sn = Math.sin(th);
            let lo = Infinity, hi = -Infinity;
            for (let i = 0; i < pts.length; i += 3) {
              const y = sy(r, c * pts[i] + sn * pts[i + 2], pts[i + 1], -sn * pts[i] + c * pts[i + 2]);
              if (y < lo) lo = y; if (y > hi) hi = y;
            }
            sil[d].push(hi - lo);
          }
        }
      }
      const med = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
      const crown = med(crowns), body = med(heads);
      const px = (d: number, y: number): number => +(sy(rigs[d], 0, 0, 0) - sy(rigs[d], 0, y, 0)).toFixed(1);
      const row = {
        fighter: f.id, skin: s.id, tier: s.tier, bodyM: +body.toFixed(3), bodyPx285: px(28.5, body), bodyPxDef: px(CAMERA.distance, body), crownM: +crown.toFixed(3),
        crownPx285: +(sy(rigs[28.5], 0, 0, 0) - sy(rigs[28.5], 0, crown, 0)).toFixed(1),
        silPx285: +med(sil[28.5]).toFixed(1),
        crownPxDef: +(sy(rigs[CAMERA.distance], 0, 0, 0) - sy(rigs[CAMERA.distance], 0, crown, 0)).toFixed(1),
        silPxDef: +med(sil[CAMERA.distance]).toFixed(1),
      };
      rows.push(row);
      const [lo, hi] = heightBand(f.id);
      const ok = Math.round(row.bodyPx285) >= lo && Math.round(row.bodyPx285) <= hi;
      if (!ok) (GATE_HEIGHTS ? fails : warns).push(`height ${s.id}: body ${row.bodyPx285} px at 28.5 m outside ${lo}-${hi}`);
      console.log(`${ok ? '  ' : '! '}${s.id.padEnd(26)} body ${body.toFixed(2)} m / top ${crown.toFixed(2)} m  28.5 m: ${row.bodyPx285.toFixed(0).padStart(3)} / ${row.crownPx285.toFixed(0).padStart(3)} / ${row.silPx285.toFixed(0).padStart(3)} px   ${CAMERA.distance} m: ${row.bodyPxDef.toFixed(0).padStart(3)} / ${row.crownPxDef.toFixed(0).padStart(3)} / ${row.silPxDef.toFixed(0).padStart(3)} px`);
    }
  }
  const col = (k: string): number[] => rows.filter((r) => typeof r[k] === 'number').map((r) => r[k] as number).sort((a, b) => a - b);
  const b285 = col('bodyPx285'), bDef = col('bodyPxDef');
  const inBand = rows.filter((r) => { if (typeof r.bodyPx285 !== 'number') return false; const [lo, hi] = heightBand(r.fighter as string); const p = Math.round(r.bodyPx285); return p >= lo && p <= hi; }).length;
  report.heights = { rows, body285: { min: b285[0], median: b285[b285.length >> 1], max: b285[b285.length - 1], inBand, of: b285.length }, bodyDefault: { min: bDef[0], median: bDef[bDef.length >> 1], max: bDef[bDef.length - 1] } };
  console.log(`body height at 28.5 m: ${b285[0]}-${b285[b285.length - 1]} px (median ${b285[b285.length >> 1]}), ${inBand}/${b285.length} in band (ruling 11); at ${CAMERA.distance} m: ${bDef[0]}-${bDef[bDef.length - 1]} px (median ${bDef[bDef.length >> 1]})`);
}

// ── rig ──────────────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.has('rig')) {
  const DT = 1 / 60;
  const mk = (): CameraRig => { const r = new CameraRig(W / H); r.setViewport(W, H); r.setBounds(400, 400); return r; };
  const out: Record<string, unknown> = {};
  const k = pxPerM(CAMERA.distance);
  // edge pan, free mode, pointer at the right edge for 1 s
  const pan: Record<string, number> = {};
  for (const ps of [0, 0.5, 1]) {
    const r = mk(); r.setMode('free'); r.panSpeed = ps; r.focusOn(200, 200); r.setPointer(W - 2, H / 2, true);
    for (let t = 0; t < 1 - 1e-9; t += DT) r.update(DT);
    pan[`panSpeed${ps}`] = Math.round((r.focus.x - 200) * k);
  }
  out.edgePanPxPerS = pan;
  // locked: default mode, follow lag while running 3.45 m/s
  const r = mk(); let sx = 100, sz = 200; r.setSelf(sx, sz);
  let lag = 0;
  for (let t = 0; t < 2; t += DT) { sx += 3.45 * DT; r.setSelf(sx, sz); r.update(DT); lag = Math.max(lag, Math.hypot(r.focus.x - sx, r.focus.z - sz) * k); }
  out.lockedDefault = r.mode === 'locked';
  out.followLagPx = +lag.toFixed(2);
  // lock toggle from a panned semi camera, and the re-centre key
  r.setMode('semi'); r.setPointer(W - 2, H / 2, true); for (let t = 0; t < 0.5; t += DT) { r.setSelf(sx, sz); r.update(DT); }
  const panned = Math.hypot(r.focus.x - sx, r.focus.z - sz) * k;
  r.setPointer(W / 2, H / 2, true);
  r.setMode('locked'); r.update(DT);
  out.lockToggle = { pannedPx: Math.round(panned), afterPx: +(Math.hypot(r.focus.x - sx, r.focus.z - sz) * k).toFixed(2), frames: 1 };
  r.setMode('free'); r.setPointer(W - 2, H / 2, true); for (let t = 0; t < 0.5; t += DT) { r.setSelf(sx, sz); r.update(DT); }
  r.setPointer(W / 2, H / 2, true);
  const before = Math.hypot(r.focus.x - sx, r.focus.z - sz) * k;
  r.centerOnSelf(); r.update(DT);
  out.recentre = { pannedPx: Math.round(before), afterPx: +(Math.hypot(r.focus.x - sx, r.focus.z - sz) * k).toFixed(2) };
  // respawn: self gone 5 s (death cam left 40 m away), back at the fountain
  const resp: Record<string, number> = {};
  for (const mode of ['locked', 'semi', 'free'] as const) {
    const q = mk(); q.setSelf(300, 300); q.setMode(mode); q.update(DT);
    q.setSelf(null, null); q.focusOn(260, 300); for (let t = 0; t < 5; t += DT) q.update(DT);
    q.setSelf(20, 380); q.update(DT);
    resp[mode] = +(Math.hypot(q.focus.x - 20, q.focus.z - 380) * k).toFixed(1);
    if (resp[mode] > 1) fails.push(`respawn ${mode}: focus ${resp[mode]} px off the fighter on the first frame`);
  }
  out.respawnOffPx = resp;
  if (!out.lockedDefault) fails.push('locked is not the default mode');
  if (lag > 0.5) fails.push(`locked follow lag ${lag.toFixed(1)} px`);
  if ((out.lockToggle as { afterPx: number }).afterPx > 0.5) fails.push('lock toggle does not land on the fighter');
  if ((out.recentre as { afterPx: number }).afterPx > 0.5) fails.push('re-centre does not land on the fighter');
  report.rig = out;
  console.log('rig', JSON.stringify(out));
}

// ── motion ───────────────────────────────────────────────────────────────────────────────────────────────
if (ONLY.has('motion')) {
  const rows: Record<string, unknown>[] = [];
  console.log('foot slip (run, base moveSpeed): planted-foot world speed; runRef that plants it');
  for (const f of fighters) {
    const file = modelFile(f.art.model);
    if (!existsSync(file)) continue;
    const { scene, clips } = await load(file);
    const run = clips.find((c) => c.name === (f.art.clips?.run ?? 'run'));
    const feet = [f.art.sockets?.foot_l, f.art.sockets?.foot_r].filter((x): x is string => !!x);
    const tracks = run ? footTracks(scene, run, feet, f.art.scale ?? 1) : null;
    if (!run || !tracks) { rows.push({ fighter: f.id, skipped: !run ? 'no run clip' : 'no foot sockets' }); continue; }
    const stance = stanceVelocities(tracks, run.duration);
    const speed = f.base.moveSpeed as number, authored = f.art.runRefSpeed as number;
    const measured = plantedRunRef(scene, run, feet, f.art.scale ?? 1);
    const med = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
    // the planted foot's world speed: the body moves +z (model forward) at `speed`, the clip plays at speed / runRef
    const slipAt = (ref: number): number => { const rate = Math.max(0.35, Math.min(2.2, speed / Math.max(0.1, ref))); return med(stance.map((q) => Math.hypot(q.vx * rate, speed + q.vz * rate))); };
    const used = measured !== null && measured > authored * 0.6 && measured < authored * 1.6 ? measured : authored;
    const before = slipAt(authored), after = slipAt(used);
    const row = { fighter: f.id, moveSpeed: speed, runRefAuthored: authored, runRefMeasured: measured === null ? null : +measured.toFixed(3), runRefUsed: +used.toFixed(3), stanceSamples: stance.length,
      plantedMpsAuthored: +before.toFixed(3), slipPctAuthored: +(100 * before / speed).toFixed(1), plantedMps: +after.toFixed(3), slipPct: +(100 * after / speed).toFixed(1) };
    rows.push(row);
    console.log(`  ${f.id.padEnd(8)} speed ${speed}  runRef ${authored} → ${used.toFixed(2)}  planted foot ${before.toFixed(2)} → ${after.toFixed(2)} m/s (${row.slipPctAuthored} → ${row.slipPct} % of speed)`);
  }
  // turn: drawn heading for a 180° and a 90° order (the sim heading flips in one tick)
  const turn: Record<string, unknown> = {};
  for (const deg of [180, 90, 30]) {
    let cur = 0; const target = deg * Math.PI / 180 - 1e-6;
    let t = 0, peak = 0, within: number | null = null;
    for (let i = 0; i < 120; i++) {
      const prev = cur; cur = turnToward(cur, target, 1 / 60); t += 1 / 60;
      peak = Math.max(peak, Math.abs(cur - prev) * 60 * 180 / Math.PI);
      if (within === null && Math.abs(target - cur) * 180 / Math.PI <= 5) within = t;
    }
    turn[`deg${deg}`] = { msTo5deg: within === null ? null : Math.round(within * 1000), peakDegPerS: Math.round(peak), meanDegPerS: within ? Math.round((deg - 5) / within) : null };
  }
  for (const r of rows) if (typeof r.slipPct === 'number' && r.slipPct > 10) fails.push(`foot slip ${r.fighter}: ${r.slipPct} % of moveSpeed > 10 %`);
  report.motion = { foot: rows, turn, simTurn: 'instant (src/sim movement.ts sets facing per tick: a 180° turn in one 33 ms tick)' };
  console.log('turn (drawn)', JSON.stringify(turn));
}

report.pass = fails.length === 0;
report.fails = fails;
report.warns = warns;
for (const x of warns) console.log('WARN', x);
writeFileSync(OUT, JSON.stringify(report, null, 1));
for (const x of fails) console.log('FAIL', x);
console.log(fails.length ? `camera FAIL (${fails.length})` : 'camera PASS', '→', OUT);
process.exit(fails.length ? 1 : 0);
