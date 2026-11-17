// PLAYGROUND data probe (PG_DATA): DT-01 to DT-16 and the T6 row of _spec/PLAYGROUND_BUILD.md 18, over src/data/places.ts, life.ts, quests.ts,
// journal_text.ts and the ten place_<id>.ts modules. Plain node:  node _harness/probe_pg_data.ts   (one line per row; exit 1 on any failure).
// Thresholds are the spec's, stated here, never loosened to pass. DT-01 is strict for the places whose slice is being built (STRICT_PLACES:
// Home and Hearthlog for S0 / S1); for the S2 and S3 places it prints their problem count as PENDING (their slice lays both layouts with this
// same code and adds them to STRICT_PLACES), so nothing hides: every problem is listed with --verbose.
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
import { PLACE_IDS, THING_IDS, MECH, ZONE, MECH_RANGES, PLACE_INFO, THING_KINDS, SIGNATURE, FINALE, ownsArea } from '../src/data/places.ts';
import type { PlaceDef, ThingDef, Area, PlaceId } from '../src/data/places.ts';
import { EMOTE, SALTS, FAMILY_REACT, GAITS, REACT_TRIGGERS, REACT_KIND, SOCIAL_KIND, USE_VERB, SPECIES_LIFE, CHANNEL, PHYS_ARG, RPOSE, PARTICLE, REACT_SOUND, LOOK, THING_KIND,
  DEFAULT_REACTIONS, LOOK_ADD, BUBBLE_WORDS, BUBBLE_MEANINGS, TRAIT_WORDS, STAR_MEANINGS } from '../src/data/life.ts';
import { QUESTS, EV, FACT, KEEPSAKES, CHAPTERS, GIFT_LISTS, HOME_TEXT, FACT_REACTS, PIECES_USE } from '../src/data/quests.ts';
import { QUEST_TEXT, CHAPTER_TEXT, THING_TEXT, AREA_TEXT, KEEPSAKE_TEXT, FACT_LINES, FAMILY_LINES, WISH_LINES, GIFT_LINES, UI_TEXT, TOUCH_WORDS } from '../src/data/journal_text.ts';
import { CATALOG, LANES } from '../src/data/catalog.ts';
import type { SpeciesId } from '../src/data/catalog.ts';
import { MATERIAL_FAMILY_IDS, MATERIAL_FAMILIES } from '../src/data/materials.ts';
import { nameReason, proseReason } from './name_gate.ts';
import { visibleTableAt } from '../src/render/homeview.ts';
import { fitPlace, placeBand } from '../src/render/placeview.ts';

const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = resolve(HERE, '..');
const VERBOSE = process.argv.includes('--verbose');
let bad = 0;
const row = (id: string, ok: boolean, what: string, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${extra ? '  ' + extra : ''}`); };
const note = (id: string, what: string): void => console.log(`info ${id} ${what}`);
const f2 = (v: number): string => v.toFixed(2);
const D2R = Math.PI / 180;
/** The places whose layouts DT-01 must pass now (S0 / S1). S2 adds ripple, frostbell, rainleaf; S3 the other five. */
const STRICT_PLACES: readonly PlaceId[] = ['home', 'hearthlog', 'ripple', 'frostbell', 'rainleaf', 'fizzwell', 'cogwhistle', 'lanternroof'];

const DEFS: PlaceDef[] = [];
for (const id of PLACE_IDS) DEFS.push(((await import(`../src/data/place_${id}.ts`)) as { PLACE: PlaceDef }).PLACE);

/* ═══════════════════════════════ T6: the copied gate still matches probe_catalog.ts ═══════════════════════════════ */
{
  const cat = readFileSync(resolve(HERE, 'probe_catalog.ts'), 'utf8'), gate = readFileSync(resolve(HERE, 'name_gate.ts'), 'utf8');
  const a = cat.indexOf('/* ───────────────────────────── originality + language safety'), b = cat.indexOf('/* ───────────────────────────── the frozen physics DOLLOP');
  const src = a >= 0 && b > a ? cat.slice(a, b).replace(/\s+$/, '') : '';
  const g0 = gate.indexOf('// ==== BEGIN COPY OF probe_catalog.ts 76-297 ====\n'), g1 = gate.indexOf('// ==== END COPY ====');
  const copy = g0 >= 0 && g1 > g0 ? gate.slice(g0 + '// ==== BEGIN COPY OF probe_catalog.ts 76-297 ====\n'.length, g1).replace(/\s+$/, '') : '';
  const fns = ['denyReason', 'compoundReason', 'unsafeReason', 'denyReasonText', 'unsafeReasonText'];
  row('T6', !!src && src === copy && fns.every((f) => copy.includes(`function ${f}(`)), 'the name gate in _harness/name_gate.ts is probe_catalog.ts\'s gate block byte for byte',
    `${copy.length} chars, ${fns.length} functions`);
}

/* ═══════════════════════════════ DT-01: geometry, both layouts ═══════════════════════════════ */
type Shape = { k: 'box'; x: number; z: number; hx: number; hz: number; yaw: number } | { k: 'disc'; x: number; z: number; r: number }
  | { k: 'cap'; ax: number; az: number; bx: number; bz: number; r: number } | { k: 'ring'; x: number; z: number; R: number; r: number; yaw: number; gap: number };
function dist(px: number, pz: number, s: Shape): number {
  if (s.k === 'disc') return Math.hypot(px - s.x, pz - s.z) - s.r;
  if (s.k === 'box') { const c = Math.cos(-s.yaw), sn = Math.sin(-s.yaw), dx = px - s.x, dz = pz - s.z, lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const qx = Math.abs(lx) - s.hx, qz = Math.abs(lz) - s.hz; return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0); }
  if (s.k === 'cap') { const vx = s.bx - s.ax, vz = s.bz - s.az, l2 = vx * vx + vz * vz, t = l2 > 0 ? Math.max(0, Math.min(1, ((px - s.ax) * vx + (pz - s.az) * vz) / l2)) : 0;
    return Math.hypot(px - (s.ax + t * vx), pz - (s.az + t * vz)) - s.r; }
  const ang = Math.atan2(pz - s.z, px - s.x); let d = (ang - s.yaw) / D2R; while (d > 180) d -= 360; while (d < -180) d += 360;
  if (Math.abs(d) > s.gap / 2) return Math.abs(Math.hypot(px - s.x, pz - s.z) - s.R) - s.r;
  let best = Infinity; for (const sg of [-1, 1]) { const a = s.yaw + sg * s.gap / 2 * D2R; best = Math.min(best, Math.hypot(px - (s.x + s.R * Math.cos(a)), pz - (s.z + s.R * Math.sin(a))) - s.r); }
  return best;
}
function outline(s: Shape): [number, number][] {
  const o: [number, number][] = [];
  if (s.k === 'disc') for (let i = 0; i < 24; i++) o.push([s.x + s.r * Math.cos(i * Math.PI / 12), s.z + s.r * Math.sin(i * Math.PI / 12)]);
  else if (s.k === 'box') { const c = Math.cos(s.yaw), sn = Math.sin(s.yaw); for (let i = 0; i <= 8; i++) { const u = -1 + i / 4;
    for (const [lx, lz] of [[u * s.hx, -s.hz], [u * s.hx, s.hz], [-s.hx, u * s.hz], [s.hx, u * s.hz]]) o.push([s.x + lx * c - lz * sn, s.z + lx * sn + lz * c]); } }
  else if (s.k === 'cap') { for (let i = 0; i <= 8; i++) { const t = i / 8, cx = s.ax + (s.bx - s.ax) * t, cz = s.az + (s.bz - s.az) * t; for (let j = 0; j < 8; j++) o.push([cx + s.r * Math.cos(j * Math.PI / 4), cz + s.r * Math.sin(j * Math.PI / 4)]); } }
  else for (let i = 0; i < 360; i += 6) { let d = i - s.yaw / D2R; while (d > 180) d -= 360; while (d < -180) d += 360; if (Math.abs(d) <= s.gap / 2) continue;
    for (const rr of [s.R - s.r, s.R + s.r]) o.push([s.x + rr * Math.cos(i * D2R), s.z + rr * Math.sin(i * D2R)]); }
  return o;
}
const areaShape = (a: Area): Shape => a.shape === 'disc' ? { k: 'disc', x: a.x, z: a.z, r: a.r ?? 0 } : { k: 'box', x: a.x, z: a.z, hx: a.hx ?? 0, hz: a.hz ?? 0, yaw: a.yaw ?? 0 };
const swingSweep = (t: ThingDef): number => (t.p.rope ?? 0) * Math.sin((t.p.limit ?? 0) * D2R);
/** A thing's collider footprints (swept for moving props: a swing's arc, a chime's swing; a seesaw's board) at (x, z, yaw); [] for no collider. */
function footprints(t: ThingDef, x: number, z: number, yaw: number): Shape[] {
  const c = Math.cos(yaw), s = Math.sin(yaw), at = (u: number, v = 0): [number, number] => [x + u * c - v * s, z + u * s + v * c];
  switch (t.mech) {
    case MECH.block: { // a row of p.n blocks (the Singing Crystals): spaced evenly over p.span along the yaw axis, bowed p.curve toward local +z at the middle
      const n = t.p.n ?? 1, span = t.p.span ?? 0, cv = t.p.curve ?? 0, out: Shape[] = [];
      for (let i = 0; i < n; i++) { const w = n > 1 ? 2 * i / (n - 1) - 1 : 0, [px, pz] = at(w * span / 2, cv * (1 - w * w)); out.push({ k: 'box', x: px, z: pz, hx: t.size[0], hz: t.size[2], yaw }); }
      return out; }
    case MECH.seesaw: return [{ k: 'box', x, z, hx: t.size[0], hz: t.size[2], yaw }];
    case MECH.ramp: return [{ k: 'box', x, z, hx: t.size[0] * Math.cos((t.p.angle ?? 0) * D2R), hz: t.size[2], yaw }];
    case MECH.bar: {
      if (t.p.arch) { const w = (t.p.width ?? 1.6) / 2, [ax, az] = at(-w), [bx, bz] = at(w); return [{ k: 'disc', x: ax, z: az, r: t.size[0] }, { k: 'disc', x: bx, z: bz, r: t.size[0] }]; }
      if (t.p.standing) return [{ k: 'disc', x, z, r: t.size[0] }];
      const h = Math.max(0, t.size[1] / 2 - t.size[0]), [ax, az] = at(-h), [bx, bz] = at(h); return [{ k: 'cap', ax, az, bx, bz, r: t.size[0] }];
    }
    case MECH.mound: { const R = t.size[0], d = R - t.size[1]; return [{ k: 'disc', x, z, r: Math.sqrt(Math.max(0, R * R - d * d)) }]; }
    case MECH.ring: return [{ k: 'ring', x, z, R: t.size[0], r: t.size[1], yaw, gap: t.size[2] }];
    case MECH.swing: return [{ k: 'box', x, z, hx: swingSweep(t) + t.size[0], hz: t.size[1] / 2, yaw }];
    case MECH.turntable: case MECH.ball: return [{ k: 'disc', x, z, r: t.size[0] }];
    case MECH.pad: { const out: Shape[] = [{ k: 'disc', x, z, r: t.size[0] }]; for (let i = 1; i < (t.p.n ?? 1); i++) out.push({ k: 'disc', x: x + (t.p[`x${i}`] - t.x), z: z + (t.p[`z${i}`] - t.z), r: t.size[0] }); return out; }
    case MECH.floater: return t.size[2] ? [{ k: 'box', x, z, hx: t.size[0], hz: t.size[2], yaw }] : [{ k: 'disc', x, z, r: t.size[0] + t.size[1] }];
    case MECH.chime: { const n = t.p.n ?? 1, span = t.p.span ?? 0, sw = (t.p.hang ?? 0.5) * Math.sin(25 * D2R), out: Shape[] = [];
      for (let i = 0; i < n; i++) { const [px, pz] = at(n > 1 ? -span / 2 + span * i / (n - 1) : 0); out.push({ k: 'disc', x: px, z: pz, r: t.size[0] + sw }); } return out; }
    default: return [];
  }
}
const isMoving = (t: ThingDef): boolean => [MECH.seesaw, MECH.swing, MECH.turntable, MECH.chime, MECH.pad, MECH.floater, MECH.ball].includes(t.mech as never) || !!t.p.branchL;
function heightOf(t: ThingDef): number {
  switch (t.mech) { case MECH.block: return 2 * t.size[1] + (t.p.kettleR ? 2 * t.p.kettleR : 0) + 0; case MECH.bar: return t.p.arch ? (t.p.height ?? 0) : t.p.standing ? t.size[1] : 2 * t.size[0];
    case MECH.mound: return t.size[1]; case MECH.ring: return 2 * t.size[1]; case MECH.ramp: return t.p.top ?? 0; default: return 0; }
}
function primitives(t: ThingDef): { prims: number; moving: number } {
  switch (t.mech) {
    case MECH.ring: return { prims: t.p.segments ?? 6, moving: 0 };
    case MECH.floater: return { prims: t.size[2] ? 1 : (t.p.segments ?? 6), moving: 1 };
    case MECH.ramp: return { prims: 1 + (t.p.rails ? 2 : 0), moving: 0 };
    case MECH.chime: return { prims: (t.p.n ?? 1) + (t.p.postR || t.p.railR ? 1 : 0), moving: t.p.n ?? 1 };
    case MECH.pad: return { prims: t.p.n ?? 1, moving: t.p.n ?? 1 };
    case MECH.bar: return { prims: t.p.arch ? 3 : 1 + (t.p.branchL ? 1 : 0), moving: t.p.branchL ? 1 : 0 };
    case MECH.block: return { prims: (t.p.n ?? 1) + (t.p.kettleR ? 1 : 0), moving: 0 };
    case 0: case MECH.pool: return { prims: 0, moving: 0 };
    default: return { prims: 1, moving: isMoving(t) ? 1 : 0 };
  }
}
const inRound = (x: number, z: number, b: Area & { round: number }): boolean => {
  if (b.shape === 'disc') return Math.hypot(x - b.x, z - b.z) <= (b.r ?? 0) + 1e-9;
  const hx = b.hx ?? 0, hz = b.hz ?? 0, r = b.round, qx = Math.abs(x - b.x) - (hx - r), qz = Math.abs(z - b.z) - (hz - r);
  return (qx <= 0 || qz <= 0) ? (Math.abs(x - b.x) <= hx + 1e-9 && Math.abs(z - b.z) <= hz + 1e-9) : Math.hypot(qx, qz) <= r + 1e-9;
};
const PHYS_ZONES: readonly number[] = [ZONE.water, ZONE.current, ZONE.wind, ZONE.updraft, ZONE.magnet];
/** Is (x, z) at a water zone's full depth: inside it and at least `ramp` from every OPEN edge (an edge with a wall on it has no ramp). */
function fullDepth(x: number, z: number, a: Area, ramp: number, walls: Shape[]): boolean {
  if (a.shape === 'disc') return Math.hypot(x - a.x, z - a.z) <= (a.r ?? 0) - ramp + 1e-9;
  const hx = a.hx ?? 0, hz = a.hz ?? 0;
  const edges: [number, number, number][] = [[a.x - hx, a.z, Math.abs(x - (a.x - hx))], [a.x + hx, a.z, Math.abs(x - (a.x + hx))], [a.x, a.z - hz, Math.abs(z - (a.z - hz))], [a.x, a.z + hz, Math.abs(z - (a.z + hz))]];
  if (Math.abs(x - a.x) > hx + 1e-9 || Math.abs(z - a.z) > hz + 1e-9) return false;
  return edges.every(([mx, mz, d]) => walls.some((w) => dist(mx, mz, w) <= 0.05) || d >= ramp - 1e-9);
}
/** The ramps whose foot PLACES puts somewhere: the Glide Ramp ends at the ice (4.4), the Soap Slide down in the water (4.6). */
const RAMP_FOOT: Readonly<Record<string, 'ice' | 'water'>> = { glideramp: 'ice', soapslide: 'water' };
function checkPlace(P: PlaceDef, tall: boolean): string[] {
  const probs: string[] = [], L = tall ? P.tall : P;
  const pos = P.things.map((t, i) => tall ? P.tall.things[i] : { x: t.x, z: t.z, yaw: t.yaw, use: t.useSpot, peek: t.peek, push: t.push });
  if (tall && P.tall.things.length !== P.things.length) probs.push('tall.things does not have one Spot per ThingDef');
  if ((tall ? P.tall.zones.length : P.zones.length) !== P.zones.length || P.tall.patches.length !== P.patches.length) probs.push('tall zones / patches do not match the PlaceDef');
  const fp = P.things.map((t, i) => footprints(t, pos[i].x, pos[i].z, pos[i].yaw));
  const walls = L.walls.map(areaShape), b = L.bounds;
  const inFrame = (x: number, z: number): boolean => tall ? (Math.abs(x) <= 1.82 - 0.128 * z + 1e-9 && z >= -3.7 - 1e-9 && z <= 3.4 + 1e-9) : (Math.abs(x) <= 3.4 + 1e-9 && z >= -2.4 - 1e-9 && z <= 2.4 + 1e-9);
  const colliders = (except: number): Shape[] => fp.flatMap((s, i) => (i === except ? [] : s));
  const clearOf = (x: number, z: number, except: number): number => Math.min(9, ...colliders(except).map((s) => dist(x, z, s)));
  const wallGap = (x: number, z: number): number => Math.min(9, ...walls.map((w) => dist(x, z, w)));
  const bodyOK = (what: string, x: number, z: number, own: number): void => {
    if (!inRound(x, z, b)) probs.push(`${what} (${f2(x)}, ${f2(z)}) outside the rounded bounds`);
    if (wallGap(x, z) < 0.625 - 1e-9) probs.push(`${what} (${f2(x)}, ${f2(z)}): a body of R 0.625 reaches a wall (${f2(wallGap(x, z))} m)`);
    const c = clearOf(x, z, own); if (c < 0.625 - 1e-9) probs.push(`${what} (${f2(x)}, ${f2(z)}) ${f2(c)} m from a collider (needs 0.625)`);
  };
  let prims = L.walls.length, moving = 0;
  P.things.forEach((t, i) => {
    const pr = primitives(t); prims += pr.prims; moving += pr.moving;
    for (const s of fp[i]) for (const [x, z] of outline(s)) {
      if (!inFrame(x, z)) { probs.push(`${t.id} outside the ${tall ? 'tall frame' : "walls' rectangle"} at (${f2(x)}, ${f2(z)})`); break; }
    }
    for (const s of fp[i]) { const d = dist(0, 0, s); if (d < 1.2 - 1e-9) probs.push(`${t.id} in the pad (${f2(d)} m from its centre)`); }
    if (!isMoving(t) && fp[i].length && pos[i].z > 1.3 && heightOf(t) > 0.4 + 1e-9) probs.push(`${t.id} in the front band is ${f2(heightOf(t))} m tall (at most 0.4)`);
    // a chime set's frame or rail is static and stands at least at its hang height (M10: 0.30..0.70 m), so P7's low front band holds none
    if (t.mech === MECH.chime && pos[i].z > 1.3 && (t.p.hang ?? 0.5) > 0.4 + 1e-9) probs.push(`${t.id} in the front band: its static frame stands ${f2(t.p.hang ?? 0.5)} m tall (at most 0.4)`);
    // likewise a swing hangs from a frame, beam or line at its pivot height (M8: 1.5 m and more), so none stands in the front band either
    if (t.mech === MECH.swing && pos[i].z > 1.3) probs.push(`${t.id} in the front band: its pivot frame stands ${f2(t.p.pivotY ?? (t.p.rope ?? 0) + 0.2)} m tall (at most 0.4)`);
    // rides and their spots
    if (t.mech === MECH.swing) {
      const sw = swingSweep(t), c = Math.cos(pos[i].yaw), s = Math.sin(pos[i].yaw);
      for (let k = 0; k <= 40; k++) { const u = -sw + 2 * sw * k / 40; bodyOK(`${t.id} rider`, pos[i].x + u * c, pos[i].z + u * s, i); }
      const push = pos[i].push; if (!push) probs.push(`${t.id} has no push spot`);
      else { bodyOK(`${t.id} push spot`, push[0], push[1], i); const e = Math.min(Math.hypot(push[0] - (pos[i].x + sw * c), push[1] - (pos[i].z + sw * s)), Math.hypot(push[0] - (pos[i].x - sw * c), push[1] - (pos[i].z - sw * s)));
        if (Math.abs(e - 1.3) > 0.05) probs.push(`${t.id} push spot is ${f2(e)} m from the arc's end (1.3)`); }
      const v = Math.sqrt(2 * 10 * (t.p.rope ?? 0) * (1 - Math.cos((t.p.limit ?? 0) * D2R))); if (v > 2.0 + 1e-9) probs.push(`${t.id} seat speed ${f2(v)} m/s (at most 2.0)`);
    }
    if (t.mech === MECH.seesaw) {
      const c = Math.cos(pos[i].yaw), s = Math.sin(pos[i].yaw), rd = t.p.rider ?? 0;
      for (const sg of [-1, 1]) bodyOK(`${t.id} rider`, pos[i].x + sg * rd * c, pos[i].z + sg * rd * s, i);
      const Lb = 2 * t.size[0], th = 2 * t.size[1], need = (Lb / 2) * Math.sin((t.p.limit ?? 0) * D2R) + (th / 2) * Math.cos((t.p.limit ?? 0) * D2R);
      if ((t.p.pivot ?? 0) < need - 1e-9) probs.push(`${t.id} floor rule: pivot ${t.p.pivot} < ${need.toFixed(3)} m`);
      if (walls.length) for (const sg of [-1, 1]) { const g = wallGap(pos[i].x + sg * t.size[0] * c, pos[i].z + sg * t.size[0] * s); if (g < 0.6 - 1e-9) probs.push(`${t.id} board end ${f2(g)} m from a wall (0.6)`); }
    }
    // every other ride's seat and rider spots (the brief's DT-01 list; D-91 / PLACES rev 4 (3): every ride keeps its rider's whole path inside
    // the bounds): a ramp's path from its top rider spot to its foot (local +x is downhill, places.ts ThingDef), a mound's top, a floater's
    // centre, each with a rider of R 0.625 clear of the walls and 0.625 m from every other collider (R2: the probe had checked swings and
    // seesaws only). The ramp's top rider spot is its top end less the SMALLEST body's radius (0.40 m, shape.ts 68): the farthest up a set
    // body's centre can sit on the board (a centre at the very edge would hang half the body off the ramp), as the swing and seesaw rows take
    // the rider's centre (the seat; p.rider inside the board's ends); the smallest radius makes the path the longest.
    if (t.ride && t.mech === MECH.ramp) { const c = Math.cos(pos[i].yaw), s = Math.sin(pos[i].yaw), h = t.size[0] * Math.cos((t.p.angle ?? 0) * D2R), top = -(h - 0.4);
      for (let k = 0; k <= 10; k++) { const u = top + (h - top) * k / 10; bodyOK(`${t.id} rider`, pos[i].x + u * c, pos[i].z + u * s, i); } }
    if (t.ride && (t.mech === MECH.mound || t.mech === MECH.floater)) bodyOK(`${t.id} rider`, pos[i].x, pos[i].z, i);
    // where a ramp's foot must land (PLACES 4.4 the Glide Ramp "ending at the ice"; 4.6 the Soap Slide "down into the water"), in each layout
    const foot = RAMP_FOOT[t.id];
    if (t.mech === MECH.ramp && foot) { const h = t.size[0] * Math.cos((t.p.angle ?? 0) * D2R), fx = pos[i].x + h * Math.cos(pos[i].yaw), fz = pos[i].z + h * Math.sin(pos[i].yaw);
      const areas = foot === 'ice' ? P.patches.map((pd, k) => pd.ice ? (tall ? P.tall.patches[k] : pd) : null) : P.zones.map((zd, k) => zd.kind === ZONE.water ? (tall ? P.tall.zones[k] : zd) : null);
      if (!areas.some((a) => a && dist(fx, fz, areaShape(a)) <= 1e-9)) probs.push(`${t.id} foot (${f2(fx)}, ${f2(fz)}) is not on the ${foot === 'ice' ? 'ice' : 'water'}`); }
    // a floater lies wholly in a water zone deep enough to float in (PLACES 2.1 M12 "in a water zone"; shallow water, at most 0.12 m, gives
    // drag only, 2.2), and its centre (where a floating body rests in the ring or against the raft) at the zone's FULL depth: the physics
    // depth ramp (P4, `ZoneDef.ramp`) makes a floating body a sitter (PLAYGROUND_BUILD 8.7). The ramp lies along the water's open edges only,
    // not where the zone meets a wall (PLACES 4.6: the bath's ramp is "from its front edge"; its back and sides are the tub)
    if (t.mech === MECH.floater && !P.zones.some((zd, k) => { const a = tall ? P.tall.zones[k] : zd;
      return zd.kind === ZONE.water && (zd.surfaceY ?? 0) > 0.12 + 1e-9 && fp[i].every((sh) => outline(sh).every(([x, z]) => dist(x, z, areaShape(a)) <= 1e-9))
        && fullDepth(pos[i].x, pos[i].z, a, zd.ramp ?? 0, walls); })) probs.push(`${t.id} floater not wholly in a deep water zone with its centre at full depth (past the edge ramp)`);
    // a pool IS its water zone (M6): the thing stands where its own zone is, in each layout
    if (t.mech === MECH.pool) { const k = P.zones.findIndex((zd) => ownsArea(t.zone, zd.id)), a = k < 0 ? null : tall ? P.tall.zones[k] : P.zones[k];
      if (!a || Math.hypot(a.x - pos[i].x, a.z - pos[i].z) > 1e-6) probs.push(`${t.id} pool does not stand on its own water zone`); }
    if (t.mech === MECH.ring) {
      const open = 2 * t.size[0] * Math.sin(t.size[2] / 2 * D2R) - 2 * t.size[1]; if (open < 1.35 - 1e-9) probs.push(`${t.id} clear opening ${f2(open)} m (at least 1.35)`);
      // the gap waypoint as LIFE lays it (src/life/world.ts copyPlace: p.way, default 0.6, outside the ring's radius along its yaw)
      const way = t.size[0] + (t.p.way ?? 0.6), g = [pos[i].x + Math.cos(pos[i].yaw) * way, pos[i].z + Math.sin(pos[i].yaw) * way];
      bodyOK(`${t.id} gap waypoint`, g[0], g[1], i);
      // its inner spot (where a napper curls up): inside the bounds with a body clear of the walls and of every OTHER collider (a ball left
      // in the nest, say); its own segments are the clear inner radius below
      bodyOK(`${t.id} inner spot`, pos[i].x, pos[i].z, i);
      if (t.size[0] - t.size[1] < 0.625 - 1e-9) probs.push(`${t.id} clear inner radius ${f2(t.size[0] - t.size[1])} m holds no body of R 0.625`);
    }
    if (pos[i].use && t.mech !== MECH.ring) bodyOK(`${t.id} use spot`, pos[i].use![0], pos[i].use![1], i);
    if (pos[i].peek) { const pk = pos[i].peek!; bodyOK(`${t.id} left peek spot`, pk[0], pk[1], i); bodyOK(`${t.id} right peek spot`, pk[2], pk[3], i); }
    if (t.mech === MECH.ramp && (t.p.angle ?? 0) > 16 + 1e-9) probs.push(`${t.id} ramp ${t.p.angle} degrees (at most 16)`);
    // P2 thickness and the ball radius
    const thick = t.mech === MECH.block || t.mech === MECH.ramp || t.mech === MECH.seesaw ? 2 * Math.min(t.size[0], t.size[1], t.size[2] || 9) : [MECH.bar, MECH.swing, MECH.chime, MECH.ring].includes(t.mech as never) ? 2 * (t.mech === MECH.ring ? t.size[1] : t.size[0]) : 9;
    if (thick < 0.16 - 1e-9) probs.push(`${t.id} a part is ${f2(thick)} m thick (at least 0.16)`);
    if (t.mech === MECH.ball && t.size[0] < 0.2 - 1e-9) probs.push(`${t.id} ball r ${t.size[0]} (at least 0.20)`);
    // MECH_RANGES
    const R = MECH_RANGES[t.mech]; if (R) {
      const val: Record<string, number | undefined> = { ...t.p, mu: t.mech === MECH.block || t.mech === MECH.ramp ? t.mu : undefined };
      if (t.mech === MECH.block) { val.side = Math.min(2 * t.size[0], 2 * t.size[1], 2 * t.size[2]); val.side2 = Math.max(2 * t.size[0], 2 * t.size[1], 2 * t.size[2]); }
      if (t.mech === MECH.bar) { val.r = t.size[0]; val.length = t.p.arch ? undefined : t.size[1]; }
      if (t.mech === MECH.mound) { val.r = t.size[0]; val.top = t.size[1]; }
      if (t.mech === MECH.ring) { val.ringR = t.size[0]; val.segR = t.size[1]; val.gap = t.size[2]; val.opening = 2 * t.size[0] * Math.sin(t.size[2] / 2 * D2R) - 2 * t.size[1]; }
      if (t.mech === MECH.pool) val.surface = t.size[1];
      if (t.mech === MECH.seesaw) { val.length = 2 * t.size[0]; val.thickness = 2 * t.size[1]; }
      if (t.mech === MECH.swing) { val.seatR = t.size[0]; val.seatLength = t.size[1]; }
      if (t.mech === MECH.turntable || t.mech === MECH.pad || t.mech === MECH.ball) val.r = t.size[0];
      for (const [k, [lo, hi]] of Object.entries(R)) { const v = k === 'side' ? val.side : val[k]; if (v === undefined) continue;
        if (v < lo - 1e-9 || v > hi + 1e-9) probs.push(`${t.id} ${k} ${f2(v)} outside ${lo}..${hi}`); }
      if (t.mech === MECH.block && (val.side2 ?? 0) > 3.0 + 1e-9) probs.push(`${t.id} a side over 3.0 m`);
      if (t.mech === MECH.chime) for (const n of t.notes ?? []) if (n < 62 || n > 83 || ![2, 4, 6, 9, 11].includes(n % 12)) probs.push(`${t.id} note ${n} is not D major pentatonic in 62..83`);
    }
  });
  // thing-to-thing clearance (swept), walls excepted
  for (let i = 0; i < fp.length; i++) for (let j = i + 1; j < fp.length; j++) {
    if (!fp[i].length || !fp[j].length) continue;
    const d = Math.min(...fp[i].flatMap((s) => outline(s).map(([x, z]) => Math.min(...fp[j].map((q) => dist(x, z, q))))), ...fp[j].flatMap((s) => outline(s).map(([x, z]) => Math.min(...fp[i].map((q) => dist(x, z, q))))));
    if (d < 0.3 - 1e-9) probs.push(`${P.things[i].id} ~ ${P.things[j].id} ${f2(d)} m apart (at least 0.3)`);
  }
  // zones: no physics zone reaches the pad; water at most 0.30
  P.zones.forEach((zd, k) => { const a = tall ? P.tall.zones[k] : zd;
    if (PHYS_ZONES.includes(zd.kind)) { const d = dist(0, 0, areaShape(a)); if (d < 1.2 - 1e-9) probs.push(`zone ${zd.id} reaches into the pad (${f2(d)} m from its centre)`); }
    if (zd.surfaceY !== undefined && zd.surfaceY > 0.3 + 1e-9) probs.push(`zone ${zd.id} water ${zd.surfaceY} m deep (at most 0.30)`); });
  // spawn spots
  if (L.spawn !== 'matLayout') {
    const sp = L.spawn, gap = tall ? 1.0 : 1.25, hx = (b.hx ?? b.r ?? 0) - 0.825, hz = (b.hz ?? b.r ?? 0) - 0.825;
    if (sp.length < 5) probs.push(`${sp.length} spawn spots (at least 5)`);
    for (const [x, z] of sp) { if (Math.abs(x) > hx + 1e-9 || Math.abs(z) > hz + 1e-9) probs.push(`spawn (${x}, ${z}) outside the bounds shrunk by 0.825`);
      const c = clearOf(x, z, -1); if (c < 0.9 - 1e-9) probs.push(`spawn (${x}, ${z}) ${f2(c)} m from a thing (at least 0.9)`); }
    for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) { const d = Math.hypot(sp[i][0] - sp[j][0], sp[i][1] - sp[j][1]); if (d < gap - 1e-9) probs.push(`spawn pair ${f2(d)} m apart (at least ${gap})`); }
  }
  if (moving > 8) probs.push(`${moving} moving props (at most 8)`);
  const balls = P.things.filter((t) => t.mech === MECH.ball).length; if (balls > 1) probs.push(`${balls} free props (balls; at most one, P5)`);
  if (prims > 20) probs.push(`${prims} collider primitives (at most 20)`);
  return probs;
}
/** B8 (round 5): the HUD a shipped place's things must clear (CSS px), measured at HEAD 16f6ba6fc in the cabin (VERDICT_PG's
 *  B4_b4_phone_cabin_t54.png and this lane's shots): 390 x 844: the hint pill "Tap a tool to try it." 618..653 (centred), the party row 660..708,
 *  the name tag and meter from 714: the bottom HUD starts at 618 (226 px); 1280 x 800: the hint pill 672..704, the party row 670..716: 130 px + 6.
 *  Sides: 8 px (the Journal / map column at the top right is above every floor). */
const PLACE_HUD = { phone: { W: 390, H: 844, b: 226, l: 8, r: 8 }, desktop: { W: 1280, H: 800, b: 136, l: 8, r: 8 } } as const;
/** A collider's top height for the side test: blocks, bars, mounds, rings (heightOf), a swing's frame (its pivot), a seesaw's board (pivot + its
 *  half thickness), a ball's top. */
function thingTop(t: ThingDef): number {
  const h = heightOf(t); if (h > 0) return h;
  return t.mech === MECH.swing ? (t.p.pivotY ?? 1.6) : t.mech === MECH.seesaw ? (t.p.pivot ?? 0) + t.size[1] : t.mech === MECH.ball ? 2 * t.size[0] : 0;
}
/** The shell's play-bounds front (src/shell/later-life.ts frontReach, pinned below): the front-most z of every thing's footprint in a layout. */
function frontReachOf(d: PlaceDef, tall: boolean): number {
  let front = -Infinity;
  for (let k = 0; k < d.things.length; k++) {
    const t = d.things[k], sp = tall ? d.tall.things[k] ?? t : t, s = t.size;
    let hx: number, hz: number;
    switch (t.mech) {
      case MECH.block: case MECH.seesaw: hx = s[0]; hz = s[2] ?? s[0]; break;
      case MECH.bar: hx = (s[1] ?? 0) / 2; hz = s[0]; break;
      case MECH.ring: hx = hz = s[0] + (s[1] ?? 0); break;
      case MECH.swing: hx = s[0]; hz = (s[1] ?? 0) / 2; break;
      default: hx = s[0]; hz = s[2] || s[0];
    }
    const c = Math.abs(Math.cos(sp.yaw)), sn = Math.abs(Math.sin(sp.yaw));
    front = Math.max(front, sp.z + sn * hx + c * hz);
  }
  return front;
}
/** The camera a place ships with, rebuilt from its pure parts (render/placeview.ts fitPlace and placeBand: imported; the shell's setPlayBounds call
 *  and frontReach: pinned by text, so a change fails the row): a projection of world points to CSS px. */
function placeCam(P: PlaceDef, tall: boolean): { ok: boolean; why: string; proj: (x: number, y: number, z: number) => [number, number] } {
  const sh = readFileSync(resolve(ROOT, 'src/shell/later-life.ts'), 'utf8'), st = readFileSync(resolve(ROOT, 'src/render/place.ts'), 'utf8');
  const pins = ['const z0 = b.z - hz, z1 = Math.max(b.z + hz, frontReach(next, layout) + 0.1);', 'stage.setPlayBounds?.(b.x, (z0 + z1) / 2, hx, (z1 - z0) / 2)',
    "const hx = b.shape === 'disc' ? (b.r ?? 3) : (b.hx ?? 3), hz = b.shape === 'disc' ? (b.r ?? 3) : (b.hz ?? 2.4);",
    'case MECH.block: case MECH.seesaw: hx = s[0]; hz = s[2] ?? s[0]; break;', 'case MECH.ring: hx = hz = s[0] + (s[1] ?? 0); break;', 'case MECH.swing: hx = s[0]; hz = (s[1] ?? 0) / 2; break;',
    'default: hx = s[0]; hz = s[2] || s[0];', 'front = Math.max(front, sp.z + sn * hx + c * hz);'];
  const pinsR = ['const B = placeBand({ top, right, bottom, left }, w, h, this.band);', 'return fitPlace(cx, cz, hx, hz, w, h, B[0], B[1], B[2], B[3]);'];
  const missing = [...pins.filter((x) => !sh.includes(x)).map((x) => `later-life.ts: ${x}`), ...pinsR.filter((x) => !st.includes(x)).map((x) => `place.ts: ${x}`)];
  const none = (): [number, number] => [NaN, NaN];
  if (missing.length) return { ok: false, why: `the place camera's code changed (missing: ${missing.join(' | ')})`, proj: none };
  const L = tall ? P.tall : P, b = L.bounds, I = STAGE_INSETS[tall ? 'phone' : 'desktop'], W = tall ? 390 : 1280, H = tall ? 844 : 800;
  const hx = b.shape === 'disc' ? (b.r ?? 3) : (b.hx ?? 3), hz = b.shape === 'disc' ? (b.r ?? 3) : (b.hz ?? 2.4);
  const z0 = b.z - hz, z1 = Math.max(b.z + hz, frontReachOf(P, tall) + 0.1);
  const B = placeBand({ top: I.t, right: 0, bottom: I.b, left: 0 }, W, H, new Float64Array(4));
  const f = fitPlace(b.x, (z0 + z1) / 2, hx, (z1 - z0) / 2, W, H, B[0], B[1], B[2], B[3]);
  if (!f) return { ok: false, why: 'no place camera fits', proj: none };
  const ty = Math.tan(f.fov * Math.PI / 360), tx = ty * W / H, sn = Math.sin(f.pitch), cs = Math.cos(f.pitch), C = [f.aimX, f.aimY + f.dist * sn, f.aimZ + f.dist * cs];
  return { ok: true, why: '', proj: (x, y, z) => { const rx = x - C[0], ry = y - C[1], rz = z - C[2], dep = -ry * sn - rz * cs; return [((rx / (dep * tx)) * 0.5 + 0.5) * W, (1 - ((ry * cs - rz * sn) / (dep * ty) * 0.5 + 0.5)) * H]; } };
}

/** B8 (round 5, VERDICT_PG: "the cabin's tall layout: the Rocker Board under the hint pill and the quick-switch row, the kettle cut by the left
 *  edge"): a SHIPPED place seen through the camera that ships (placeCam: placeview's fitPlace with placeBand of the rows the shell reports, on the
 *  play bounds the shell sets, their front pushed to every thing's footprint + 0.1 m): every collider's whole outline, at the floor and at its
 *  top, inside the frame's sides (8 px), and its floor outline above the bottom HUD (PLACE_HUD: the hint pill's top on the phone, the party row on
 *  the desktop). checkPlace's P7 frame (|x| <= 1.82 - 0.128 z on a phone) is the layout rule; this is what the player sees. Its own row. */
function camProblems(P: PlaceDef, tall: boolean): string[] {
  const probs: string[] = [], pc = placeCam(P, tall), Hd = PLACE_HUD[tall ? 'phone' : 'desktop'];
  if (!pc.ok) return [pc.why];
  P.things.forEach((t, i) => {
    const sp = tall ? P.tall.things[i] : { x: t.x, z: t.z, yaw: t.yaw }, fpi = footprints(t, sp.x, sp.z, sp.yaw);
    if (!fpi.length) return;
    const top = thingTop(t); let x0 = Infinity, x1 = -Infinity, yFloor = -Infinity;
    for (const sh of fpi) for (const [x, z] of outline(sh)) {
      const [ax, ay] = pc.proj(x, 0, z), [bx] = pc.proj(x, top, z);
      x0 = Math.min(x0, ax, bx); x1 = Math.max(x1, ax, bx); yFloor = Math.max(yFloor, ay);
    }
    if (x0 < Hd.l - 1e-6 || x1 > Hd.W - Hd.r + 1e-6) probs.push(`${t.id} cut by the frame's side (${x0.toFixed(0)}..${x1.toFixed(0)} px of ${Hd.W})`);
    if (yFloor > Hd.H - Hd.b + 1e-6) probs.push(`${t.id} under the bottom HUD (its floor down to ${yFloor.toFixed(0)} px; the HUD from ${Hd.H - Hd.b})`);
  });
  return probs;
}

/* ── Home's row: the camera model of src/render/stage.ts (the slots 87-88, fov 35 at 199, REST_PITCH 0.27 at 111, TARGET_Y 0.42 at 149,
 *    fitDistance 325, framePoint / framingFor 343-408 with LIFE's slot framing, restAim 604-610 and the aim 640-653, visibleTable 1088-1096),
 *    settled at its target framing (yaw 0, zoom 1), round bodies of R = 0.5 x scale (restCy = R). Built from stage.ts's text: a constant or a
 *    snippet that moves fails the row, so the model is re-checked. ── */
/** The HUD per frame (CSS px) a thing must stand clear of to be seen and reached (the in-view tests): the top band t, the bottom band b, the
 *  frame's side edges l / r, and the right-hand button column (x >= colX down to colY). The top and bottom bands are the earlier fixer's (390 x 844:
 *  S+104 = 151 top, 170 bottom; 1280 x 800: 120 / 150), kept: they hold the measured HUD at HEAD 16f6ba6fc (390 x 844: top row to 56, the tracker
 *  pill and stamp moments under it at the top left, the name tag and meter row from 714, the dock from 778; 1280 x 800: top row to 56, the hint
 *  pill and quick-switch row from 670). RE-SPECIFIED in round 5 (FIX5_DATA B5, written reason): the sides were 16 / 60 px (phone) and 24 / 24 px
 *  (desktop) over the frame's whole height, an assumption (PLAYGROUND_BUILD 11.13: "a table the UI overhaul fills with the measured ones"); the
 *  shipped HUD has nothing at the sides between the bands but the Journal / account column at the top right (measured 330..374 x 64..160 on the
 *  phone, 1216..1264 x 64..160 on the desktop), which is now its own box, and the stage reports no side rows, so the Felt Ball's own bounds (the
 *  visible table, full width) reach the frame's edges: a 60 px side rule failed every ball the bounds legally hold there. Sides: 8 px.
 *  RE-SPECIFIED too (same reason): the desktop's bottom band 150 -> 136 px = the measured lowest HUD band + 6 px (with a party out its row
 *  starts at 670 px: the quick-switch chips 670..714, the hint pill 672..704, "Put back" 682..722, the dock 722..782); the phone's 170 stays
 *  (its quick-switch row starts at 660 = 184 px but spans only the left 16..260 px, under which no Home spot lies). */
const HUD_INSETS = { phone: { W: 390, H: 844, t: 151, b: 170, l: 8, r: 8, colX: 322, colY: 168 }, desktop: { W: 1280, H: 800, t: 120, b: 136, l: 8, r: 8, colX: 1208, colY: 168 } } as const;
/** Round 5 (FIX5_DATA, VERDICT_PG B5 / D1): the rows the shell REPORTS to the stage (hudBinding.ts reportInsets: setSafeInsets({ top, bottom }),
 *  no side rows), measured in the browser at HEAD 16f6ba6fc (stage.info.insets, the dev build at 390 x 844 touch and 1280 x 800, 1 and 3 out):
 *  they drive SR2's band framing (framing.ts: the lens shift, its scale demand) and the visible table the corral and the ball's bounds come from. */
const STAGE_INSETS = { phone: { t: 56, b: 130 }, desktop: { t: 56, b: 78 } } as const;
/** The rest columns the band framing measures each body at (framing.ts frameMode 1: top = restH, centre restCy, half width restHalfW; the disc
 *  about the centre of restHalfW x 1.06 and of restRadius): a ball (2R, R, R), a squat dome (1.4R, 0.7R, 1.1R) and a flat cake (1.0R, 0.5R, 1.25R),
 *  which bracket the lens measured in the browser (390 x 844 one Dollop 0.096 against 0.074 / 0.129 / 0.176; 1280 x 800 three out 0.153 against
 *  -0.028 / 0.075 / 0.162). Every check holds for all three. */
const SHAPES = [{ h: 2, cy: 1, hw: 1 }, { h: 1.4, cy: 0.7, hw: 1.1 }, { h: 1.0, cy: 0.5, hw: 1.25 }] as const;
const SCALES = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2, 1.25];
function stageModel(): { ok: boolean; why: string; TALL: number[][]; WIDE: number[][]; fov: number; pitch: number; ty: number } {
  const st = readFileSync(resolve(ROOT, 'src/render/stage.ts'), 'utf8');
  const fr = readFileSync(resolve(ROOT, 'src/render/framing.ts'), 'utf8'), hb = readFileSync(resolve(ROOT, 'src/shell/hudBinding.ts'), 'utf8');
  const arr = (name: string): number[][] => { const m = new RegExp(`${name}[^=]*=\\s*(\\[\\[[^;]*\\]\\]);`).exec(st); return m ? (JSON.parse(m[1]) as number[][]) : []; };
  const WIDE = arr('MAT_SLOTS_WIDE'), TALL = arr('MAT_SLOTS_TALL');
  // The rig's start pitch is either a literal or (PG_RENDER, HEAD 8dc806641) the named constant REST_PITCH, which visibleTable() also uses: the
  // identifier is resolved from its own `const`, so a change of either the literal or the constant still fails the row.
  const pm = /let yaw = 0, pitch = (REST_PITCH|[\d.]+)/.exec(st)?.[1];
  const pitch = Number(pm === 'REST_PITCH' ? /const REST_PITCH = ([\d.]+)/.exec(st)?.[1] : pm);
  const fov = Number(/new THREE\.PerspectiveCamera\((\d+(?:\.\d+)?)/.exec(st)?.[1]), ty = Number(/const TARGET_Y = ([\d.]+)/.exec(st)?.[1]);
  // (round 5: bf06cff67 counts a cut squishy's pieces as its whole at the slot (asWhole): for a whole body rr / hw ARE restRadius / restHalfW, so
  // the reach is unchanged: max(R x 1.25, halfW x 1.12); the new text is pinned instead of the old one-line form)
  const need = ['Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect))', 'rr = asWhole ? v.wholeR : v.proxy.restRadius, hw = asWhole ? v.wholeHalfW : v.restHalfW',
    'const r = Math.max(rr * 1.25, hw * 1.12) * gk', "(camera.aspect < 0.9 ? 0.12 : 0.35)", '(solo ? 0.06 : 0.1)',
    'wx = mx; wz = mz * 0.8; wy = TARGET_Y * bodyScale', 'wx = c.x * 0.6; wz = c.z * 0.6', 'Math.max(0, c.y - TARGET_Y * camScale) * 0.7',
    // HEAD 8dc806641 (D-37, RD-14): with LIFE at Home (autoFraming) every body is framed at its mat slot (the k-th whole body at the k-th slot,
    // x bodyScale) and one body is aimed at its slot x 0.6 and its rest centre height: exactly the slot bodies this model places. The one-body
    // reach (restHalfW x 1.06 + 0.05 x scale; no dome for the model's round body) and the rest pitch of visibleTable are pinned too.
    'const sl = camera.aspect < 0.9 ? MAT_SLOTS_TALL : MAT_SLOTS_WIDE', 'slotXZ.x = sl[i][0] * bodyScale; slotXZ.z = sl[i][1] * bodyScale',
    'aimOut.x = slotXZ.x * 0.6; aimOut.z = slotXZ.z * 0.6', 'aimOut.y = TARGET_Y * scale + Math.max(0, p.restCy * p.growth - TARGET_Y * scale) * 0.7',
    'if (autoFraming && !p.playerMoving)', '((p1.restHalfW * (p1.style.dome > 0 ? 1.34 : 1.06) + 0.05 * p1.scale) * p1.growth) / hwPer',
    'const fitDistance = (): number => camScale * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect))',
    'const dist = f.want * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect))', 'visibleTableAt(ax, ay, az, dist, REST_PITCH, camera.fov',
    // round 5: SR2's band framing, which the model now carries (the shipped camera: the verdict's B5 ball sat 25 to 40 px from where the old model
    // put it): its scale demand in framingFor, the rest column per slot body (LIFE at Home), the lens shift as a view offset, and the visible table's
    // inset lines moved by the lens goal
    'if (framer.wantScale > 0) want = Math.max(want, framer.wantScale);',
    'fs[0] = slotXZ.x; fs[1] = slotXZ.z; fs[2] = (pw ? v.wholeH : v.restH) * g; fs[3] = (pw ? v.wholeCy : v.restCy) * g; fs[4] = (pw ? v.wholeHalfW : v.restHalfW) * 1.06 * g;',
    'camera.setViewOffset(cssW, cssH, -lx * cssW * 0.5, ly * cssH * 0.5, cssW, cssH)',
    'safe.top + ly * cssH * 0.5, safe.right + lx * cssW * 0.5, safe.bottom - ly * cssH * 0.5, safe.left - lx * cssW * 0.5'];
  const needF = ['enabled: true', 'marginMin: 3, marginFrac: 0.02', 'maxScale: 3.2', 'minBand: 0.35', 'sideFitFrom: 6',
    'p[0] = fs[0]; p[1] = fs[2]; p[2] = fs[1]; p[3] = fs[0]; p[4] = 0; p[5] = fs[1];', 'w[0] = fs[0]; w[1] = fs[3]; w[2] = fs[1]; w[6] = fs[4]; this.addDisc();',
    'w[6] = v.proxy.restRadius * v.growth; this.addDisc();', 'this.fitY = (top - bot) / Math.max(0.05, B[0] - B[1] - 2 * my);',
    'this.wantScale = f > 1 ? Math.min(T.maxScale, f * S) : 0;', 'this.goalY = Math.max(-0.7, Math.min(0.7, (B[0] + B[1]) / 2 - (top + bot) / 2));',
    'const horiz = this.ins.left + this.ins.right > 0 || n >= FRAME_TUNING.sideFitFrom;',
    'const kv = (t + b) > (1 - FRAME_TUNING.minBand) * H ? (1 - FRAME_TUNING.minBand) * H / (t + b) : 1;', 'B[0] = 1 - 2 * t / H; B[1] = -1 + 2 * b / H;'];
  // (the shell reports the top and bottom rows only: no side rows, so the band framing never shifts the picture sideways up to five bodies)
  const needH = ['st.setSafeInsets({ top, bottom })'];
  const missing = [...need.filter((s) => !st.includes(s)), ...needF.filter((s) => !fr.includes(s)).map((s) => `framing.ts: ${s}`), ...needH.filter((s) => !hb.includes(s)).map((s) => `hudBinding.ts: ${s}`)];
  const ok = WIDE.length === 5 && TALL.length === 5 && fov === 35 && pitch === 0.27 && ty === 0.42 && missing.length === 0;
  return { ok, why: ok ? '' : `stage.ts camera changed (fov ${fov}, pitch ${pitch}, TARGET_Y ${ty}, slots ${WIDE.length}/${TALL.length}, missing: ${missing.join(' | ')})`, TALL, WIDE, fov, pitch, ty };
}
const SM = stageModel();
interface Cam { W: number; H: number; A: number; ins: { t: number; b: number; l: number; r: number; colX: number; colY: number }; si: { t: number; b: number }; slots: number[][]; s: number; C: number[]; f: number[]; u: number[]; aim: number[]; d: number; ly: number; want: number; sh: number }
const TF = Math.tan((SM.fov || 35) * D2R / 2);
/** The camera settled at its target framing (yaw 0, zoom 1) for n slot bodies of scale s and rest shape SHAPES[sh]: framingFor's want (stage.ts:
 *  the one-body reach / the mat's extents, then SR2's demand), the aim (restAim for one body, the mat's middle for more), and SR2's lens goal
 *  (framing.ts measure + ease: the rest columns' extent in unshifted NDC centred in the band between the reported rows). The demand and the
 *  one-body aim depend on the scale they are measured at, so the three are iterated to their fixed point (as the eased camera settles). */
function cam(fr: 'phone' | 'desktop', n: number, s: number, sh: number): Cam {
  const I = HUD_INSETS[fr], SI = STAGE_INSETS[fr], A = I.W / I.H, base = Math.max(3.0, 2.4 / Math.max(0.2, A)), hwPer = base * TF * A, P = SM.pitch;
  const slots = (A < 0.9 ? SM.TALL : SM.WIDE).slice(0, n).map(([x, z]) => [x * s, z * s]);
  const R = 0.5 * s, S = SHAPES[sh], hw = S.hw * R, restH = S.h * R, restCy = S.cy * R;
  const f = [0, -Math.sin(P), -Math.cos(P)], u = [0, Math.cos(P), -Math.sin(P)];
  // framingFor without the band's demand: one body (stage.ts 503: its rest reach + a margin) or the mat (the slot extents, r = max(R x 1.25, hw x 1.12))
  let base0: number, mx = 0, mz = 0;
  if (n === 1) base0 = Math.max(s, (hw * 1.06 + 0.05 * s) / hwPer);
  else { const r = Math.max(R * 1.25, hw * 1.12); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of slots) { x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); z0 = Math.min(z0, z - r); z1 = Math.max(z1, z + r); }
    base0 = Math.max(s, ((x1 - x0) / 2 + 0.1 + (A < 0.9 ? 0.12 : 0.35) * (z1 - z0) / 2) / hwPer); mx = (x1 + x0) / 2; mz = (z0 + z1) / 2; }
  // the band (framing.ts bandRows, band): the reported rows, scaled down together under minBand 0.35; the margin max(3, 0.02 H) px
  const kv = (SI.t + SI.b) > 0.65 * I.H ? 0.65 * I.H / (SI.t + SI.b) : 1, B0 = 1 - 2 * SI.t * kv / I.H, B1 = -1 + 2 * SI.b * kv / I.H, my = 2 * Math.max(3, 0.02 * I.H) / I.H;
  let want = base0, ly = 0, aim = [0, 0, 0], C = [0, 0, 0];
  for (let it = 0; it < 40; it++) {
    aim = n === 1 ? [slots[0][0] * 0.6, SM.ty * want + Math.max(0, restCy - SM.ty * want) * 0.7, slots[0][1] * 0.6] : [mx, SM.ty * s, mz * 0.8];
    const d = want * base; C = [aim[0], aim[1] + d * Math.sin(P), aim[2] + d * Math.cos(P)];
    const ndcY = (x: number, y: number, z: number): [number, number] => { const vy = y - C[1], vz = z - C[2], dep = vy * f[1] + vz * f[2]; return [(vy * u[1] + vz * u[2]) / (dep * TF), dep]; };
    let top = -Infinity, bot = Infinity;
    for (const [x, z] of slots) {
      top = Math.max(top, ndcY(x, restH, z)[0]); bot = Math.min(bot, ndcY(x, 0, z)[0]);
      for (const rr of [hw * 1.06, R]) { const [cy, dep] = ndcY(x, restCy, z), ry = rr / (dep * TF); top = Math.max(top, cy + ry); bot = Math.min(bot, cy - ry); }
    }
    const fitY = (top - bot) / Math.max(0.05, B0 - B1 - 2 * my), demand = fitY > 1 ? Math.min(3.2, fitY * want) : 0;
    ly = Math.max(-0.7, Math.min(0.7, (B0 + B1) / 2 - (top + bot) / 2));
    const w2 = Math.max(base0, demand);
    if (Math.abs(w2 - want) < 1e-10) break;
    want = w2;
  }
  return { W: I.W, H: I.H, A, ins: I, si: SI, slots, s, C, f, u, aim, d: want * base, ly, want, sh };
}
/** CSS px of a world point in the shown frame: the camera's projection with SR2's lens shift (content up by ly in NDC; no side shift). */
function proj(c: Cam, x: number, y: number, z: number): [number, number] {
  const vx = x - c.C[0], vy = y - c.C[1], vz = z - c.C[2], depth = vy * c.f[1] + vz * c.f[2], uy = vy * c.u[1] + vz * c.u[2];
  return [((vx / (depth * TF * c.A)) + 1) / 2 * c.W, (1 - (uy / (depth * TF) + c.ly)) / 2 * c.H];
}
/** A sphere's on-screen disc: centre (CSS px), radius (px), depth (m). */
function discOf(c: Cam, x: number, y: number, z: number, r: number): [number, number, number, number] {
  const [sx, sy] = proj(c, x, y, z), depth = (x - c.C[0]) * 0 + (y - c.C[1]) * c.f[1] + (z - c.C[2]) * c.f[2];
  return [sx, sy, r / (depth * TF) * c.H / 2, depth];
}
function ground(c: Cam, sx: number, sy: number): [number, number] {
  const nx = (sx / c.W) * 2 - 1, ny = 1 - (sy / c.H) * 2 - c.ly, dx = nx * TF * c.A, dy = c.f[1] + ny * TF * c.u[1], dz = c.f[2] + ny * TF * c.u[2], t = -c.C[1] / dy;
  // (a row at or above the horizon never meets the ground: as far as it goes, homeview.ts rowZ / rowX)
  if (dy >= -1e-9) return [nx < 0 ? -Infinity : Infinity, -Infinity];
  return [c.C[0] + t * dx, c.C[2] + t * dz];
}
/** What stage.visibleTable returns (the corral and the Felt Ball's bounds come from it): the ground under the REPORTED rows of the shown frame
 *  (moved by the lens), full width (no side rows), each edge clipped to +-3.4 m; the x range the near row's. */
function visibleTable(c: Cam): number[] {
  // (the reported rows moved by the lens, as the stage passes them, each kept inside the frame: homeview clamps an inset at 0)
  const { si, W, H } = c, t = Math.max(0, si.t + c.ly * H / 2) - c.ly * H / 2, b = Math.max(0, si.b - c.ly * H / 2) + c.ly * H / 2;
  const [xlN, zN] = ground(c, 0, H - b), [xrN] = ground(c, W, H - b), [, zF] = ground(c, 0, t);
  return [Math.max(xlN, -3.4), Math.max(zF, -3.4), Math.min(xrN, 3.4), Math.min(zN, 3.4)];
}
const inIns = (c: Cam, [sx, sy]: [number, number]): boolean => sx >= c.ins.l && sx <= c.W - c.ins.r && sy >= c.ins.t && sy <= c.H - c.ins.b && !(sx >= c.ins.colX && sy <= c.ins.colY);
const CAMS = new Map<string, Cam[]>(); for (const fr of ['phone', 'desktop'] as const) for (let n = 1; n <= 5; n++) for (const s of SCALES) CAMS.set(`${fr}${n}${s}`, SHAPES.map((_, k) => cam(fr, n, s, k)));
const camsOf = (fr: string, n: number, s: number): Cam[] => CAMS.get(`${fr}${n}${s}`)!;
/** Where the free ball stands in a frame: its spot (x scale) pushed into its bounds, the visible table shrunk by its radius (props.ts setBallBounds,
 *  D-67: the world's first step does exactly this). */
function ballAt(c: Cam, x: number, z: number, r: number): [number, number] {
  const v = visibleTable(c);
  return [Math.min(v[2] - r, Math.max(v[0] + r, x)), Math.min(v[3] - r, Math.max(v[1] + r, z))];
}
/** The ball's free roll from (x, z) along (dx, dz) inside its bounds: to the first edge, then along that edge (its tangential part) to the corner. */
function rollRoom(c: Cam, x: number, z: number, dx: number, dz: number, r: number): number {
  const v = visibleTable(c), x0 = v[0] + r, x1 = v[2] - r, z0 = v[1] + r, z1 = v[3] - r;
  const tx = dx > 1e-9 ? (x1 - x) / dx : dx < -1e-9 ? (x0 - x) / dx : Infinity, tz = dz > 1e-9 ? (z1 - z) / dz : dz < -1e-9 ? (z0 - z) / dz : Infinity;
  const t = Math.max(0, Math.min(tx, tz)); let px = x + dx * t, pz = z + dz * t;
  if (tx < tz) pz = dz > 1e-9 ? z1 : dz < -1e-9 ? z0 : pz; else px = dx > 1e-9 ? x1 : dx < -1e-9 ? x0 : px;
  return Math.hypot(px - x, pz - z);
}
/** A slot body's on-screen ellipse in camera c, in the rest shape SHAPES[c.sh] the camera was framed for (centre at its rest centre height;
 *  semi-axes its half width and half height; the ball shape is the sphere of R = 0.5 x scale): centre, semi-axes a / b (px), depth. */
function bodyEll(c: Cam, x: number, z: number): [number, number, number, number, number] {
  const R = 0.5 * c.s, Sh = SHAPES[c.sh], [cx, cy, k, depth] = discOf(c, x, Sh.cy * R, z, R);
  return [cx, cy, Sh.hw * k, Sh.h / 2 * k, depth];
}
/** How far (px) a disc of radius r at (px, py) reaches into the ellipse (cx, cy, a, b) grown by `inner` (1 = the whole body, 0.6 its squeeze
 *  area): the Minkowski sum approximated by the ellipse of semi-axes a + r, b + r; <= 0 = clear. */
function ellReach(px: number, py: number, r: number, cx: number, cy: number, a: number, b: number, inner = 1): number {
  const A = inner * a + r, B = inner * b + r, q = Math.hypot((px - cx) / A, (py - cy) / B);
  return (1 - q) * Math.min(A, B);
}
/** The share of the ellipse's area the disc covers (sampled on a 24 x 24 grid over the disc). */
function ellCover(px: number, py: number, r: number, cx: number, cy: number, a: number, b: number): number {
  let inBoth = 0;
  for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { const u = -1 + (i + 0.5) / 12, v = -1 + (j + 0.5) / 12; if (u * u + v * v > 1) continue;
    const x = px + u * r, y = py + v * r; if (((x - cx) / a) ** 2 + ((y - cy) / b) ** 2 < 1) inBoth++; }
  return (inBoth / (24 * 24)) * (4 * r * r) / (Math.PI * a * b);
}
const b5: string[] = [];
const b5one: { cover: number; hide: number; room: number; sq: number; frac: number; gap: number }[] = [];
function homeRow(H: PlaceDef): { probs: string[]; lines: string[] } {
  const probs: string[] = [], lines: string[] = [];
  if (!SM.ok) { probs.push(SM.why); return { probs, lines }; }
  const Tf = Math.tan(17.5 * D2R);
  for (const fr of ['phone', 'desktop'] as const) {
    const TALLF = fr === 'phone', slotsAll = TALLF ? SM.TALL : SM.WIDE, frame = TALLF ? 'TALL' : 'WIDE';
    const spot = (i: number) => (TALLF ? { ...H.tall.things[i] } : { x: H.things[i].x, z: H.things[i].z, yaw: H.things[i].yaw, use: H.things[i].useSpot, fromN: H.things[i].fromN });
    const kind = (t: ThingDef): { box: boolean; hx: number; hz: number; h: number; col: boolean } => t.mech === MECH.block ? { box: true, hx: t.size[0], hz: t.size[2], h: t.p.shadeH ?? 2 * t.size[1], col: true }
      : t.mech === 0 ? { box: false, hx: t.size[0], hz: t.size[0], h: 0, col: false } : t.mech === MECH.pad ? { box: false, hx: t.size[0], hz: t.size[0], h: 0.06, col: true } : { box: false, hx: t.size[0], hz: t.size[0], h: 2 * t.size[0], col: true };
    const corners = (k: ReturnType<typeof kind>, x: number, z: number): number[][] => k.box ? [[x - k.hx, z - k.hz], [x + k.hx, z - k.hz], [x - k.hx, z + k.hz], [x + k.hx, z + k.hz]]
      : Array.from({ length: 8 }, (_, j) => [x + k.hx * Math.cos(j * Math.PI / 4), z + k.hx * Math.sin(j * Math.PI / 4)]);
    const dPt = (k: ReturnType<typeof kind>, x: number, z: number, px: number, pz: number): number => k.box ? Math.hypot(Math.max(Math.abs(px - x) - k.hx, 0), Math.max(Math.abs(pz - z) - k.hz, 0)) : Math.hypot(px - x, pz - z) - k.hx;
    const topPt = (k: ReturnType<typeof kind>, x: number, z: number): [number, number, number] => (!k.box && k.h < 0.05) ? [x, 0, z + k.hx * 0.6] : [x, k.h, z];
    H.things.forEach((t, i) => {
      const sp = spot(i), k = kind(t), from = sp.fromN ?? 9, issues: string[] = [];
      if (from > 3) issues.push(`fromN ${sp.fromN} (at most 3)`);
      // slot gap (every slot of the frame, every scale) and on the felt
      let gap = 9; for (const s of SCALES) for (const [a, bz] of slotsAll) gap = Math.min(gap, dPt(k, sp.x * s, sp.z * s, a * s, bz * s) - 0.5 * s);
      const need = t.mech === MECH.ball ? 0.05 : 0.275; if (k.col && gap < need - 1e-9) issues.push(`slot gap ${f2(gap)} m (needs ${need})`);
      for (const s of SCALES) for (const [x, z] of corners(k, sp.x * s, sp.z * s)) if (Math.hypot(x, z) > 3.4 + 1e-9) { issues.push('off the felt'); break; }
      // colliders 0.3 m apart
      H.things.forEach((u, j) => { if (j <= i) return; const ku = kind(u), su = spot(j); if (!k.col || !ku.col) return; let g = 9;
        for (const s of SCALES) { for (const [px, pz] of corners(k, sp.x * s, sp.z * s)) g = Math.min(g, dPt(ku, su.x * s, su.z * s, px, pz)); for (const [px, pz] of corners(ku, su.x * s, su.z * s)) g = Math.min(g, dPt(k, sp.x * s, sp.z * s, px, pz)); }
        if (g < 0.3 - 1e-9) issues.push(`${f2(g)} m from ${u.id}`); });
      // in view from fromN to 5 at every scale: footprint corners at y 0 and at its top inside the insets; its top centre seen
      // (round 5: the free ball where it really stands in that frame: its spot pushed into its bounds, ballAt)
      const ball = t.mech === MECH.ball, rb = t.size[0];
      for (let n = Math.min(from, 5); n <= 5; n++) for (const s of SCALES) for (const c of camsOf(fr, n, s)) { let x = sp.x * s, z = sp.z * s; if (ball) [x, z] = ballAt(c, x, z, rb);
        for (const [px, pz] of corners(k, x, z)) { if (!inIns(c, proj(c, px, 0, pz)) || (k.h > 0 && !inIns(c, proj(c, px, k.h, pz)))) { issues.push(`n${n} out of view`); break; } }
        const [tx, tyy, tz] = topPt(k, x, z), [psx, psy] = proj(c, tx, tyy, tz);
        for (const [bx, bz] of c.slots) { if (bz <= tz + 0.05) continue; const [cx, cy, ea, eb] = bodyEll(c, bx, bz);
          if (Math.hypot((psx - cx) / ea, (psy - cy) / eb) < 0.95) { issues.push(`n${n} behind a body`); break; } }
        H.things.forEach((u, j) => { if (j === i) return; const ku = kind(u), su = spot(j); if (!ku.col || ku.h < 0.05 || (su.fromN ?? 9) > n || su.z * s <= z) return;
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const dx of [-ku.hx, ku.hx]) for (const dz of [-ku.hz, ku.hz]) for (const y of [0, ku.h]) { const [qx, qy] = proj(c, su.x * s + dx, y, su.z * s + dz); x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy); }
          if (psx > x0 && psx < x1 && psy > y0 && psy < y1) issues.push(`n${n} behind ${u.id}`); }); }
      // B5 (round 5, VERDICT_PG): the Felt Ball where it stands (ballAt) against every slot body on screen (bodyEll: the body in the rest shape
      // its camera was framed for): it covers NO body (its disc overlaps no farther body's disc: never in front of a squishy, never
      // over its squeeze area) and hides behind none on a phone (no nearer body's disc overlaps it; WIDE: at most half its width, since a desktop
      // party of four or five is one row 1.3 m apart with 0.3 m gaps, so the ball can be beside none of them: behind a gap is the place that covers
      // none), its spot lies inside its bounds (no push), and with one squishy out (FN-01's first play) the boop from the home slot through the
      // ball has 0.25 m of free roll in its bounds (0.2 m + a margin).
      // TALL with one squishy out is checked by its own row (B5 one out, below): the same rules (covers none, hides behind none, 0.25 m of roll),
      // measured where the ball stands then (its spot pushed into its bounds), kept apart because the shipped portrait one-body view cannot hold
      // them (the row says why); this row stays strict for every other party and frame.
      if (ball) { let cover = 0, coverN = '', hide = 0, push = 0, room = 9;
        const one = { cover: 0, hide: 0, room: 9, sq: -9, frac: 0, gap: 9 };   // TALL with one out (the B5 one-out row)
        for (let n = Math.min(from, 5); n <= 5; n++) for (const s of SCALES) for (const c of camsOf(fr, n, s)) {
          const [x, z] = ballAt(c, sp.x * s, sp.z * s, rb), isOne = TALLF && n === 1, [bx, by, br, bd] = discOf(c, x, rb, z, rb);
          if (!isOne) push = Math.max(push, Math.hypot(x - sp.x * s, z - sp.z * s));
          c.slots.forEach(([qx, qz], q) => { const R = 0.5 * s, [cx, cy, ea, eb, cd] = bodyEll(c, qx, qz), ov = ellReach(bx, by, br, cx, cy, ea, eb);
            if (isOne) { one.gap = Math.min(one.gap, Math.hypot(x - qx, z - qz) - R - rb);
              if (cd > bd) { one.sq = Math.max(one.sq, ellReach(bx, by, br, cx, cy, ea, eb, 0.6)); one.frac = Math.max(one.frac, ellCover(bx, by, br, cx, cy, ea, eb)); if (ov > 0) one.cover = Math.max(one.cover, ov); }
              else if (ov > 0) one.hide = Math.max(one.hide, ov / (2 * br)); return; }
            if (ov <= 0) return;
            if (cd > bd) { if (ov > cover) { cover = ov; coverN = `n${n} s${s} slot ${q}`; } } else hide = Math.max(hide, ov / (2 * br)); });
          if (n === 1) { let dx = x - c.slots[0][0], dz = z - c.slots[0][1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl; const rr = rollRoom(c, x, z, dx, dz, rb);
            if (isOne) one.room = Math.min(one.room, rr); else room = Math.min(room, rr); }
        }
        if (cover > 0) issues.push(`B5 in front of a body (${coverN}: ${cover.toFixed(1)} px over it)`);
        if (hide > (TALLF ? 0 : 0.5)) issues.push(`B5 behind a body (${(hide * 100).toFixed(0)}% of its width hidden, at most ${TALLF ? 0 : 50})`);
        if (push > 1e-6) issues.push(`B5 the spot lies outside its bounds (pushed ${f2(push)} m)`);
        if (!TALLF && from <= 1 && room < 0.25 - 1e-9) issues.push(`B5 one out: ${f2(room)} m of roll room (at least 0.25)`);
        if (TALLF && from <= 1) b5one.push(one);
        b5.push(`${frame} n${TALLF ? Math.max(2, from) : from}..5: covers ${cover.toFixed(1)} px, ${(hide * 100).toFixed(0)}% hidden, pushed ${f2(push)} m${TALLF ? '' : `, one-out roll room ${f2(room)} m`}`);
      }
      // nothing static over 0.4 m tall in front of the front slot row
      if (!isMoving(t) && k.h > 0.4 && sp.z - k.hz >= 0.5) issues.push(`${f2(k.h)} m tall in front of the front row`);
      // its use spot: a whole body in view from fromN to 5, clear of the other slot bodies (the lamp's: inside its glow, clear of its base)
      const use = sp.use; if (use) { const user = t.id === 'snoozerug' ? 1 : 0; let worst = 9;
        for (let n = Math.max(from, user + 1); n <= 5; n++) for (const s of SCALES) for (const c of camsOf(fr, n, s)) { const R = 0.5 * s, x = use[0] * s, z = use[1] * s, Sh = SHAPES[c.sh], hwR = Math.max(1, Sh.hw) * R;
          let inv = Math.hypot(x, z) <= 3.4 - R; for (const dx of [-hwR, hwR]) for (const dz of [-hwR, hwR]) for (const y of [0, Sh.h * R]) if (!inIns(c, proj(c, x + dx, y, z + dz))) inv = false;
          if (!inv) { issues.push(`use spot n${n} s${s} not wholly in view`); break; }
          for (let q = 0; q < n; q++) { if (q === user) continue; const [ax, az] = slotsAll[q], d = Math.hypot(x - ax * s, z - az * s) - 2 * R; worst = Math.min(worst, d); if (d < -0.02) { issues.push(`use spot n${n} overlaps slot ${q}'s body`); break; } }
          if (t.id === 'warmlamp') { const zr = H.zones[0].r ?? 0, lx = sp.x * s, lz = sp.z * s; if (Math.hypot(x - lx, z - lz) > zr - 0.02) issues.push('use spot outside the glow');
            if (Math.max(Math.abs(x - lx) - k.hx, 0) ** 2 + Math.max(Math.abs(z - lz) - k.hz, 0) ** 2 < (R + 0.02) ** 2) issues.push('use spot inside the lamp base'); }
          if (t.id === 'bouncepad' && Math.hypot(x - sp.x * s, z - sp.z * s) > t.size[0] - 0.1 + 1e-9) issues.push('use spot not on the pad');
          if (t.id === 'snoozerug' && Math.abs(Math.hypot(x, z) - 2 * R) > 0.05 + 1e-9) issues.push('the second napper does not lie against slot 0'); } }
      if (t.id === 'snoozerug') for (const s of SCALES) if (Math.hypot(sp.x * s, sp.z * s) > 0.65 + 1e-9) { issues.push(`rug centre ${f2(Math.hypot(sp.x * s, sp.z * s))} m from slot 0 (at most 0.65)`); break; }
      const uniq = [...new Set(issues.map((x) => x.replace(/ s[0-9.]+/, '')))];
      lines.push(`${frame} ${t.id} (${sp.x}, ${sp.z}) from ${sp.fromN}: slot gap ${k.col ? f2(gap) : 'walk-on'}${uniq.length ? ' ISSUES ' + uniq.slice(0, 4).join('; ') : ' ok'}`);
      for (const u of uniq) probs.push(`${frame} ${t.id}: ${u}`);
    });
    // every slot centre inside the corral rectangle (visibleTable and every slot body in use + 0.05: D-87)
    for (let n = 1; n <= 5; n++) for (const s of SCALES) for (const c of camsOf(fr, n, s)) { const v = visibleTable(c), R = 0.5 * s;
      // the model's box against the stage's own pure projection (src/render/homeview.ts visibleTableAt, called as stage.visibleTable calls it: the
      // reported rows moved by the lens goal, no side rows)
      const real = [0, 0, 0, 0]; visibleTableAt(c.aim[0], c.aim[1], c.aim[2], c.d, SM.pitch, SM.fov, c.W, c.H, c.si.t + c.ly * c.H * 0.5, 0, c.si.b - c.ly * c.H * 0.5, 0, real);
      if (real.some((q, j) => Math.abs(q - v[j]) > 1e-6)) probs.push(`${frame} n${n} s${s}: the model's visible table [${v.map(f2)}] differs from homeview.visibleTableAt [${real.map(f2)}]`);
      let x0 = v[0], z0 = v[1], x1 = v[2], z1 = v[3]; for (const [x, z] of c.slots) { x0 = Math.min(x0, x - R - 0.05); x1 = Math.max(x1, x + R + 0.05); z0 = Math.min(z0, z - R - 0.05); z1 = Math.max(z1, z + R + 0.05); }
      for (const [x, z] of c.slots) if (x < x0 || x > x1 || z < z0 || z > z1) probs.push(`${frame} n${n} s${s}: a slot centre outside the corral`); }
  }
  return { probs, lines };
}
for (const P of DEFS) {
  const strict = STRICT_PLACES.includes(P.id);
  if (P.id === 'home') {
    const h = homeRow(P);
    if (VERBOSE || h.probs.length) for (const l of [...h.lines, ...b5.map((x) => `B5 feltball ${x}`)]) console.log('     ' + l);
    row('DT-01', h.probs.length === 0, 'Home: every thing\'s TALL and WIDE spot (slot gap, felt, 0.3 m apart, in view and seen from its fromN at every scale, front-row height, use spots, rug, corral; '
      + 'round 5: the shipped camera with SR2\'s band framing and the measured rows, three rest shapes; B5: the Felt Ball covers no squishy and hides behind none, inside its bounds, 0.25 m of first-play roll)',
      h.probs.length ? h.probs.slice(0, 6).join(' | ') : `${P.things.length} things x 2 frames x n 1..5 x ${SCALES.length} scales x ${SHAPES.length} shapes, stage.ts + framing.ts model ok; ${b5.join('; ')}`);
    // B5 with ONE squishy out on a phone (VERDICT_PG B5, the orchestrator's round-5 ask: "beside the play squishy, never in front of it or over the
    // squeeze area, and its first-play roll at least 0.2 m"): the same rules as the Home row's B5, where the ball stands with one out (its spot
    // pushed into its bounds). Kept as its own row because the shipped camera cannot hold them: the one-body portrait view is the body plus about
    // 66 px of floor to each side, and the ball's bounds (the visible table's near row) keep its centre within about +-0.31 m of the middle, so
    // every spot there is in front of the body or behind it. It passes once Home's rest framing makes room for the ball with one out on a portrait
    // frame (PLAYGROUND_BUILD 24.1 (a): RENDER's framingFor counting the ball's spot as it counts a capsule), then this model gains that framing.
    { const o = b5one[0], ok = !!o && o.cover <= 0 && o.hide <= 0 && o.room >= 0.25 - 1e-9;
      // the proof that no spot can: every spot of a 0.05 slot-unit grid over the one-out bounds (x +-0.8, z -3.2 to 2.2), at every scale and shape,
      // where the ball would stand (pushed into its bounds), against the same rules plus 0.05 m from the body and in view
      let tried = 0, found = '';
      if (!ok) for (let gz = -3.2; gz <= 2.2 + 1e-9 && !found; gz += 0.05) for (let gx = -0.8; gx <= 0.8 + 1e-9 && !found; gx += 0.05) { tried++;
        let good = true;
        for (const s of SCALES) { for (const c of camsOf('phone', 1, s)) { const rb = P.things[0].size[0], [x, z] = ballAt(c, gx * s, gz * s, rb), [bx, by, br, bd] = discOf(c, x, rb, z, rb), [cx, cy, ea, eb, cd] = bodyEll(c, 0, 0);
          const ov = ellReach(bx, by, br, cx, cy, ea, eb), dl = Math.hypot(x, z) || 1;
          if (ov > 0 || Math.hypot(x, z) - 0.5 * s - rb < 0.05 || rollRoom(c, x, z, x / dl, z / dl, rb) < 0.25 || !inIns(c, [bx - br, by]) || !inIns(c, [bx + br, by]) || !inIns(c, [bx, by - br]) || !inIns(c, [bx, by + br])) { good = false; break; } void cd; void bd; }
          if (!good) break; }
        if (good) found = `${gx.toFixed(2)}, ${gz.toFixed(2)}`; }
      row('DT-01', ok, 'Home B5, one squishy out on a phone (TALL n = 1): the Felt Ball where it stands covers no part of the squishy and hides behind none, with 0.25 m of first-play roll',
        o ? `${ok ? '' : found ? `the spot (${found}) would pass: re-lay it; ` : `no spot can with the shipped camera (${tried} spots tried; needs RENDER: PLAYGROUND_BUILD 24.1 (a), the one-out portrait framing makes room for the ball); `}it covers ${o.cover.toFixed(1)} px of the body (${(o.frac * 100).toFixed(1)}% of it, ${o.sq > 0 ? `${o.sq.toFixed(1)} px into` : 'clear of'} its squeeze area), ${(o.hide * 100).toFixed(0)}% hidden, ${f2(o.gap)} m from it, ${f2(o.room)} m of roll room (worst scale and shape)` : 'no ball'); }
    continue;
  }
  for (const tall of [false, true]) {
    const probs = checkPlace(P, tall), label = `${P.name} ${tall ? 'tall' : 'wide'}`;
    if (strict) row('DT-01', probs.length === 0, `${label}: frame, pad, zones, spawn, rides and push spots, use / peek / gap spots, clearances, bands, ranges, floor rule, opening, counts`,
      probs.length ? `${probs.length} problems: ${probs.slice(0, 6).join(' | ')}` : '0 problems');
    if (strict && P.shipped) { const cp = camProblems(P, tall);
      row('DT-01', cp.length === 0, `${label} in the shipped place camera (B8, round 5): every collider inside the frame's sides and its floor above the bottom HUD (${tall ? 'the hint pill, 618 px' : 'the party row, 664 px'})`,
        cp.length ? `${cp.length} problems: ${cp.join(' | ')}` : '0 problems'); }
    else { note('DT-01', `${label}: PENDING its slice (${P.id === 'ripple' || P.id === 'frostbell' || P.id === 'rainleaf' ? 'S2' : 'S3'}): ${probs.length} problems${probs.length && !VERBOSE ? ' (--verbose lists them)' : ''}`);
      if (VERBOSE) for (const p of probs) console.log('       ' + p); }
  }
}

/* ═══════════════════════════════ DT-02: the name gate split, the copy words, P15, CS-05 on names ═══════════════════════════════ */
const PLACES_MD = readFileSync(resolve(ROOT, '_spec/PLACES.md'), 'utf8');
function placeCells(): { where: string; fam: string; text: string; col: string }[] {
  const out: { where: string; fam: string; text: string; col: string }[] = [], lines = PLACES_MD.split('\n'); let sec = '';
  for (let i = 0; i < lines.length; i++) { const h = /^###\s+(\d\.\d+)/.exec(lines[i]); if (h) sec = h[1];
    if (!lines[i].startsWith('| Family |') || !/^(3\.[123]|4\.\d+)$/.test(sec)) continue;
    const cols = lines[i].split('|').slice(2, -1).map((s) => s.trim()); if (cols[0].startsWith('density') || cols[0].startsWith('R 0.40')) continue;
    for (let k = i + 2; k < i + 14; k++) { const c = lines[k].split('|').slice(1, -1).map((s) => s.trim()); c.slice(1).forEach((text, j) => out.push({ where: sec, fam: c[0], text, col: cols[j] })); } }
  return out;
}
const CELLS = placeCells();
const stripTags = (t: string): string => t.replace(/(^|[\s,;])[PLSB](?=$|[\s,;])/g, '$1').replace(/\s+/g, ' ').trim();
{
  const coined = new Set<string>(PLACE_INFO.flatMap((p) => p.coined ?? []));
  const names: string[] = [...PLACE_INFO.map((p) => p.name), ...Object.values(THING_TEXT).map((t) => t[0]), ...Object.values(AREA_TEXT), ...KEEPSAKE_TEXT.map((k) => k[0]), ...CHAPTER_TEXT];
  const lines: string[] = [...QUEST_TEXT.flat(), ...HOME_TEXT.quests.flat(), HOME_TEXT.chapter, ...Object.values(THING_TEXT).map((t) => t[1]).filter(Boolean), ...KEEPSAKE_TEXT.flatMap((k) => [k[1], k[2]]),
    ...FACT_LINES.found, ...FACT_LINES.hint.filter(Boolean), FACT_LINES.friendPlace, FACT_LINES.friendFamily, ...Object.values(TOUCH_WORDS), ...Object.values(FAMILY_LINES).flat(),
    ...flatStrings(WISH_LINES), ...flatStrings(GIFT_LINES), ...flatStrings(UI_TEXT), ...BUBBLE_WORDS.filter(Boolean), ...BUBBLE_MEANINGS.filter(Boolean), ...TRAIT_WORDS, ...Object.values(STAR_MEANINGS)];
  const cellTexts = CELLS.map((c) => stripTags(c.text));
  const hits: string[] = [];
  for (const n of names) for (const w of n.split(/[\s,-]+/).filter(Boolean)) { const r = coined.has(w) ? nameReason(w) : proseReason(w); if (r) hits.push(`name "${n}" (${w}): ${r}`); }
  for (const c of coined) { const r = nameReason(c); if (r) hits.push(`coined "${c}": ${r}`); }
  for (const t of [...lines, ...cellTexts]) { const r = proseReason(t); if (r) hits.push(`"${t}": ${r}`); }
  const COPY = /\b(sad|lonely|grumpy|hurt|hurry)\b|misses you|come back/i;
  for (const t of [...lines, ...cellTexts]) if (COPY.test(t)) hits.push(`copy word in "${t}"`);
  for (const c of CELLS) if (c.fam === 'popdome' && /\b(pop|pops|popping|flip|flips|snap|snaps)\b/i.test(c.text)) hits.push(`pop dome promise in "${c.text}"`);
  for (const t of Object.values(FAMILY_LINES.popdome)) if (/\b(pop|flip|snap)/i.test(t)) hits.push(`pop dome promise in "${t}"`);
  // CS-05 on names only
  const species = CATALOG.map((d) => d.name.toLowerCase());
  const lev = (a: string, b: string): number => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; };
  for (const n of names) for (const w of n.toLowerCase().split(/[^a-z]+/).filter((x) => x.length >= 4)) for (const sp of species) if (w.slice(0, 4) === sp.slice(0, 4)) hits.push(`CS-05: "${n}" shares "${w.slice(0, 4)}" with ${sp}`);
  for (const c of coined) for (const sp of species) if (lev(c.toLowerCase(), sp) <= 2) hits.push(`CS-05: coined "${c}" within 2 of ${sp}`);
  const cl = [...coined].map((c) => c.toLowerCase()); for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) if (cl[i].slice(0, 4) === cl[j].slice(0, 4)) hits.push(`CS-05: coined "${cl[i]}" and "${cl[j]}" share a prefix`);
  row('DT-02', hits.length === 0, `name gate split (NAME rules on ${coined.size} coined words, PROSE on ${names.length} names, ${lines.length} lines and ${cellTexts.length} PLACES 3/4 cells), copy words, P15, CS-05 on names`,
    hits.length ? `${hits.length} hits: ${hits.slice(0, 5).join(' | ')}` : '0 hits');
}
function flatStrings(o: unknown): string[] { if (typeof o === 'string') return o ? [o] : []; if (Array.isArray(o)) return o.flatMap(flatStrings); if (o && typeof o === 'object') return Object.values(o).flatMap(flatStrings); return []; }

/* ═══════════════════════════════ DT-03, DT-04: favourites and best friends ═══════════════════════════════ */
const SL = SPECIES_LIFE as Readonly<Record<SpeciesId, { place: PlaceId; thing: string; friend: SpeciesId }>>;
{
  const probs: string[] = [], byId = new Map(CATALOG.map((d) => [d.id, d] as const));
  if (Object.keys(SL).length !== 50 || CATALOG.some((d) => !SL[d.id])) probs.push('not 50 rows');
  const thingsOf = new Map(DEFS.map((P) => [P.id, P] as const));
  for (const P of DEFS) { if (P.id === 'home') continue; const fans = CATALOG.filter((d) => SL[d.id].place === P.id);
    if (fans.length < 4) probs.push(`${P.id}: ${fans.length} fans`); if (!fans.some((d) => d.tier === 'common')) probs.push(`${P.id}: no Common fan`); }
  for (const f of MATERIAL_FAMILY_IDS) { const pl = new Set(CATALOG.filter((d) => d.family === f).map((d) => SL[d.id].place)); if (pl.size < 2) probs.push(`${f} in ${pl.size} place`); }
  const selfVerbs: readonly number[] = [USE_VERB.ROLL, USE_VERB.RING, USE_VERB.NAP, USE_VERB.BOUNCE, USE_VERB.SPIN, USE_VERB.WADE, USE_VERB.LEAN, USE_VERB.FLOAT_ON, USE_VERB.STEP, USE_VERB.LISTEN];
  for (const d of CATALOG) { const s = SL[d.id], P = thingsOf.get(s.place)!, t = P.things.find((x) => x.id === s.thing);
    if (!t) { probs.push(`${d.id}: ${s.thing} is not in ${s.place}`); continue; }
    // A block's by-itself use counts only when it is a tuned block (LIFE 5.3: "chime, bell, crystal, lantern: bump past it (a contact strikes it)";
    // the Singing Crystals are tuned M1 blocks, PLACES 4.9); any other block favourite needs a zone or patch, a ride or a switch.
    const owns = P.zones.some((z) => ownsArea(t.zone, z.id)) || P.patches.some((p) => ownsArea(t.patch, p.id)), self = selfVerbs.includes(t.verb) && (t.mech !== MECH.block || (t.verb === USE_VERB.RING && !!t.p.tuned)) || owns;
    if (!(self || t.ride || t.switch)) probs.push(`${d.id}: favourite ${t.id} has no self event, ride or switch`); }
  for (const [ch, list] of Object.entries(GIFT_LISTS)) { const c = Number(ch); if (list.length !== 3) probs.push(`gift list ${ch} has ${list.length}`);
    for (const id of list) { const d = byId.get(id)!; if (d.tier !== 'common' && d.tier !== 'uncommon') probs.push(`gift ${id} is ${d.tier}`);
      if (c < 10 && SL[id].place !== PLACE_IDS[c + 1]) probs.push(`gift ${id} (chapter ${ch}) does not love ${PLACE_IDS[c + 1]}`); } }
  row('DT-03', probs.length === 0, 'favourites: 50 rows, 4+ fans and a Common per place, every family in 2+ places, the thing in the place, every favourite has a self event / ride / switch, the gift lists', probs.slice(0, 5).join(' | '));
  const p4: string[] = [], laneOf = (id: SpeciesId): string => byId.get(id)!.lane, tierIdx = (id: SpeciesId): number => ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].indexOf(byId.get(id)!.tier);
  for (const d of CATALOG) { const f = SL[d.id].friend; if (f === d.id || SL[f].friend !== d.id) p4.push(`${d.id} ~ ${f} not symmetric`); if (laneOf(f) === laneOf(d.id)) p4.push(`${d.id} ~ ${f} same lane`);
    if (Math.abs(tierIdx(f) - tierIdx(d.id)) > 1) p4.push(`${d.id} ~ ${f} tier gap`); }
  row('DT-04', p4.length === 0 && LANES.length === 6, 'best friends: a perfect matching (25 pairs), symmetric, across lanes, tier gap at most 1', p4.slice(0, 5).join(' | '));
}

/* ═══════════════════════════════ DT-05: family numbers and gaits ═══════════════════════════════ */
{
  const p: string[] = [], FR = FAMILY_REACT as Readonly<Record<string, Record<string, unknown>>>, GA = GAITS as Readonly<Record<string, Record<string, unknown>>>;
  for (const f of MATERIAL_FAMILY_IDS) { const r = FR[f], g = GA[f]; if (!r || !g) { p.push(`${f} missing`); continue; }
    const n = (k: string, o: Record<string, unknown>): number => o[k] as number;
    if (!(n('density', r) > 0 && n('density', r) <= 2 && n('soakedDensity', r) >= n('density', r))) p.push(`${f} density`);
    if (!(n('iceGrip', r) > 0 && n('iceGrip', r) <= 1 && n('catch', r) >= 0 && n('catch', r) <= 1)) p.push(`${f} grip / catch`);
    if (!(n('bounceGain', r) >= 0.3 && n('bounceGain', r) <= 1.3 && n('warmPose', r) >= 0.75 && n('warmPose', r) <= 1.12 && n('coldSpeed', r) >= 0.4 && n('coldSpeed', r) <= 1.2)) p.push(`${f} bounce / pose / cold`);
    if (!(n('flavour', r) >= 0 && n('flavour', r) <= 5)) p.push(`${f} flavour`);
    if (!(n('vyS1', g) <= 0.84 + 1e-9 && n('vyS2', g) >= n('vyS1', g) && n('glide', g) >= 0.04 && n('glide', g) <= 0.5 && n('squash', g) >= 0.75 && n('squash', g) <= 1)) p.push(`${f} gait`);
    if (!g.hops && n('vyS1', g) !== 0) p.push(`${f} hops off but vy`); }
  const apex = 0.84 ** 2 / (2 * 10);
  row('DT-05', p.length === 0 && Object.keys(FR).length === 12 && Object.keys(GA).length === 12, `FAMILY_REACT and GAITS cover the 12 families in range; S1 hop vy at most 0.84 (apex ${(apex * 100).toFixed(2)} cm with GRAVITY 10)`, p.join(' | '));
}

/* ═══════════════════════════════ DT-06: every family has 3+ reactions with a real channel in every place ═══════════════════════════════ */
{
  const valid = (chan: number, arg: number): boolean => {
    switch (chan) { case CHANNEL.PHYS: return Object.values(PHYS_ARG).includes(arg as never); case CHANNEL.POSE: return arg >= 75 && arg <= 112; case CHANNEL.RPOSE: return Object.values(RPOSE).includes(arg as never);
      case CHANNEL.LOOK: return Math.floor(arg / 100) in [0, 1, 2, 3, 4, 5] && arg % 100 > 0 && Math.floor(arg / 100) <= LOOK.toast; case CHANNEL.PARTICLE: return Object.values(PARTICLE).includes(arg as never);
      case CHANNEL.SOUND: return Object.values(REACT_SOUND).includes(arg as never); case CHANNEL.BEHAV: return (arg >= 1 && arg <= 21) || (arg > 100 && arg <= 118); case CHANNEL.MARK: return arg >= 1 && arg <= 5; default: return false; } };
  const p: string[] = [], counts: string[] = [];
  for (const P of DEFS) { let min = 99;
    for (let f = 0; f < 12; f++) { const cells = new Set(P.reactions.filter((r) => r.family === f && valid(r.chan, r.arg)).map((r) => r.target)); min = Math.min(min, cells.size); if (cells.size < 3) p.push(`${P.id} ${MATERIAL_FAMILY_IDS[f]}: ${cells.size}`); }
    for (const r of P.reactions) { if (!valid(r.chan, r.arg)) p.push(`${P.id} bad channel ${r.chan}/${r.arg}`); if (r.target >= 100 ? !P.zones[r.target - 100] : !P.things[r.target]) p.push(`${P.id} bad target ${r.target}`); }
    counts.push(`${P.id} ${min}`); }
  for (const [col, cells] of Object.entries(DEFAULT_REACTIONS)) cells.forEach((c, f) => { if (!c.length || c.some((e) => !valid(e.chan, e.arg))) p.push(`default ${col} ${MATERIAL_FAMILY_IDS[f]}`); });
  row('DT-06', p.length === 0, `every family has 3+ cells with a real channel in every place, every channel valid, every default cell channelled (min per family: ${counts.join(', ')})`, p.slice(0, 5).join(' | '));
}

/* ═══════════════════════════════ DT-07: flat, acyclic, each loads first ═══════════════════════════════ */
{
  const dir = resolve(ROOT, 'src/data'), mine = readdirSync(dir).filter((f) => /^(places|life|quests|journal_text|place_[a-z]+)\.ts$/.test(f)), files = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => resolve(dir, f));
  const edges = new Map<string, string[]>();
  for (const f of files) { const src = readFileSync(f, 'utf8'), deps: string[] = []; for (const m of src.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+)'/gm)) { const t = resolve(dirname(f), m[1]); if (files.includes(t)) deps.push(t); } edges.set(f, deps); }
  const cycles: string[] = [], state = new Map<string, number>(), stack: string[] = [];
  const visit = (f: string): void => { state.set(f, 1); stack.push(f); for (const d of edges.get(f) ?? []) { if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d].map((x) => relative(dir, x)).join(' -> ')); else if (!state.get(d)) visit(d); } stack.pop(); state.set(f, 2); };
  for (const f of files) if (!state.get(f)) visit(f);
  const failed: string[] = [];
  for (const f of mine) { const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(resolve(dir, f)).href)});`], { encoding: 'utf8' }); if (r.status !== 0) failed.push(f); }
  const text = (f: string): string => readFileSync(resolve(dir, f), 'utf8');
  const jt = mine.filter((f) => f !== 'journal_text.ts' && /from '\.\/journal_text\.ts'/.test(text(f)));
  const bad7 = mine.filter((f) => /from '\.\.\/(core\/quests|life\/)|from '\.\.\/(render|shell|ui|audio|physics)\//.test(text(f)));
  row('DT-07', mine.length === 14 && cycles.length === 0 && failed.length === 0 && jt.length === 0 && bad7.length === 0, `the ${mine.length} data modules are flat in src/data, the value-import graph is acyclic, each loads first in a bare node, journal_text.ts is imported by none of them`,
    [...cycles, ...failed.map((f) => 'load ' + f), ...jt.map((f) => 'imports journal_text: ' + f), ...bad7.map((f) => 'forbidden import: ' + f)].join(' | '));
}

/* ═══════════════════════════════ DT-08: lengths and readability (QUESTS Q10) ═══════════════════════════════ */
{
  const p: string[] = [];
  if (QUEST_TEXT.length !== 110) p.push(`${QUEST_TEXT.length} quest texts`);
  QUEST_TEXT.forEach(([t, h], i) => { if (t.length > 32) p.push(`${QUESTS[i].id} title ${t.length} chars`); if (h.length > 90) p.push(`${QUESTS[i].id} hint ${h.length} chars`);
    for (const s of h.split(/(?<=[.!?])\s+/)) if (s.split(/\s+/).filter(Boolean).length > 12) p.push(`${QUESTS[i].id} sentence over 12 words`); });
  HOME_TEXT.quests.forEach(([t, h], i) => { if (t !== QUEST_TEXT[i][0] || h !== QUEST_TEXT[i][1]) p.push(`HOME_TEXT ${i} differs from QUEST_TEXT`); });
  const all = [...QUEST_TEXT.flat(), ...flatStrings(WISH_LINES), ...flatStrings(GIFT_LINES), ...flatStrings(UI_TEXT), ...flatStrings(FACT_LINES), ...KEEPSAKE_TEXT.flat(), ...BUBBLE_MEANINGS];
  for (const t of all) { if ((t.match(/!/g) ?? []).length > 1) p.push(`two "!" in "${t}"`); for (const s of t.split(/(?<=[.!?])\s+/)) if (s.split(/\s+/).filter(Boolean).length > 12) p.push(`over 12 words: "${s}"`); }
  for (const w of BUBBLE_WORDS) if (w.split(' ').length > 2) p.push(`bubble word "${w}"`);
  if (KEEPSAKE_TEXT.length !== KEEPSAKES.length || CHAPTER_TEXT.length !== CHAPTERS.length || Object.keys(THING_TEXT).length !== THING_IDS.length) p.push('a text table does not match its ids');
  row('DT-08', p.length === 0, 'text lengths: titles <= 32, hints <= 90, <= 12 words a sentence, at most one "!" per text; text tables match their ids', p.slice(0, 5).join(' | '));
}

/* ═══════════════════════════════ DT-09: a title's verb matches its rule's event (VISIT exempt); a hint matches its count ═══════════════════════════════ */
{
  /** The reviewed keyword table: an event kind and the words a title may use for it (printed below for review by hand). Engineer 2's review
   *  (2026-11-16) added words for QUESTS 6 titles: USE "down" (I7 "Down the glide ramp": sliding down it, USE SLIDE), SOCIAL "roll" (U7 "Roll
   *  the cloud ball": S12 pass the ball, "each in turn boops the ball toward the other", LIFE 6.1). Round 2 took USE "scale" out again: E3's
   *  noun title "Crystal scale" is now "Ring the crystals" (Q7: a title says what you do), so no title needs it. */
  const KW: Record<number, RegExp> = {
    [EV.TOUCH]: /squeeze|stretch/i, [EV.USE]: /play|roll|chase|answer|kettle|ring|slide|whee|ride|round|boing|bounce|tap|wind|marble|magnet|sing|ding|light|lantern|vane|star|echo|swing|push|machine|fireside|down/i,
    [EV.CAPSULE]: /capsule/i, [EV.SOCIAL]: /hello|nap|push|rocker|teeter|song|sing|snuggle|pass|peekaboo|squirt|nuzzle|snug|follow|leader|copy|parade|echo|turn|machine|swing|roll/i,
    [EV.UI]: /bubble/i, [EV.WISH]: /wish/i, [EV.REACT]: /cozy|toast|golden|pool|frosty|zoom|ice|snow|pine|splash|shower|soak|float|sit|fizz|moon|hold on|breeze|glow|water|fire|way|react|drift|tap/i,
    [EV.PIECES]: /bits/i, [EV.DISCOVER]: /loves|best friends/i, [EV.FRIEND]: /friends/i, [EV.PHOTO]: /picture|rain stops/i };
  const NUM: Record<number, RegExp> = { 2: /\b(two|twice)\b/i, 3: /\bthree\b/i, 4: /\bfour\b/i, 5: /\bfive\b/i };
  const p: string[] = [];
  QUESTS.forEach((q, i) => { const [title, hint] = QUEST_TEXT[i];
    if (!q.clauses.every((c) => c.ev === EV.VISIT)) { if (!q.clauses.some((c) => KW[c.ev]?.test(title))) p.push(`${q.id} "${title}" has no verb for ${q.clauses.map((c) => Object.keys(EV).find((k) => EV[k as keyof typeof EV] === c.ev)).join('+')}`); }
    else if (!/^Go to |^Visit /.test(hint)) p.push(`${q.id} VISIT hint "${hint}" does not carry the verb`);
    for (const c of q.clauses) { const n = c.count; if (n >= 2 && !NUM[n]?.test(hint)) p.push(`${q.id} hint "${hint}" does not say x${n}`); if ((c.minN ?? 0) >= 2 && !NUM[c.minN!]?.test(hint) && !(c.ev === EV.PHOTO)) p.push(`${q.id} hint does not say ${c.minN}`); } });
  if (VERBOSE) for (const [k, re] of Object.entries(KW)) console.log(`     DT-09 keyword table: ${Object.keys(EV).find((x) => EV[x as keyof typeof EV] === Number(k))} = ${re.source}`);
  row('DT-09', p.length === 0, 'every non-VISIT title has a verb of its rule\'s event (the keyword table, --verbose prints it), every VISIT hint carries "Go to", every hint says its count', p.slice(0, 5).join(' | '));
}

/* ═══════════════════════════════ DT-10: the float table, the water cells, the eye line ═══════════════════════════════ */
{
  const share = (h: number, R: number): number => (h >= 2 * R ? 1 : (h * h * (3 * R - h)) / (4 * R ** 3)), BANDS = [0.4, 0.5, 0.625], p: string[] = [], table: string[] = [];
  const FR = FAMILY_REACT as Readonly<Record<string, { density: number; soakedDensity: number }>>;
  const deep = DEFS.flatMap((P) => P.zones.filter((z) => z.kind === ZONE.water && (z.surfaceY ?? 0) >= 0.12).map((z) => ({ P, z })));
  const floats = (f: string, h: number, soaked = false): boolean[] => BANDS.map((R) => share(h, R) > (soaked ? FR[f].soakedDensity : FR[f].density));
  const soaks = (f: string): boolean => FR[f].soakedDensity !== FR[f].density;
  for (const f of MATERIAL_FAMILY_IDS) table.push(`${f} ${floats(f, 0.28).map((x) => (x ? 'F' : 's')).join('')}${soaks(f) ? '/' + floats(f, 0.28, true).map((x) => (x ? 'F' : 's')).join('') + ' soaked' : ''}`);
  // PLACES 2.5's own figures for the 0.28 m pool (share 0.282 / 0.191 / 0.128) and its soaked row (slow-rise and marshmallow sit at every band)
  BANDS.forEach((R, k) => { if (Math.abs(share(0.28, R) - [0.282, 0.191, 0.128][k]) > 0.0015) p.push(`share(0.28, ${R}) = ${share(0.28, R).toFixed(3)}, PLACES 2.5 says ${[0.282, 0.191, 0.128][k]}`); });
  for (const f of ['slowrise', 'marshmallow']) if (!soaks(f) || floats(f, 0.28, true).some(Boolean)) p.push(`${f} soaked does not sit at every band (PLACES 2.5)`);
  for (const P of DEFS) for (const z of P.zones) if (z.kind === ZONE.water && (z.surfaceY ?? 0) >= 0.12) for (const f of MATERIAL_FAMILY_IDS) if (soaks(f) && floats(f, z.surfaceY!, true).some(Boolean)) p.push(`${f} soaked floats in ${P.id} ${z.id}`);
  // every water cell (the default pool column and each place's deep-water columns) against the table, at every deep zone of that place
  const WATER_COLS: Record<string, string[]> = { '3.1': ['Pool (0.28 m)'], '4.3': ['Rock Pool'], '4.4': ['Steam Pool'], '4.6': ['Bath Water'], '4.9': ['Glow Pool'] };
  const placeOfSec = (sec: string): PlaceDef | undefined => DEFS.find((P) => `4.${P.idx + 1}` === sec);
  for (const c of CELLS) { if (!WATER_COLS[c.where]?.includes(c.col)) continue; const P = placeOfSec(c.where), zs = P ? deep.filter((d) => d.P === P).map((d) => d.z.surfaceY!) : [0.28];
    const says = /\bfloats?\b/i.test(c.text) ? (/if small/i.test(c.text) ? 'small' : 'floats') : /\bwades?\b|\bsits?\b/i.test(c.text) ? 'sits' : '';
    for (const h of zs) { const fl = floats(c.fam, h);
      if (says === 'floats' && !fl[0]) p.push(`${c.where} ${c.col} ${c.fam}: "${c.text}" but it sits at R 0.40 in ${h} m`);
      if (says === 'small' && !(fl[0] && !fl[2])) p.push(`${c.where} ${c.col} ${c.fam}: "floats if small" but the table says ${fl}`);
      if (says === 'sits' && fl.some(Boolean)) p.push(`${c.where} ${c.col} ${c.fam}: "${c.text}" but it floats in ${h} m`); } }
  for (const f of MATERIAL_FAMILY_IDS) { const line = FAMILY_LINES[f][0], fl = floats(f, 0.28); if (/^floats/.test(line) && !fl[0]) p.push(`FAMILY_LINES ${f} "${line}" but it sits`); if (/^wades/.test(line) && fl.some(Boolean)) p.push(`FAMILY_LINES ${f} "${line}" but it floats`); }
  const eye = 0.4 * (0.95 + Math.sin(3 * D2R)), top = Math.max(...DEFS.flatMap((P) => P.zones.map((z) => z.surfaceY ?? 0)));
  if (eye - top < 0.1 - 1e-9) p.push(`eye line ${f2(eye)} m is ${f2(eye - top)} m above the ${top} m surface`);
  row('DT-10', p.length === 0, `float table (share(h, R) x 12 families x R 0.40/0.50/0.625 x ${deep.length} deep water zones) agrees with every water cell and family line; eye line ${f2(eye)} m >= deepest surface ${top} + 0.10`,
    p.length ? p.slice(0, 4).join(' | ') : table.join(', '));
}

/* ═══════════════════════════════ DT-11: salts ═══════════════════════════════ */
{
  // (FIX5_DATA, round 5: + 0x2c1b3c6d, src/audio/music.ts's play-time thinning of a sparse style's mallet notes. A distinct stream on purpose: the
  // mallet draws its own timbre from mulberry32(note seed), so a thin decision taken from that same stream would keep only the notes whose first timbre
  // draw is high (a biased sound); hashing seed ^ this salt keeps the two independent, and it touches neither the composer's stream nor LIFE's SALTS.)
  const KNOWN = [0x9e3779b9, 0x51ed270b, 0x5bd1e995, 0x6c696e65, 0x6e616d65, 0xeee1e5, 0xf0f0f0, 0x6117e7, 0x5f3759df, 0xce2e, 0x57a45, 0x0c070c07, 0x2f6b3c1d, 0x6d757369, 0x5eed1e55, 0x57155, 0x2c1b3c6d];
  const BASE = [0x57a15b00, 0x0d011009], ours = Object.values(SALTS) as number[], p: string[] = [];
  if (new Set(ours).size !== ours.length) p.push('two salts are equal');
  for (const s of ours) if (KNOWN.includes(s) || BASE.includes(s)) p.push(`salt 0x${s.toString(16)} collides`);
  const found = new Set<number>(); const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { const f = resolve(d, e.name); if (e.isDirectory()) walk(f); else if (f.endsWith('.ts')) { const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/\^\s*(0x[0-9a-fA-F]+)/g)) found.add(Number(m[1])); for (const m of s.matchAll(/mulberry32\((0x[0-9a-fA-F]+)\)/g)) found.add(Number(m[1])); } } };
  walk(resolve(ROOT, 'src'));
  const unknown = [...found].filter((v) => !KNOWN.includes(v) && !ours.includes(v) && !BASE.includes(v));
  if (unknown.length) p.push(`new salt(s) in src: ${unknown.map((v) => '0x' + v.toString(16)).join(' ')} (add them to this row's list and re-check)`);
  const missing = KNOWN.filter((v) => !found.has(v)); if (missing.length) note('DT-11', `listed salts no longer in src: ${missing.map((v) => '0x' + v.toString(16)).join(' ')}`);
  row('DT-11', p.length === 0, `the ${ours.length} SALTS differ from each other, the ${KNOWN.length} in src and the 2 base seeds; src re-grepped (${found.size} XOR / mulberry32 constants)`, p.join(' | '));
}

/* ═══════════════════════════════ DT-12, DT-13 ═══════════════════════════════ */
{
  const p: string[] = [], RIDE: readonly number[] = [MECH.ramp, MECH.seesaw, MECH.swing, MECH.floater, MECH.mound];
  for (const P of DEFS) for (const t of P.things) { if (RIDE.includes(t.mech) && !t.ride) p.push(`${t.id} is a ride mechanism but not flagged`); if (t.ride && !RIDE.includes(t.mech)) p.push(`${t.id} flagged ride but ${t.mech}`);
    if ((t.mech === MECH.pad || t.mech === MECH.turntable) && (t.p.lip ?? 0) > 0) p.push(`${t.id} is not flush`); }
  if (!EMOTE.star || !STAR_MEANINGS.wish) p.push('no ride wish glyph');
  row('DT-12', p.length === 0, 'every ride mechanism (ramp, seesaw, swing, floater, mound top) is flagged a ride and has the star ride wish; every self use is at floor level (pads and turntables flush)', p.join(' | '));
  const HEAD: Record<number, string> = { [SIGNATURE.arrive]: 'arrive', [SIGNATURE.toast]: 'warm', [SIGNATURE.squirt]: 'pool', [SIGNATURE.glide]: 'ice', [SIGNATURE.splashjump]: 'pool', [SIGNATURE.floatsit]: 'pool',
    [SIGNATURE.cogride]: 'turntable', [SIGNATURE.moongaze]: 'sky', [SIGNATURE.echotalk]: 'echo', [SIGNATURE.updraft]: 'updraft' };
  const sig = DEFS.map((P) => P.signature), fin = DEFS.map((P) => P.finale), cnt = new Map<string, number>(); for (const s of sig) cnt.set(HEAD[s] ?? '?', (cnt.get(HEAD[s] ?? '?') ?? 0) + 1);
  const ok13 = new Set(sig).size === 10 && new Set(fin).size === 10 && fin.every((f) => Object.values(FINALE).includes(f as never)) && [...cnt.values()].every((n) => n <= 3) && !cnt.has('?');
  row('DT-13', ok13, `each place has its own signature verb and finale spectacle; no mechanism heads more than 3 places (${[...cnt].map(([k, n]) => `${k} ${n}`).join(', ')})`);
}

/* ═══════════════════════════════ DT-14: the frozen lock lists ═══════════════════════════════ */
{
  const LOCK = {
    places: 'home hearthlog ripple frostbell rainleaf fizzwell cogwhistle lanternroof echohollow cloudloft',
    things: 'feltball musicbox snoozerug warmlamp keepsakeshelf bouncepad hearth rockerboard yarnball pillowswing snugbasket kettle rockpool bobring driftlog shellchimes pebbleball sandmound icepond glideramp steampool iciclebells snowdriftnest snowball shakepine splashspots leafteeter mossbouncer dripleaf steppingstones seedpod bathwater tap swirlride soapslide spongeraft bubblepatch spinningcog windupkey springplate magnet steelmarble tickclock littlebell lanternline vanedisc hammock chimneycorner moondish starscope crystals glowpool stoneslide mossbed echostone humrock puffpads updraft kiteswing sunbowarch cloudnest cloudball',
    quests: 'H1 H2 H3 H4 H5 H6 H7 H8 H9 H10 C1 C2 C3 C4 C5 C6 C7 C8 C9 C10 R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 I1 I2 I3 I4 I5 I6 I7 I8 I9 I10 G1 G2 G3 G4 G5 G6 G7 G8 G9 G10 T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 W1 W2 W3 W4 W5 W6 W7 W8 W9 W10 L1 L2 L3 L4 L5 L6 L7 L8 L9 L10 E1 E2 E3 E4 E5 E6 E7 E8 E9 E10 U1 U2 U3 U4 U5 U6 U7 U8 U9 U10 X1 X2 X3 X4 X5 X6 X7 X8 X9 X10',
    keepsakes: 'feltstar emberpinecone seaglasspebble tinyfrostbell raindropbead bubblering littlebrasscog paperlantern glowcrystal cloudpuff friendshipframe paircharm friendshipribbon ribbongarland songbook wishjar littlebutton thimble pocketmap friendsquilt',
    emotes: 'snug:1 hello:2 giggle:3 sparkle:4 question:5 wow:6 zzz:7 note:8 star:9 swirl:10 puff:11 sun:12 flame:13 snowflake:14 droplet:15 bubbles:16 leaf:17 moon:18 ball:19 bell:20 shell:21 postcard:22 squeeze:23 stretch:24',
    facts: 'MET:0 PLACE:1 THING:2 FRIEND:3 WATER:4 WARM:5 COLD:6 GROUND:7 SONG:8 TOUCH:9 WISH:10 TWIN:11',
    react: 'FLOAT:1 WADE:2 SOAK:3 TOAST:4 RISE:5 OOZE:6 WARM:7 SHIVER:8 FROST:9 SNOWCAP:10 GLIDE:11 SPLASH:12 DRIFT:13 LIFT:14 RATTLE:15 GLOW:16 GAZE_SKY:17 PRINT:18 SHOWER:19 FIZZ:20 HOLD_ON:21 DRY:22 LOVE:23',
    use: 'ROLL:1 ROCK:2 SWING:3 SPIN:4 BOUNCE:5 RING:6 NAP:7 FLOAT_ON:8 SLIDE:9 SWITCH:10 LISTEN:11 LEAN:12 WADE:13 SHAKE:14 STEP:15',
  };
  const kv = (o: Readonly<Record<string, number>>): string => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(' ');
  const now = { places: PLACE_IDS.join(' '), things: THING_IDS.join(' '), quests: QUESTS.map((q, i) => (q.idx === i ? q.id : '?')).join(' '), keepsakes: KEEPSAKES.map((k, i) => (k.bit === i ? k.id : '?')).join(' '),
    emotes: kv(EMOTE), facts: kv(FACT), react: kv(REACT_KIND), use: kv(USE_VERB) };
  const diff = (Object.keys(LOCK) as (keyof typeof LOCK)[]).filter((k) => LOCK[k] !== now[k]);
  row('DT-14', diff.length === 0, 'the append-only id lists (places, things, quests, keepsakes, emotes, facts, REACT kinds, USE verbs) equal the frozen lock (append to both)', diff.join(' '));
}

/* ═══════════════════════════════ DT-15: every REACT a quest or fact uses has a trigger; a REACT by thing names an owner or a source ═══════════════════════════════ */
{
  const p: string[] = [], trig = new Set(REACT_TRIGGERS.map((r) => r.kind)), used = new Set<number>();
  for (const q of QUESTS) for (const c of q.clauses) if (c.ev === EV.REACT || c.ev === EV.PIECES) for (const s of c.sub ?? (c.ev === EV.REACT ? Object.values(REACT_KIND) : [])) if (s < PIECES_USE) used.add(s);
  for (const ks of Object.values(FACT_REACTS)) for (const k of ks) used.add(k);
  for (const k of used) if (!trig.has(k)) p.push(`REACT ${k} has no trigger`);
  if (trig.size !== Object.keys(REACT_KIND).length) p.push(`${trig.size} triggers for ${Object.keys(REACT_KIND).length} kinds`);
  const sources = new Set(Object.values(LOOK_ADD).map((a) => a.thing).filter(Boolean) as string[]);
  for (const q of QUESTS) for (const c of q.clauses) if (c.ev === EV.REACT && c.thing !== undefined) { const id = THING_IDS[c.thing], P = DEFS.find((d) => d.things.some((t) => t.id === id))!, t = P.things.find((x) => x.id === id)!;
    const owns = P.zones.some((z) => ownsArea(t.zone, z.id)) || P.patches.some((pa) => ownsArea(t.patch, pa.id)); if (!owns && !sources.has(id)) p.push(`${q.id}: ${id} owns no zone or patch and is no look source`); }
  row('DT-15', p.length === 0, `every REACT kind a quest or fact uses (${used.size}) has a REACT_TRIGGERS row; every REACT-by-thing rule names a zone or patch owner or a lifeAddLook source`, p.join(' | '));
}

/* ═══════════════════════════════ DT-16: THING_KINDS ═══════════════════════════════ */
{
  const KIND_OF: Record<number, number> = { [EMOTE.ball]: THING_KIND.ball, [EMOTE.bell]: THING_KIND.bell, [EMOTE.droplet]: THING_KIND.droplet, [EMOTE.note]: THING_KIND.note, [EMOTE.flame]: THING_KIND.flame, [EMOTE.sun]: THING_KIND.sun };
  const p: string[] = []; for (const P of DEFS) { const k = P.things.reduce((m, t) => m | (KIND_OF[t.icon] ?? 0), 0); if (k !== THING_KINDS[P.id]) p.push(`${P.id}: data ${THING_KINDS[P.id]}, things ${k}`); }
  row('DT-16', p.length === 0, 'THING_KINDS equals the wish glyph kinds of each place\'s things (ball, bell, droplet, note, flame, sun)', p.join(' | '));
}
void MATERIAL_FAMILIES;
process.exit(bad ? 1 : 0);
