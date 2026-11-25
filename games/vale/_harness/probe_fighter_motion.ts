// VALE probe — orch1 W3-B (FU-7 / FU-9, ruling 68): fighter locomotion blend and CC bodies, on the shipped GLBs (textures
// stripped) in node with the real blend math (src/render/stride.ts) and three's AnimationMixer.
//
//   budget   every fighter base and skin GLB <= 1172 KiB; every base GLB carries a `walk` clip
//   walk     the walk clip's planted-foot speed (measureStride over LOCO.walkRange) and the planted foot's world speed while
//            the body moves at 0.25 / 0.4 / 0.55 x runRef (walk alone): gate <= 10 % of the body's speed (stride.ts bar)
//   blend    run and walk on the shared phase (locoCycleRate, walkWeight) at 0.57 / 0.6 / 0.63 x runRef: the planted foot's
//            world speed (median over the stance samples of the blended pose); gate <= LOCO.blendSlipMax (15 %). A body
//            whose blend slips past it at walk weight 0.8 switches at the band's middle instead (as the renderer decides)
//   phase    the left foot's touchdown (stride.ts touchdown) in run and in walk on the shared phase (the walk offset by the
//            renderer's walkPhase): gate |run - walk| <= 0.03 of a cycle
//   pop      a ramp 0.85 -> 0.25 -> 0.85 x runRef over 3 s at 60 Hz (the renderer's eased weight): the largest jump in the
//            hips' and feet's frame-to-frame velocity, against the steady gaits' (run at 0.85, walk at walkFull x runRef): gate <= 1.25 x
//   cc       the dominant CC order (contracts/sim.ts ccKindOf): stun over root, airborne over stun, the longer of a tie
//
//   node _harness/probe_fighter_motion.ts [--dir <art out fighters dir>] [--only budget,walk,blend,phase,pop,cc] [--out <json>]
//   → _harness/_reports/w3b_fighter_motion.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { type AnimationClip, AnimationMixer, type Object3D, PropertyBinding, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { blendFootTracks, blendSlipPct, footTracks, LOCO, locoCycleRate, measureStride, STRIDE, stanceVelocities, walkWeight } from '../src/render/stride.ts';
import { ccKindOf, type StatusView } from '../src/contracts/sim.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const DIR = arg('dir', join(ROOT, 'art', 'out', 'fighters'));
const OUT = arg('out', join(HERE, '_reports', 'w3b_fighter_motion.json'));
const ONLY = new Set(arg('only', 'budget,walk,blend,phase,pop,cc').split(','));
const BUDGET_KIB = 1172;
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
const med = (a: number[]): number => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : NaN; };
const r3 = (x: number): number => +x.toFixed(3);

const fails: string[] = [];
const report: Record<string, unknown> = { at: new Date().toISOString(), dir: DIR, loco: LOCO };
const fighters = readdirSync(join(ROOT, 'content', 'fighters')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'content', 'fighters', f), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id));
const fileOf = (ref: string): string => join(DIR, ref.replace(/^assets\/fighters\//, ''));

const rows: Record<string, unknown>[] = [];
for (const f of fighters) {
  const row: Record<string, unknown> = { fighter: f.id };
  rows.push(row);
  const base = fileOf(f.art.model);
  if (ONLY.has('budget')) {
    const skins = JSON.parse(readFileSync(join(ROOT, 'content', 'skins', `${f.id}.json`), 'utf8')) as { id: string; model: string }[];
    const sizes: Record<string, number> = {};
    for (const m of new Set([f.art.model, ...skins.map((s) => s.model)])) {
      const p = fileOf(m);
      if (!existsSync(p)) continue;
      const kib = statSync(p).size / 1024;
      sizes[m.split('/').pop()!] = +kib.toFixed(1);
      if (kib > BUDGET_KIB) fails.push(`budget ${m}: ${kib.toFixed(1)} KiB > ${BUDGET_KIB}`);
    }
    row.kib = sizes;
  }
  if (!existsSync(base)) { row.skipped = 'no base GLB'; continue; }
  const { scene, clips } = await load(base);
  const run = clips.find((c) => c.name === (f.art.clips?.run ?? 'run'));
  const walk = clips.find((c) => c.name === 'walk');
  if (ONLY.has('budget') && !walk) fails.push(`walk ${f.id}: no walk clip in ${f.art.model}`);
  if (!run || !walk) { row.skipped = !run ? 'no run' : 'no walk'; continue; }
  const feet = [f.art.sockets?.foot_l, f.art.sockets?.foot_r].filter((x): x is string => !!x);
  const sc = f.art.scale ?? 1;
  const rm = measureStride(scene, run, feet, sc), wm = measureStride(scene, walk, feet, sc, LOCO.walkRange);
  const runRef = rm?.ref ?? f.art.runRefSpeed, walkRef = wm?.ref ?? null;
  // the renderer's walk phase offset (actors.ts fighterTemplate): the walk's touchdown minus the run's
  const off = rm && wm ? (((wm.touchdown - rm.touchdown) % 1) + 1) % 1 : 0;
  row.runRef = r3(runRef); row.walkRef = walkRef === null ? null : r3(walkRef); row.walkS = r3(walk.duration); row.runS = r3(run.duration); row.walkPhase = r3(off);
  if (walkRef === null) { fails.push(`walk ${f.id}: walkRef not measurable`); continue; }
  const runC = { ref: runRef, dur: run.duration }, walkC = { ref: walkRef, dur: walk.duration };
  if (ONLY.has('walk')) {
    const st = stanceVelocities(footTracks(scene, walk, feet, sc)!, walk.duration);
    const out: Record<string, number> = {};
    for (const k of [0.25, 0.4, 0.55]) {
      const speed = k * runRef;
      const rate = locoCycleRate(speed, runC, walkC, walkWeight(k)) * walk.duration;     // clip playback rate (x)
      const slip = med(st.map((q) => Math.hypot(q.vx * rate, speed + q.vz * rate)));
      out[`r${k}`] = +(100 * slip / speed).toFixed(1);
      if (100 * slip / speed > 10) fails.push(`walk slip ${f.id} at ${k} runRef: ${(100 * slip / speed).toFixed(1)} % > 10 %`);
    }
    row.walkSlipPct = out;
  }
  // the renderer's choice (actors.ts fighterTemplate): blend, or switch at the band's middle when the blend slips
  const pw = LOCO.blendProbeW, pk = LOCO.walkEdge - pw * (LOCO.walkEdge - LOCO.walkFull);
  const ptr = blendFootTracks(scene, run, walk, pw, feet, sc, off);
  const probe = ptr ? blendSlipPct(ptr, pk, pw, runC, walkC) : Infinity;
  const sw = probe > LOCO.blendSlipMax;
  if (ONLY.has('blend')) {
    const out: Record<string, number | string> = { mode: sw ? 'switch' : 'blend', probeW08: +probe.toFixed(1) };
    if (!sw) for (const k of [0.57, 0.6, 0.63]) {
      const w = walkWeight(k);
      const tr = blendFootTracks(scene, run, walk, w, feet, sc, off);
      if (!tr) continue;
      const slip = blendSlipPct(tr, k, w, runC, walkC);
      out[`r${k}`] = +slip.toFixed(1);
      if (slip > LOCO.blendSlipMax) fails.push(`blend slip ${f.id} at ${k} runRef: ${slip.toFixed(1)} % > ${LOCO.blendSlipMax} %`);
    }
    row.blend = out;
  }
  if (ONLY.has('phase')) {
    const down = (clip: AnimationClip): number => {
      const t = footTracks(scene, clip, feet, sc)!;
      const L = t[0];
      let minY = Infinity; for (const q of L) minY = Math.min(minY, q.y);
      // touchdown: the start of the longest (cyclic) run of samples in the stance band
      const N = STRIDE.samples, inb = (i: number): boolean => L[((i % N) + N) % N].y <= minY + STRIDE.stanceBand;
      let best = 0, at = 0;
      for (let i = 0; i < N; i++) {
        if (!inb(i) || inb(i - 1)) continue;
        let n = 0; while (n < N && inb(i + n)) n++;
        if (n > best) { best = n; at = i; }
      }
      return at / N;
    };
    // on the shared phase the walk plays at (phase + off): its touchdown there
    const a = down(run), b = (((down(walk) - off) % 1) + 1) % 1;
    let d = Math.abs(a - b); d = Math.min(d, 1 - d);
    row.touchdown = { run: r3(a), walkRaw: r3(down(walk)), walkOnPhase: r3(b), diff: r3(d) };
    if (d > 0.03) fails.push(`phase ${f.id}: left touchdown run ${a.toFixed(3)} vs walk ${b.toFixed(3)} on the shared phase (${d.toFixed(3)} of a cycle) > 0.03`);
  }
  if (ONLY.has('pop')) {
    // the renderer's blend driven frame by frame (actors.ts animate: shared phase, run weight 1 - w, walk weight w)
    scene.scale.setScalar(sc);
    const names = ['hips', ...feet];
    const nodes = names.map((b) => scene.getObjectByName(PropertyBinding.sanitizeNodeName(b)) ?? scene.getObjectByName(b)!);
    const mixer = new AnimationMixer(scene);
    const a = mixer.clipAction(run), b = mixer.clipAction(walk);
    a.play(); b.play();
    let lw = -1;
    const step = (k: number, ph: number, dt: number): number => {
      const target = sw ? (k < (LOCO.walkFull + LOCO.walkEdge) / 2 ? 1 : 0) : walkWeight(k), speed = k * runRef;
      const rate = dt * (sw ? LOCO.switchRate : LOCO.wRate);
      lw = lw < 0 ? target : lw + Math.max(-rate, Math.min(rate, target - lw));
      const w = lw;
      ph = (ph + dt * locoCycleRate(speed, runC, walkC, w)) % 1;
      a.setEffectiveWeight(1 - w); b.setEffectiveWeight(w);
      a.time = ph * run.duration; b.time = ((ph + off) % 1) * walk.duration;
      mixer.update(0); scene.updateMatrixWorld(true);
      return ph;
    };
    const move = (ks: number[]): number => {
      // a pop is a jump in a point's frame-to-frame velocity: the largest |d(t) - d(t-1)| of the hips and feet (model frame)
      let ph = 0, prev: Vector3[] | null = null, dPrev: Vector3[] | null = null, mx = 0;
      lw = -1;
      for (const k of ks) {
        ph = step(k, ph, 1 / 60);
        const cur = nodes.map((n) => n.getWorldPosition(new Vector3()));
        if (prev) {
          const d = cur.map((c, i) => c.clone().sub(prev![i]));
          if (dPrev) for (let i = 0; i < d.length; i++) mx = Math.max(mx, d[i].distanceTo(dPrev[i]));
          dPrev = d;
        }
        prev = cur;
      }
      return mx;
    };
    // the steady gaits the ramp passes through: the run at 0.85 and the walk at its fastest (walkFull) x runRef
    const steady = Math.max(move(Array.from({ length: 120 }, () => 0.85)), move(Array.from({ length: 120 }, () => LOCO.walkFull)));
    const ramp = move(Array.from({ length: 180 }, (_, i) => { const u = i / 179; return 0.85 - 0.6 * Math.sin(Math.PI * u); }));
    mixer.stopAllAction(); mixer.uncacheRoot(scene);
    row.pop = { steadyMm: +(steady * 1000).toFixed(1), rampMm: +(ramp * 1000).toFixed(1), ratio: +(ramp / steady).toFixed(2) };
    if (ramp > steady * 1.25) fails.push(`pop ${f.id}: ramp frame move ${(ramp * 1000).toFixed(1)} mm > 1.25 x steady ${(steady * 1000).toFixed(1)} mm`);
  }
  console.log(`  ${f.id.padEnd(8)} ${JSON.stringify(Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'fighter')))}`);
}
report.fighters = rows;

if (ONLY.has('cc')) {
  const s = (kind: string, remaining: number): StatusView => ({ kind, remaining, duration: 2, power: 0 }) as StatusView;
  const cases: [StatusView[], string | null][] = [
    [[s('root', 2), s('stun', 1)], 'stun'], [[s('stun', 1), s('airborne', 0.5)], 'airborne'], [[s('slow', 3), s('silence', 1)], 'silence'],
    [[s('fear', 1), s('fear', 2)], 'fear'], [[s('haste', 2), s('reveal', 1)], null], [[s('taunt', 1), s('root', 2)], 'taunt'], [[s('sleep', 1)], 'sleep'],
  ];
  const got = cases.map(([st, want]) => ({ want, got: ccKindOf({ statuses: st }) }));
  report.cc = got;
  for (const g of got) if (g.got !== g.want) fails.push(`ccKindOf: ${g.got} for ${g.want}`);
  console.log('cc order', JSON.stringify(got));
}

report.fails = fails;
writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(fails.length ? `fighter_motion FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'fighter_motion PASS', '→', OUT);
process.exit(fails.length ? 1 : 0);
