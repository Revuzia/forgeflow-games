// VALE probe — orch1 W3-B (FU-8): the line of action of every fighter's attack and cast clips, read from the SHIPPED GLBs
// (textures stripped) with three's AnimationMixer at 30 fps, in the model's frame (+z forward, y up).
//
//   twist    shoulder-line yaw (upper_arm.L -> upper_arm.R in plan view) against frame 0: the counter-twist is the largest
//            turn AWAY from the impact's turn before the impact frame (deg; a clip with no turn of its own at the impact,
//            under 3 deg, counts its largest wind-up turn either way); `swingDeg` the turn from there to the impact
//   tip      the weapon tip (art sockets weapon_tip, else weapon, else hand.R): `strikeM` its path from the wind-up's far
//            point (the pre-impact frame farthest from the impact position) to the impact; `peakAt` the clip share of its
//            fastest frame
//   hold     frames from the impact on with the tip moving under 1.5 cm a frame (the impact pose held)
// The impact is at 40 % of the clip (CONTRACT §12, anim.py IMPACT). Gates (FU-8; `--report` only reports): on the clips
// listed in RE_KEYED, counter-twist >= 20 deg, strike >= 1.2 m on melee autos (attack range <= 2.2 m), impact held >= 2
// frames (W3-B adds 2; an ult that held longer keeps it). The impact itself stays at 40 % (the re-key never moves a frame
// before it). The roster's worst 30 % per fighter is listed (ults first).
//
//   node _harness/probe_clip_line.ts [--report] [--only <fighter,...>] [--dir <fighters dir>] [--out <json>]   → _harness/_reports/w3b_clip_line.json
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { type AnimationClip, AnimationMixer, type Object3D, PropertyBinding, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const arg = (k: string, d: string): string => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('out', join(HERE, '_reports', 'w3b_clip_line.json'));
const DIR = arg('dir', join(ROOT, 'art', 'out', 'fighters'));
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const GATE = !process.argv.includes('--report');
/** the clips W3-B re-keyed (fighter -> clips): the gates apply to these */
/** the clips W3-B re-keyed (fighter -> clips; anim.py LOA_REKEY, ruling 69): the gates apply to these. `twistNA`: re-keyed for
 *  the impact hold alone (a bow draw: the shoulder line does not read a wind-up turn) or whose shoulder line does not answer
 *  the twist (Ervet's ult, arms locked overhead): the counter-twist gate is reported, not applied */
export const RE_KEYED: Record<string, string[]> = { ardit: ['cast_ult', 'attack2'], burdam: ['attack1', 'cast_a1'], dunsom: ['cast_ult', 'attack1'], ervet: ['cast_ult', 'cast_a3'], hesmi: ['cast_ult', 'cast_a3'], ilsheta: ['cast_ult', 'attack2'], kemdo: ['cast_ult', 'cast_a2'], lisvel: ['cast_ult', 'attack1'], marund: ['cast_ult', 'cast_a2'], nurrow: ['cast_ult', 'cast_a1'], odrum: ['cast_ult', 'cast_a3'], rishal: ['cast_ult', 'crit'], sukri: ['cast_ult', 'attack1'], tunlan: ['cast_ult', 'cast_a3'], ulkro: ['cast_ult', 'cast_a2'], vashil: ['cast_ult', 'cast_a2'] };
const TWIST_NA = new Set(['lisvel/attack1', 'ervet/cast_ult']);
/** a melee re-keyed auto whose weapon is fists or daggers (no blade to sweep 1.2 m): reported, not gated */
const STRIKE_NA = new Set(['rishal/crit', 'ardit/attack2']);
const CLIPS = ['cast_ult', 'attack1', 'attack2', 'crit', 'cast_a1', 'cast_a2', 'cast_a3'];
const IMPACT = 0.4;
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
const node = (s: Object3D, n: string): Object3D | undefined => s.getObjectByName(PropertyBinding.sanitizeNodeName(n)) ?? s.getObjectByName(n);
const r1 = (x: number): number => +x.toFixed(1), r2 = (x: number): number => +x.toFixed(2);

const fighters = readdirSync(join(ROOT, 'content', 'fighters')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(ROOT, 'content', 'fighters', f), 'utf8'))).sort((a, b) => a.id.localeCompare(b.id))
  .filter((f) => !ONLY || ONLY.has(f.id));
const fails: string[] = [];
const out: Record<string, unknown> = {};
for (const f of fighters) {
  const file = join(DIR, f.art.model.replace(/^assets\/fighters\//, ''));
  if (!existsSync(file)) continue;
  const { scene, clips } = await load(file);
  const S = f.art.sockets ?? {};
  const tipN = node(scene, S.weapon_tip ?? S.weapon ?? 'hand.R') ?? node(scene, 'hand.R')!;
  const uaL = node(scene, 'upper_arm.L')!, uaR = node(scene, 'upper_arm.R')!;
  const melee = (f.attack?.range ?? 9) <= 2.2;
  const rows: Record<string, unknown>[] = [];
  for (const role of CLIPS) {
    const name = f.art.clips?.[role] ?? role;
    const clip = clips.find((c) => c.name === name);
    if (!clip) continue;
    const mixer = new AnimationMixer(scene);
    const act = mixer.clipAction(clip); act.play();
    const N = Math.max(2, Math.round(clip.duration * 30));
    const tip: Vector3[] = [], yaw: number[] = [];
    for (let i = 0; i <= N; i++) {
      act.time = Math.min(clip.duration, i / 30); mixer.update(0); scene.updateMatrixWorld(true);
      tip.push(tipN.getWorldPosition(new Vector3()));
      const a = uaL.getWorldPosition(new Vector3()), b = uaR.getWorldPosition(new Vector3());
      yaw.push(Math.atan2(b.z - a.z, b.x - a.x) * 180 / Math.PI);
    }
    act.stop(); mixer.uncacheRoot(scene);
    const imp = Math.round(IMPACT * N);
    const rel = yaw.map((y) => { let d = y - yaw[0]; while (d > 180) d -= 360; while (d < -180) d += 360; return d; });
    // a clip with no turn of its own at the impact (under 3 deg: a raise) counts a wind-up turn either way
    const flat = Math.abs(rel[imp]) < 3, sgn = Math.sign(rel[imp]) || 1;
    let counter = 0, cAt = 0;
    for (let i = 0; i <= imp; i++) { const c = flat ? Math.abs(rel[i]) : -rel[i] * sgn; if (c > counter) { counter = c; cAt = i; } }
    const swing = Math.abs(rel[imp] - rel[cAt]);
    let far = 0, farAt = 0;
    for (let i = 0; i < imp; i++) { const d = tip[i].distanceTo(tip[imp]); if (d > far) { far = d; farAt = i; } }
    let strike = 0; for (let i = farAt; i < imp; i++) strike += tip[i].distanceTo(tip[i + 1]);
    let peak = 0, peakAt = 0; for (let i = 0; i < N; i++) { const v = tip[i].distanceTo(tip[i + 1]); if (v > peak) { peak = v; peakAt = i + 1; } }
    let hold = 0; for (let i = imp; i < N && tip[i].distanceTo(tip[i + 1]) < 0.015; i++) hold++;
    const row = { clip: role, frames: N, counterDeg: r1(counter), swingDeg: r1(swing), strikeM: r2(strike), peakAt: r2(peakAt / N), peakMps: r2(peak * 30), hold };
    rows.push(row);
    const keyed = RE_KEYED[f.id]?.includes(role);
    if (keyed) {
      const k = `${f.id}/${role}`;
      if (counter < 20 && !TWIST_NA.has(k)) fails.push(`${f.id} ${role}: counter-twist ${counter.toFixed(1)} deg < 20`);
      if (melee && (role.startsWith('attack') || role === 'crit') && strike < 1.2 && !STRIKE_NA.has(k)) fails.push(`${f.id} ${role}: strike ${strike.toFixed(2)} m < 1.2`);
      // the hold W3-B added is 2 frames; a clip that already held its impact longer (an ult's held pose) keeps it
      if (hold < 2) fails.push(`${f.id} ${role}: impact hold ${hold} frames (< 2)`);
    }
  }
  // the worst 30 % (at least one) by a line-of-action score: counter-twist share of 20 deg + strike share of 1.2 m (melee
  // autos) + 1 for a held impact; ults first on ties
  const score = (r: Record<string, number | string>): number => Math.min(1, (r.counterDeg as number) / 20) + (melee && String(r.clip).startsWith('attack') ? Math.min(1, (r.strikeM as number) / 1.2) : 1) + ((r.hold as number) >= 2 ? 1 : 0);
  const ranked = [...rows].sort((a, b) => score(a as never) - score(b as never) || (a.clip === 'cast_ult' ? -1 : b.clip === 'cast_ult' ? 1 : 0));
  const worst = ranked.slice(0, Math.max(1, Math.round(rows.length * 0.3))).map((r) => r.clip);
  out[f.id] = { melee, tip: tipN.name, clips: rows, worst30: worst, reKeyed: RE_KEYED[f.id] ?? [] };
  console.log(`${f.id.padEnd(8)} ${melee ? 'melee' : 'range'} worst ${worst.join(',')}`);
  for (const r of rows) console.log(`   ${String(r.clip).padEnd(9)} counter ${String(r.counterDeg).padStart(5)} swing ${String(r.swingDeg).padStart(5)} strike ${String(r.strikeM).padStart(5)} m peak@${r.peakAt} hold ${r.hold}`);
}
writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), fighters: out, fails }, null, 1));
console.log(fails.length ? `clip_line FAIL (${fails.length})\n  ${fails.join('\n  ')}` : 'clip_line PASS', '→', OUT);
process.exit(GATE && fails.length ? 1 : 0);
