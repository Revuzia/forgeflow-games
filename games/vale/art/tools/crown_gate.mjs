#!/usr/bin/env node
// VALE art: the crown gate for soft head coverings (owner ruling 7, _design/reviews/fixwaves/owner_rulings.md §7).
//
//   node art/tools/crown_gate.mjs                       # every fighter and skin GLB (art/out/fighters/*/*.glb)
//   node art/tools/crown_gate.mjs --units               # ... plus every unit GLB with a `head` joint (Wicks, wards,
//                                                       #     monsters; a unit without one is listed as skipped)
//   node art/tools/crown_gate.mjs art/out/fighters/kemdo [more .glb files or folders] [--json out.json] [--all-rows]
//
// Measure (the closing review's geo2.mjs method, closing_vashil_verify_crown.txt / closing_critic_crown_radius.txt):
// the bind-pose vertices whose strongest joint is `head` (every skinned primitive, three units, Y up), the top
// = their highest point; at d = 1, 3 and 5 cm under the top, the slice of those vertices within +-8 mm gives a
// width (x range) and a depth (z range), and the circle through the slice's edges and the top has the radius
//     R = ((min(width, depth) / 2)^2 + d^2) / (2 d).
// GATE (ruling 7): R at 3 cm >= 10 cm on every soft head covering (hood, cowl, wrap, soft cap whose top is the
// head's highest point), every skin. Also reported: R at 1 and 5 cm, the width at 5 cm and the dome ratio (the
// width at 5 cm over the head's widest slice), the CW5 Vashil target (R >= 12 cm, >= 19 cm wide 5 cm down).
// Hard parts (helmet ridges, visor blades, metal crowns, finials, hat brims) are not soft head coverings: they take
// the visual check only and are listed in HARD below with the reason; a hard top reports its numbers as `hard`.
// The visual check (from behind and three-quarter-behind at the 28.5 m gameplay camera, no peaked or pointed hood
// on any skin; a pale covering over a pale robe needs a dark break) is not automated here.
// Exit 1 when a soft covering fails (a WIP fighter fails the gate until its fix lands).
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..', '..');
const req = createRequire(join(GAME, 'package.json'));
const { NodeIO } = await import(req.resolve('@gltf-transform/core'));
const { ALL_EXTENSIONS } = await import(req.resolve('@gltf-transform/extensions'));

const GATE_R3 = 0.10;
const BAND = 0.008;
const DEPTHS = [0.01, 0.03, 0.05];
// ruling 7: hard tops take the visual check only (id prefix -> reason). Every skin of the fighter inherits it
// unless the skin is named on its own.
const HARD = {
  rishal: 'visor ridge blade (ruling 3 accent): a hard part',
  marund_long_evening: 'hat finial: a hard part',
};

// Units (Wicks, wards, monsters; --units): their `head` joint carries hard tops (horns, tusks, flames, finials, lamp
// cages), so they are measured and listed as `unit` (information for the visual check) unless named here as a soft
// head covering, which puts them under the gate.
const SOFT_UNITS = new Set([]);

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const jsonOut = opt('--json');
const allRows = args.includes('--all-rows');
const paths = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');

function glbs(p) {
  const s = statSync(p);
  if (s.isFile()) return p.endsWith('.glb') ? [p] : [];
  return readdirSync(p).flatMap((n) => glbs(join(p, n))).sort();
}
let files = paths.length ? paths.flatMap((p) => glbs(resolve(p))) : glbs(join(GAME, 'art', 'out', 'fighters'));
if (args.includes('--units') && existsSync(join(GAME, 'art', 'out', 'units'))) files = files.concat(glbs(join(GAME, 'art', 'out', 'units')));

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function hardReason(id) {
  const keys = Object.keys(HARD).sort((a, b) => b.length - a.length);
  const k = keys.find((x) => id === x || id.startsWith(x + '_'));
  return k ? HARD[k] : null;
}

async function measure(file) {
  const doc = await io.read(file);
  const root = doc.getRoot();
  const nodes = root.listNodes();
  const parent = new Map();
  for (const n of nodes) for (const c of n.listChildren()) parent.set(c, n);
  const world = (n) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...n.getTranslation()), new THREE.Quaternion(...n.getRotation()),
      new THREE.Vector3(...n.getScale()));
    const p = parent.get(n);
    return p ? world(p).multiply(m) : m;
  };
  const pts = [];
  let skinned = 0;
  for (const n of nodes) {
    const mesh = n.getMesh();
    const skin = n.getSkin();
    if (!mesh || !skin) continue;
    const joints = skin.listJoints();
    const names = joints.map((j) => j.getName());
    const ibm = skin.getInverseBindMatrices()?.getArray();
    if (!ibm) continue;
    // the bind pose: joint world x inverse bind (per joint; the skinned positions are in bind space)
    const M = joints.map((j, i) => world(j).clone().multiply(new THREE.Matrix4().fromArray(Array.from(ibm.slice(i * 16, i * 16 + 16)))));
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      const J = prim.getAttribute('JOINTS_0');
      const W = prim.getAttribute('WEIGHTS_0');
      if (!pos || !J || !W) continue;
      skinned++;
      const v = [0, 0, 0], j = [0, 0, 0, 0], w = [0, 0, 0, 0];
      for (let i = 0; i < pos.getCount(); i++) {
        J.getElement(i, j); W.getElement(i, w);
        let jb = -1, wb = 0;
        for (let k = 0; k < 4; k++) if (w[k] > wb) { wb = w[k]; jb = j[k]; }
        if (jb < 0 || names[jb] !== 'head') continue;
        pos.getElement(i, v);
        const p = new THREE.Vector3(...v).applyMatrix4(M[jb]);
        pts.push([p.x, p.y, p.z]);
      }
    }
  }
  if (!skinned) return { skipped: 'no skinned mesh' };
  if (pts.length < 20) return { skipped: 'no head joint (or no head-weighted vertices)' };
  const top = Math.max(...pts.map((p) => p[1]));
  const rows = [];
  for (const d of DEPTHS) {
    const s = pts.filter((p) => Math.abs(p[1] - (top - d)) < BAND);
    if (s.length < 3) { rows.push({ d, n: s.length }); continue; }
    const xs = s.map((p) => p[0]), zs = s.map((p) => p[2]);
    const w = Math.max(...xs) - Math.min(...xs), dp = Math.max(...zs) - Math.min(...zs);
    const m = Math.min(w, dp);
    rows.push({ d, n: s.length, width: +w.toFixed(3), depth: +dp.toFixed(3), R: +(((m / 2) ** 2 + d * d) / (2 * d)).toFixed(3) });
  }
  let wmax = 0;
  for (let y = top; y > top - 0.40; y -= 0.01) {
    const s = pts.filter((p) => Math.abs(p[1] - y) < BAND);
    if (s.length >= 3) wmax = Math.max(wmax, Math.max(...s.map((p) => p[0])) - Math.min(...s.map((p) => p[0])));
  }
  const r5 = rows.find((r) => r.d === 0.05);
  return { top: +top.toFixed(3), n: pts.length, rows, dome: r5?.width && wmax ? +(r5.width / wmax).toFixed(2) : null };
}

const out = [];
let fails = 0;
for (const f of files) {
  const id = basename(f, '.glb');
  let r;
  try {
    r = await measure(f);
  } catch (e) {
    r = { error: String(e?.message || e) };
  }
  const hard = hardReason(id);
  const r3 = r.rows?.find((x) => x.d === 0.03)?.R;
  let status;
  if (r.error) status = 'error';
  else if (r.skipped) status = 'skipped';
  else if (hard) status = 'hard';
  else if (f.includes(`${join('art', 'out', 'units')}`) && !SOFT_UNITS.has(id)) status = 'unit';
  else if (r3 == null) status = 'pass';          // the head ends within 3 cm of its top: no crown to speak of
  else status = r3 >= GATE_R3 ? 'pass' : 'FAIL';
  if (status === 'FAIL' || status === 'error') fails++;
  out.push({ id, file: relative(GAME, f), status, hard: hard || undefined, ...r });
}

const cm = (x) => (x == null ? '   -  ' : `${(x * 100).toFixed(1).padStart(5)}cm`);
console.log(`crown gate (owner ruling 7): R at 3 cm under the top >= ${GATE_R3 * 100} cm on soft head coverings; ` +
  `R = ((min(width, depth)/2)^2 + d^2) / 2d over head-weighted bind-pose vertices, +-${BAND * 1000} mm slices`);
for (const r of out) {
  if (r.status === 'skipped' && !allRows) continue;
  const row = (d) => r.rows?.find((x) => x.d === d) || {};
  const r1 = row(0.01), r3 = row(0.03), r5 = row(0.05);
  console.log(`  ${r.id.padEnd(26)} ${String(r.status).padEnd(7)} R1 ${cm(r1.R)} R3 ${cm(r3.R)} R5 ${cm(r5.R)}  ` +
    `w5 ${cm(r5.width)} d5 ${cm(r5.depth)} dome ${r.dome ?? '-'} top ${r.top ?? '-'}` +
    (r.hard ? `  (${r.hard}: visual check only)` : '') + (r.skipped ? `  (${r.skipped})` : '') + (r.error ? `  ${r.error}` : ''));
}
const n = (s) => out.filter((r) => r.status === s).length;
console.log(`[crown] ${out.length} GLBs: ${n('pass')} pass, ${n('FAIL')} FAIL, ${n('hard')} hard tops (visual check), ` +
  `${n('unit')} units (measured, not gated), ${n('skipped')} skipped, ${n('error')} errors`);
if (jsonOut) writeFileSync(resolve(jsonOut), JSON.stringify({ gate: { r3_min: GATE_R3, band: BAND, ruling: 7 }, rows: out }, null, 1));
process.exit(fails ? 1 : 0);
