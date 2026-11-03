// VALE probe — CW1 combat:bar-clearance: is a fighter's focal prop parked under its OWN overhead bar?
//
// Pure geometry on the shipped GLBs (art/out/fighters/<id>/<id>.glb, textures stripped so three's GLTFLoader parses in
// node) and the real camera (src/render/camera.ts CameraRig at 1920×1080, the default distance and the closing
// review's 28.5 m). For each gated prop, its vertices (the ones skinned mostly to the prop's bone or a child of it) are
// posed through the idle and run clips (24 samples each), turned through 8 facings and projected; a case is
// "half-covered" when ≥ 50 % of the prop's projected vertices fall inside the bar plate or its level chip
// (src/render/bar_clearance.ts BAR_BOX, measured as the closing kemdo verifier did) around the anchor. The anchor is the
// one the renderer now uses (bar_clearance.ts fighterBarAnchor) and, for reference, the old art.height + 0.35 m.
//
// Gate (closing plan, CW1 done): Kemdo's lens, Dunsom's lantern, Hesmi's rack top, Vashil's halo ring and Tunlan's hat
// brim are half-covered in ≤ 10 % of idle cases and ≤ 10 % of run cases, at the default distance and at 28.5 m.
// polish hesmi-m3: Hesmi's rack top also ≤ 10 % over her attack clips (every prop's attack row is reported). Info:
// `deep`, the most px a covered prop vertex sits above the plate's lower edge in idle/run (TUN-c2: the under-panel on
// the far brim), and every other fighter's computed lift over the old anchor.
//
//   node _harness/probe_bar_clearance.ts [--out <json>]   → _harness/_reports/fw_CW1_bar_clearance.json; exit 0 = PASS
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { type AnimationClip, AnimationMixer, type Bone, type Object3D, type SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CAMERA, CameraRig } from '../src/render/camera.ts';
import { BAR_BOX, BAR_CLEAR, fighterBarAnchor } from '../src/render/bar_clearance.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const oi = process.argv.indexOf('--out');
const OUT = oi > 0 ? process.argv[oi + 1] : join(HERE, '_reports', 'fw_CW1_bar_clearance.json');
mkdirSync(dirname(OUT), { recursive: true });

const req = createRequire(join(ROOT, 'package.json'));
const { NodeIO } = await import(req.resolve('@gltf-transform/core')) as typeof import('@gltf-transform/core');
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions')) as typeof import('@gltf-transform/extensions');
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** the gated props: fighter → the bone the prop is skinned to (the probe's own list: a harness may name content) */
const PROPS: Record<string, { bone: string; what: string; attackGate?: boolean }> = {
  kemdo: { bone: 'x_lens', what: 'lens' },
  dunsom: { bone: 'x_lantern', what: 'lantern' },
  hesmi: { bone: 'x_rack_top', what: 'rack top', attackGate: true },
  vashil: { bone: 'x_halo', what: 'halo ring' },
  tunlan: { bone: 'x_hat', what: 'hat brim' },
};
const W = 1920, H = 1080, FACINGS = 8, SAMPLES = 24;

async function load(file: string): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  const doc = await io.read(file);
  for (const t of doc.getRoot().listTextures()) t.dispose();
  const glb = await io.writeBinary(doc);
  const ab = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const g = await new Promise<{ scene: Object3D; animations: AnimationClip[] }>((res, rej) => new GLTFLoader().parse(ab, '', res as never, rej));
  return { scene: g.scene, clips: g.animations };
}

function rig(distance: number): CameraRig {
  const r = new CameraRig(W / H);
  r.setViewport(W, H);
  r.setBounds(400, 400, 0);
  r.mode = 'free';
  r.setZoom(distance);
  r.focusOn(200, 200);
  r.update(1 / 60);
  return r;
}

/** prop vertices: dominant joint is the bone or a descendant; fallback: within 0.25 m of the bone at rest */
function propVerts(scene: Object3D, boneName: string): { m: SkinnedMesh; idx: number[] }[] {
  scene.updateMatrixWorld(true);
  const out: { m: SkinnedMesh; idx: number[] }[] = [];
  const bone = scene.getObjectByName(boneName);
  if (!bone) return out;
  const under = (b: Object3D | null): boolean => { for (let o = b; o; o = o.parent) if (o === bone) return true; return false; };
  const v = new Vector3(), bp = new Vector3();
  bone.getWorldPosition(bp);
  scene.traverse((n) => {
    const m = n as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    const idx: number[] = [], near: number[] = [];
    for (let i = 0; i < si.count; i++) {
      let best = -1, bw = -1;
      for (let c = 0; c < 4; c++) { const w = sw.getComponent(i, c); if (w > bw) { bw = w; best = si.getComponent(i, c); } }
      if (under(m.skeleton.bones[best] as Bone)) idx.push(i);
      else if (m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).distanceTo(bp) < 0.25) near.push(i);
    }
    const use = idx.length ? idx : near;
    if (use.length) out.push({ m, idx: use });
  });
  return out;
}

interface Case { idle: number; run: number; idleMean: number; runMean: number; attack?: number; attackMean?: number; attackClips?: number; brimPx?: number }
function coverage(scene: Object3D, clips: AnimationClip[], verts: { m: SkinnedMesh; idx: number[] }[], anchor: number, distance: number, attacks: string[] = []): Case {
  const r = rig(distance), cam = r.camera;
  const v = new Vector3();
  const px = (p: Vector3): [number, number] => { p.project(cam); return [(p.x + 1) * W / 2, (1 - p.y) * H / 2]; };
  const [ax, ay] = px(new Vector3(200, anchor, 200));
  const inBox = (x: number, y: number): boolean => { const dx = x - ax, dy = y - ay; return dx >= BAR_BOX.left && dx <= BAR_BOX.right && dy >= -BAR_BOX.above && dy <= BAR_BOX.below; };
  const mixer = new AnimationMixer(scene);
  const res: Record<string, { half: number; mean: number }> = {};
  // polish hesmi-m3 / TUN-c2: the attack clips pooled into one more row; `deep` = the most px a covered prop vertex
  // sits above the plate's lower edge (the under-panel's overlap on a brim), over idle and run
  let deep = 0;
  const groups: [string, string[]][] = [['idle', ['idle']], ['run', ['run']], ['attack', attacks]];
  for (const [role, names] of groups) {
    const list = names.map((nm) => clips.find((c) => c.name === nm)).filter((c): c is AnimationClip => !!c);
    if (!list.length) { res[role] = { half: NaN, mean: NaN }; continue; }
    let half = 0, n = 0, sum = 0;
    for (const clip of list) {
    mixer.stopAllAction();
    const act = mixer.clipAction(clip); act.reset(); act.play();
    for (let k = 0; k < SAMPLES; k++) {
      act.time = clip.duration * k / SAMPLES; mixer.update(0); scene.updateMatrixWorld(true);
      const pts: number[] = [];
      for (const e of verts) for (const i of e.idx) { e.m.getVertexPosition(i, v).applyMatrix4(e.m.matrixWorld); pts.push(v.x, v.y, v.z); }
      for (let a = 0; a < FACINGS; a++) {
        const th = 2 * Math.PI * a / FACINGS, c = Math.cos(th), s = Math.sin(th);
        let inside = 0;
        for (let i = 0; i < pts.length; i += 3) {
          const [sx, sy] = px(v.set(200 + c * pts[i] + s * pts[i + 2], pts[i + 1], 200 - s * pts[i] + c * pts[i + 2]));
          if (inBox(sx, sy)) { inside++; if (role !== 'attack') deep = Math.max(deep, ay + BAR_BOX.below - sy); }
        }
        const f = inside / (pts.length / 3);
        sum += f; n++; if (f >= 0.5) half++;
      }
    }
    }
    res[role] = { half: half / n, mean: sum / n };
  }
  mixer.stopAllAction();
  const out: Case = { idle: +res.idle.half.toFixed(3), run: +res.run.half.toFixed(3), idleMean: +res.idle.mean.toFixed(3), runMean: +res.run.mean.toFixed(3), brimPx: +deep.toFixed(1) };
  if (attacks.length) Object.assign(out, { attack: +res.attack.half.toFixed(3), attackMean: +res.attack.mean.toFixed(3), attackClips: attacks.length });
  return out;
}

const ids = readdirSync(join(ROOT, 'content', 'fighters')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort();
const report: Record<string, unknown> = { at: new Date().toISOString(), distance: CAMERA.distance, box: BAR_BOX, clear: BAR_CLEAR, fighters: {} };
const fails: string[] = [];
const fmt = (c: Case): string => `idle ${(c.idle * 100).toFixed(0).padStart(3)}% run ${(c.run * 100).toFixed(0).padStart(3)}%`;
for (const id of ids) {
  const def = JSON.parse(readFileSync(join(ROOT, 'content', 'fighters', `${id}.json`), 'utf8'));
  const file = join(ROOT, 'art', 'out', def.art.model.replace(/^assets\//, ''));
  if (!existsSync(file)) { console.log(`skip ${id}: no ${file}`); continue; }
  const { scene, clips } = await load(file);
  const roles = def.art.clips ?? {};
  const pick = (r: string): AnimationClip | undefined => clips.find((c) => c.name === (roles[r] ?? r));
  const floor = def.art.height * def.art.scale + BAR_CLEAR.gap;
  const t0 = performance.now();
  const anchor = fighterBarAnchor(scene, [pick('idle'), pick('run')].filter((c): c is AnimationClip => !!c), def.art.sockets ?? {}, floor, def.art.scale, { pitchDeg: CAMERA.pitchDeg, fovDeg: CAMERA.fovDeg, distance: CAMERA.distance, viewH: H });
  const ms = performance.now() - t0;
  const row: Record<string, unknown> = { floor: +floor.toFixed(3), anchor: +anchor.toFixed(3), lift: +(anchor - floor).toFixed(3), computeMs: +ms.toFixed(1) };
  const prop = PROPS[id];
  let line = `${id.padEnd(8)} anchor ${anchor.toFixed(2)} m (old ${floor.toFixed(2)}, +${(anchor - floor).toFixed(2)}) ${ms.toFixed(0)} ms`;
  if (prop) {
    const verts = propVerts(scene, prop.bone);
    const nv = verts.reduce((a, e) => a + e.idx.length, 0);
    if (!nv) { fails.push(`${id}: no vertices for ${prop.bone}`); line += ` NO ${prop.bone}`; }
    else {
      const out: Record<string, Case> = {};
      // the attack clips (roles attack*, the fighter's basic-attack swings) by their clip names
      const attacks = [...new Set(Object.entries(roles).filter(([r]) => /^attack/.test(r)).map(([, n]) => n as string))].filter((n) => clips.some((c) => c.name === n));
      for (const [k, d, a] of [['new', CAMERA.distance, anchor], ['new_28.5', 28.5, anchor], ['old', CAMERA.distance, floor], ['old_28.5', 28.5, floor]] as [string, number, number][]) out[k] = coverage(scene, clips.map((c) => c.name === (roles.idle ?? 'idle') ? Object.assign(c.clone(), { name: 'idle' }) : c.name === (roles.run ?? 'run') ? Object.assign(c.clone(), { name: 'run' }) : c), verts, a, d, attacks);
      row.prop = { ...prop, verts: nv, ...out };
      const atk = (c: Case): string => (c.attack !== undefined ? ` atk ${(c.attack * 100).toFixed(0).padStart(3)}%` : '');
      line += `  ${prop.what}: new ${fmt(out.new)}${atk(out.new)} deep ${out.new.brimPx} px | @28.5 ${fmt(out['new_28.5'])}${atk(out['new_28.5'])} | old ${fmt(out.old)}${atk(out.old)} deep ${out.old.brimPx} px`;
      for (const k of ['new', 'new_28.5']) for (const r of ['idle', 'run'] as const) if (!(out[k][r] <= 0.1)) fails.push(`${id} ${prop.what} ${k} ${r} half-covered ${(out[k][r] * 100).toFixed(1)} % > 10 %`);
      // polish hesmi-m3: the rack top clears the bar through her swings too
      if (prop.attackGate) for (const k of ['new', 'new_28.5']) if (!((out[k].attack ?? 0) <= 0.1)) fails.push(`${id} ${prop.what} ${k} attack half-covered ${((out[k].attack ?? 0) * 100).toFixed(1)} % > 10 %`);
    }
  }
  (report.fighters as Record<string, unknown>)[id] = row;
  console.log(line);
}
report.pass = fails.length === 0;
report.fails = fails;
writeFileSync(OUT, JSON.stringify(report, null, 1));
for (const f of fails) console.log('FAIL', f);
console.log(fails.length ? `bar clearance FAIL (${fails.length})` : 'bar clearance PASS', '→', OUT);
process.exit(fails.length ? 1 : 0);
