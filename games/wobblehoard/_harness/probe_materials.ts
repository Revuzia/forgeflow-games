// Material families probe (plain node, exit 1 on failure): table completeness and ranges, distinctness, bounded + monotone
// per-instance modulation, determinism and totality, the research extremes, and 1-D reductions of the solver formulas from
// _spec/SQUISHY_SCIENCE.md section 3 evaluated with every family's numbers.
//   node _harness/probe_materials.ts
import {
  DEFAULT_FAMILY_ID, LOOK_FIELDS, MATERIAL_FAMILIES, MATERIAL_FAMILY_IDS, MATERIAL_LIST, NOMINAL_SUBSTEP_S, PHYSICS_AXES, SOUND_FIELDS,
  applyMaterial, dentHoldDepth, effectivePoisson, feelOf, isMaterialFamilyId, materialDistance, materialVector, normalizeAxis, recoverySeconds95, resolveMaterial,
  translucencyMaxOf,
} from '../src/data/materials.ts';
import type { MaterialFamily, MaterialFamilyId, MaterialParams, PhysicsKey, ResolvedMaterial, ScaleKey } from '../src/data/materials.ts';
import { makeStarterGenome, randomGenome } from '../src/core/genome.ts';
import { CATALOG, speciesTemplateGenome, speciesBaseGenome } from '../src/data/catalog.ts';
import type { Genome } from '../src/core/genome.ts';
import { mulberry32 } from '../src/core/rng.ts';

let bad = 0;
const check = (name: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const warn = (name: string, ok: boolean, extra = ''): void => { console.log(`${ok ? 'ok  ' : 'WARN'} ${name}${extra ? '  ' + extra : ''}`); };
const f3 = (x: number): string => x.toFixed(3);
const P = (f: MaterialFamily): MaterialParams => f.physics;
const neutral = (): Genome => ({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5, translucency: 0.5, gloss: 0.5 });
const withG = (over: Partial<Genome>): Genome => ({ ...neutral(), ...over });

/* ───────────────────────── 1. the table: ids, fields, ranges ───────────────────────── */
console.log('== table');
check('roster has 10..12 families', MATERIAL_LIST.length >= 10 && MATERIAL_LIST.length <= 12, String(MATERIAL_LIST.length));
check('ids are unique, match their key, and are all recognised',
  new Set(MATERIAL_FAMILY_IDS).size === MATERIAL_FAMILY_IDS.length && MATERIAL_FAMILY_IDS.every((id) => MATERIAL_FAMILIES[id].id === id && isMaterialFamilyId(id)));
check('names are unique, blurbs are one non-empty line',
  new Set(MATERIAL_LIST.map((f) => f.name)).size === MATERIAL_LIST.length && MATERIAL_LIST.every((f) => f.blurb.length > 20 && !f.blurb.includes('\n')));
const axisKeys = PHYSICS_AXES.map((a) => a.key).sort();
let fieldsOk = true;
for (const f of MATERIAL_LIST) {
  const pk = Object.keys(f.physics).sort(), lk = Object.keys(f.look).sort(), sk = Object.keys(f.sound).sort();
  if (JSON.stringify(pk) !== JSON.stringify(axisKeys)) { fieldsOk = false; console.log('  physics keys differ for', f.id); }
  if (JSON.stringify(lk) !== JSON.stringify(LOOK_FIELDS.map((x) => x.key).sort())) { fieldsOk = false; console.log('  look keys differ for', f.id); }
  if (JSON.stringify(sk) !== JSON.stringify(SOUND_FIELDS.map((x) => x.key).sort())) { fieldsOk = false; console.log('  sound keys differ for', f.id); }
  for (const a of PHYSICS_AXES) { const v = f.physics[a.key]; if (!Number.isFinite(v) || v < a.min - 1e-12 || v > a.max + 1e-12) { fieldsOk = false; console.log(`  ${f.id}.physics.${a.key}=${v} outside ${a.min}..${a.max}`); } }
  for (const a of LOOK_FIELDS) { const v = (f.look as unknown as Record<string, number>)[a.key]; if (!Number.isFinite(v) || v < a.min || v > a.max) { fieldsOk = false; console.log(`  ${f.id}.look.${a.key}=${v} outside ${a.min}..${a.max}`); } }
  for (const a of SOUND_FIELDS) { const v = (f.sound as unknown as Record<string, number>)[a.key]; if (!Number.isFinite(v) || v < a.min || v > a.max) { fieldsOk = false; console.log(`  ${f.id}.sound.${a.key}=${v} outside ${a.min}..${a.max}`); } }
  if (f.sound.bubbleRadiusMinMm > f.sound.bubbleRadiusMaxMm) { fieldsOk = false; console.log('  bubble radius min > max for', f.id); }
}
check(`every family has every field (${PHYSICS_AXES.length} physics, ${LOOK_FIELDS.length} look, ${SOUND_FIELDS.length} sound) in its documented range`, fieldsOk);
check('the default (fallback) family is the gel family', DEFAULT_FAMILY_ID === 'jellygel');

/* ───────────────────────── 2. distinctness ───────────────────────── */
console.log('== distinctness');
// Threshold: RMS distance over the activation-gated, range-normalised axes. 0.10 means "about half a range on one axis, or a third of a
// range on each of two axes" (0.5/sqrt(23) = 0.104, sqrt(2*(1/3)^2/23) = 0.098): the smallest gap a designer would call a different material.
const MIN_DISTANCE = 0.10;
const pairs: [number, string, string][] = [];
for (let i = 0; i < MATERIAL_LIST.length; i++) for (let j = i + 1; j < MATERIAL_LIST.length; j++) pairs.push([materialDistance(P(MATERIAL_LIST[i]), P(MATERIAL_LIST[j])), MATERIAL_LIST[i].id, MATERIAL_LIST[j].id]);
pairs.sort((a, b) => a[0] - b[0]);
check(`all ${pairs.length} family pairs are at least ${MIN_DISTANCE} apart (RMS, normalised)`, pairs[0][0] >= MIN_DISTANCE, `closest ${f3(pairs[0][0])} ${pairs[0][1]}/${pairs[0][2]}; next ${pairs.slice(1, 4).map((p) => `${f3(p[0])} ${p[1]}/${p[2]}`).join(', ')}`);
// every family owns a trait: some axis >= 0.25 of its range away from the roster median (the gel is the reference, so it only needs one)
const vecs = new Map<string, number[]>(MATERIAL_LIST.map((f) => [f.id, materialVector(P(f))]));
const median = PHYSICS_AXES.map((_, k) => { const a = MATERIAL_LIST.map((f) => (vecs.get(f.id) as number[])[k]).sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; });
let traitOk = true; const traitNotes: string[] = [];
for (const f of MATERIAL_LIST) {
  const mine = vecs.get(f.id) as number[];
  const traits = PHYSICS_AXES.filter((_, k) => Math.abs(mine[k] - median[k]) >= 0.25).map((a) => a.key);
  if (traits.length < 1) { traitOk = false; console.log('  no distinctive trait:', f.id); }
  traitNotes.push(`${f.id}:${traits.length}`);
}
check('every family has at least one distinctive trait (an axis >= 0.25 of its range from the roster median)', traitOk, traitNotes.join(' '));

/* ───────────────────────── 3. modulation: bounded, character-preserving ───────────────────────── */
console.log('== modulation');
const baseOf = (id: MaterialFamilyId): MaterialParams => MATERIAL_FAMILIES[id].physics;
let neutralOk = true;
for (const id of MATERIAL_FAMILY_IDS) { const r = resolveMaterial(id, neutral()); for (const a of PHYSICS_AXES) if (Math.abs(r.physics[a.key] - baseOf(id)[a.key]) > 1e-9) { neutralOk = false; console.log('  neutral genome moved', id, a.key); } }
check('a neutral genome (all 0.5) returns the family base unchanged', neutralOk);
const corners: Genome[] = [];
for (let m = 0; m < 16; m++) corners.push(withG({ firmness: m & 1 ? 1 : 0, bounce: m & 2 ? 1 : 0, stretch: m & 4 ? 1 : 0, size: m & 8 ? 1 : 0 }));
let worstRatio = 1, boundOk = true, maxDisp = 0;
for (const id of MATERIAL_FAMILY_IDS) for (const g of corners) {
  const r = resolveMaterial(id, g);
  maxDisp = Math.max(maxDisp, materialDistance(r.physics, baseOf(id)));
  for (const a of PHYSICS_AXES) {
    const b = baseOf(id)[a.key], v = r.physics[a.key];
    if (b > 0) { const q = v / b; worstRatio = Math.max(worstRatio, q, 1 / q); const clampedAtEdge = v <= a.min + 1e-9 || v >= a.max - 1e-9; if ((q > 1.61 || q < 1 / 1.61) && !clampedAtEdge) boundOk = false; }
    else if (v !== 0 && a.key !== 'airReturnTau') boundOk = false; // zero bases stay zero
  }
}
check('every physics axis stays within x1.6 of the family base at the 16 genome corners (or at its range edge)', boundOk, `worst ratio ${worstRatio.toFixed(2)}`);
const rnd = mulberry32(12345);
let charOk = true, charWorst = 0;
for (let n = 0; n < 1000; n++) {
  const g = randomGenome((rnd() * 4294967296) >>> 0);
  for (const id of MATERIAL_FAMILY_IDS) {
    const rp = resolveMaterial(id, g).physics;
    let best = '', bd = 9;
    for (const o of MATERIAL_LIST) { const d = materialDistance(rp, o.physics); if (d < bd) { bd = d; best = o.id; } }
    if (best !== id) { charOk = false; if (charWorst < 99) { console.log(`  genome ${n}: ${id} resolved nearer to ${best}`); charWorst = 99; } }
  }
}
check('1000 random genomes x 12 families: the resolved numbers stay nearest to their own family (character preserved)', charOk);
{
  let cornerOk = true;
  for (const id of MATERIAL_FAMILY_IDS) for (const g of corners) {
    const rp = resolveMaterial(id, g).physics; let best = '', bd = 9;
    for (const o of MATERIAL_LIST) { const d = materialDistance(rp, o.physics); if (d < bd) { bd = d; best = o.id; } }
    if (best !== id) { cornerOk = false; console.log(`  corner genome moved ${id} nearer to ${best}`); }
  }
  check('all 16 extreme genome corners x 12 families stay nearest to their own family', cornerOk, `largest displacement from base ${f3(maxDisp)} (RMS, normalised) vs closest family gap ${f3(pairs[0][0])}`);
}

// monotone sweeps (non-strict) for each family over three backgrounds
type Sweep = { field: keyof Genome; up: (r: ResolvedMaterial) => number[]; dir: number[]; label: string };
const sweeps: Sweep[] = [
  { field: 'firmness', up: (r) => [r.physics.smOmega, r.physics.volOmega, r.physics.volBleedMax, r.physics.edgeAlphaT], dir: [1, 1, -1, -1], label: 'firmness: smOmega+ volOmega+ volBleedMax- edgeAlphaT-' },
  { field: 'bounce', up: (r) => [r.physics.intDamp, r.physics.affDamp, r.physics.speedDamp, r.sound.ring], dir: [-1, -1, -1, 1], label: 'bounce: intDamp- affDamp- speedDamp- ring+' },
  { field: 'stretch', up: (r) => [r.physics.maxPull, r.physics.edgeAlphaT, r.physics.edgeSoftStrain], dir: [1, 1, 1], label: 'stretch: maxPull+ edgeAlphaT+ edgeSoftStrain+' },
  { field: 'size', up: (r) => [r.physics.airReturnTau, r.physics.sloshHz], dir: [1, -1], label: 'size: airReturnTau+ sloshHz-' },
  { field: 'translucency', up: (r) => [r.look.translucency], dir: [1], label: 'translucency: look.translucency+' },
  { field: 'gloss', up: (r) => [r.look.gloss], dir: [1], label: 'gloss: look.gloss+' },
];
for (const sw of sweeps) {
  let ok = true;
  for (const id of MATERIAL_FAMILY_IDS) for (const bg of [0, 0.5, 1]) {
    let prev: number[] | null = null;
    for (let k = 0; k <= 20; k++) {
      const g = withG({ firmness: bg, bounce: bg, stretch: 1 - bg, size: bg, translucency: bg, gloss: bg, [sw.field]: k / 20 } as Partial<Genome>);
      const cur = sw.up(resolveMaterial(id, g));
      if (prev) cur.forEach((v, i) => { if ((v - (prev as number[])[i]) * sw.dir[i] < -1e-12) { ok = false; console.log(`  non-monotone ${id} ${sw.field}=${k / 20} component ${i}`); } });
      prev = cur;
    }
  }
  check(`monotone: ${sw.label}`, ok);
}
// isolation: cosmetic genome fields never move the physics
let isoOk = true;
for (const id of MATERIAL_FAMILY_IDS) {
  const a = resolveMaterial(id, withG({ hue: 10, seed: 1, pattern: 'plain', eyeSize: 0.1, glitter: 0.2 })), b = resolveMaterial(id, withG({ hue: 300, seed: 99999, pattern: 'swirl', eyeSize: 0.9, glitter: 0.8 }));
  if (JSON.stringify(a.physics) !== JSON.stringify(b.physics) || JSON.stringify(a.solver) !== JSON.stringify(b.solver)) isoOk = false;
}
check('hue, seed, pattern, eyes and glitter do not change physics or solver numbers', isoOk);
{
  const firm = resolveMaterial('slowrise', withG({ firmness: 1 })), soft = resolveMaterial('slowrise', withG({ firmness: 0 }));
  check('firmer genome => not softer result (slow-rise foam: smOmega, volOmega up; bleed, skin compliance down)',
    firm.physics.smOmega > soft.physics.smOmega && firm.physics.volOmega > soft.physics.volOmega && firm.physics.volBleedMax < soft.physics.volBleedMax && firm.physics.edgeAlphaT < soft.physics.edgeAlphaT,
    `smOmega ${soft.physics.smOmega.toFixed(1)} -> ${firm.physics.smOmega.toFixed(1)}`);
}

// look: ONE source of truth per field. The genome's translucency / gloss / coreGlow / glitter (the catalog's per-tier rarity layer) are what
// a consumer draws, except that a family that is opaque in the hand caps translucency AFTER the pass-through (LookBounds); the family supplies
// only the surface fields a genome lacks, and its four reference numbers are the fallback.
{
  // the caps: exactly the families that are opaque or frosted in the hand, each at or above the family's own natural band (a cap only removes
  // stylised excess), in 0..1, with a reason; the families that can be cast clear have none
  const OPAQUE: readonly MaterialFamilyId[] = ['slowrise', 'marshmallow', 'mochidough', 'putty', 'beadsqueeze'];
  const capOk = MATERIAL_FAMILY_IDS.every((id) => {
    const b = MATERIAL_FAMILIES[id].lookBounds, l = MATERIAL_FAMILIES[id].look;
    if (!OPAQUE.includes(id)) return b === undefined && translucencyMaxOf(id) === 1;
    return !!b && b.translucencyMax > 0 && b.translucencyMax < 1 && l.translucency + l.translucencySpan <= b.translucencyMax + 1e-9 && b.why.length > 20 && translucencyMaxOf(id) === b.translucencyMax;
  });
  check(`look caps: exactly the opaque families are capped (${OPAQUE.map((id) => `${id} ${translucencyMaxOf(id).toFixed(2)}`).join(', ')}), each cap in 0..1, at or above the family's own natural band (reference + span), with a reason; clear families uncapped; unknown ids answer 1`,
    capOk && translucencyMaxOf('nope') === 1 && translucencyMaxOf('__proto__') === 1,
    OPAQUE.map((id) => `${id} natural top ${(MATERIAL_FAMILIES[id].look.translucency + MATERIAL_FAMILIES[id].look.translucencySpan).toFixed(2)}`).join(', '));
  const PASS = ['gloss', 'coreGlow', 'glitter'] as const;
  const SURFACE = ['roughness', 'subsurface', 'fuzz', 'grain', 'thickness', 'blush', 'stretchPale'] as const;
  let passOk = true, capApplied = true, surfOk = true, n = 0, firstBad = '', clipped = 0;
  const gs: Genome[] = [...CATALOG.map((d) => speciesTemplateGenome(d.id)), ...CATALOG.map((d) => speciesBaseGenome(d.id, 99)), ...Array.from({ length: 300 }, (_, i) => randomGenome(i + 1))];
  for (const g of gs) for (const id of MATERIAL_FAMILY_IDS) {
    const r = resolveMaterial(id, g); n++;
    for (const k of PASS) if (r.look[k] !== Math.min(1, Math.max(0, g[k]))) { passOk = false; firstBad ||= `${id}/${g.species}.${k}: ${r.look[k]} vs genome ${g[k]}`; }
    const t = Math.min(1, Math.max(0, g.translucency)), cap = translucencyMaxOf(id);
    if (r.look.translucency !== Math.min(cap, t)) { capApplied = false; firstBad ||= `${id}/${g.species}.translucency: ${r.look.translucency} vs min(${cap}, ${t})`; }
    if (t > cap) clipped++;
    for (const k of SURFACE) if (r.look[k] !== MATERIAL_FAMILIES[id].look[k]) surfOk = false;
  }
  check(`look pass-through: resolved gloss / coreGlow / glitter equal the genome's own values for ${n} (genome, family) pairs (no family override of the rarity layer)`, passOk, firstBad);
  check(`look cap: resolved translucency = min(family cap, genome translucency) for the same ${n} pairs (the genome's value whenever it is under the cap; ${clipped} pairs clipped, all of them a genome resolved under a family it does not belong to or a random genome)`, capApplied, firstBad);
  {
    // the cap never bites on the catalog's own species (their bases sit under it with the whole band; probe_catalog checks every instance)
    const bit = CATALOG.filter((d) => speciesTemplateGenome(d.id).translucency > translucencyMaxOf(d.family) || speciesBaseGenome(d.id, 99).translucency > translucencyMaxOf(d.family)).map((d) => d.id);
    check('the cap never bites on a catalog species in its own family (template and an instance)', bit.length === 0, bit.join(' '));
    const ask = withG({ translucency: 1 });
    check('an opaque material stays opaque: a genome asking for translucency 1 resolves to the cap (slow-rise foam 0.30, marshmallow 0.40, putty 0.30) and to 1 in the clear gel',
      resolveMaterial('slowrise', ask).look.translucency === 0.3 && resolveMaterial('marshmallow', ask).look.translucency === 0.4 && resolveMaterial('putty', ask).look.translucency === 0.3 && resolveMaterial('jellygel', ask).look.translucency === 1);
  }
  check('look: the family supplies roughness, subsurface, fuzz, grain, thickness, blush and stretch-pale unchanged', surfOk);
  const half = { species: 'dollop', firmness: 0.5 } as unknown as Genome;
  const fb = MATERIAL_FAMILY_IDS.every((id) => { const r = resolveMaterial(id, half).look, f = MATERIAL_FAMILIES[id].look; return r.translucency === f.translucency && r.gloss === f.gloss && r.coreGlow === Math.min(1, 0.5 * f.coreGlow) && r.glitter === Math.min(1, 0.5 * f.glitter); });
  check('look fallback: a genome that lacks the field gets the family reference value (translucency, gloss) or half the family multiplier (coreGlow, glitter)', fb);
  // the bug this fixes: under the old family-band mapping an Epic marshmallow (genome translucency 0.75) resolved to ~0.075, below a Common gel
  const sel = speciesTemplateGenome('selenuff'), wis = speciesTemplateGenome('wisplet');
  check('a high-tier species keeps its tier look through resolution (Selenuff, Epic marshmallow, stays more translucent and brighter-cored than Wisplet, Common marshmallow)',
    resolveMaterial('marshmallow', sel).look.translucency > resolveMaterial('marshmallow', wis).look.translucency && resolveMaterial('marshmallow', sel).look.coreGlow > resolveMaterial('marshmallow', wis).look.coreGlow,
    `translucency ${resolveMaterial('marshmallow', sel).look.translucency.toFixed(2)} vs ${resolveMaterial('marshmallow', wis).look.translucency.toFixed(2)}`);
}

/* ───────────────────────── 4. determinism and totality ───────────────────────── */
console.log('== determinism and totality');
let totalOk = true, detOk = true, runs = 0;
const rnd2 = mulberry32(777);
const inRange = (r: ResolvedMaterial): boolean => {
  for (const a of PHYSICS_AXES) { const v = r.physics[a.key]; if (!Number.isFinite(v) || v < a.min - 1e-12 || v > a.max + 1e-12) return false; }
  for (const a of LOOK_FIELDS) { const v = (r.look as unknown as Record<string, number>)[a.key]; if (v === undefined) continue; if (!Number.isFinite(v) || v < a.min || v > a.max) return false; }
  for (const a of SOUND_FIELDS) { const v = (r.sound as unknown as Record<string, number>)[a.key]; if (!Number.isFinite(v) || v < a.min || v > a.max) return false; }
  const s = r.solver as unknown as Record<string, number | Record<string, number>>;
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (typeof v === 'number') { if (!Number.isFinite(v)) return false; } else for (const k2 of Object.keys(v)) if (!Number.isFinite(v[k2]) || v[k2] <= 0) return false;
  }
  const d = r.derived;
  return Number.isFinite(d.effectivePoisson) && d.effectivePoisson >= 0 && d.effectivePoisson < 0.5 && Number.isFinite(d.recoverySeconds95) && Object.values(d.feel).every((x) => Number.isFinite(x) && x >= 0 && x <= 1);
};
for (let n = 0; n < 1000; n++) {
  const g = randomGenome((rnd2() * 4294967296) >>> 0);
  for (const id of MATERIAL_FAMILY_IDS) {
    const a = resolveMaterial(id, g), b = resolveMaterial(id, g);
    runs++;
    if (JSON.stringify(a) !== JSON.stringify(b)) detOk = false;
    if (!inRange(a) || a.familyId !== id || a.fellBack) totalOk = false;
  }
}
check(`resolveMaterial is deterministic and total over ${runs} (genome, family) pairs: finite, in range, same twice`, detOk && totalOk);
const badIds: unknown[] = [undefined, null, '', 'nope', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ' jellygel', 'JELLYGEL', 123, {}, [], true];
let idOk = true;
for (const id of badIds) {
  try { const r = resolveMaterial(id as string, neutral()); if (r.familyId !== DEFAULT_FAMILY_ID || !r.fellBack || !inRange(r)) idOk = false; } catch { idOk = false; }
}
check('bad family ids never throw and fall back to the gel family', idOk);
const hostile: unknown[] = [undefined, null, {}, { firmness: NaN, bounce: Infinity, stretch: -Infinity, size: 'x', translucency: {}, gloss: -5, coreGlow: 9, glitter: NaN },
  { firmness: 1e308, bounce: -1e308, stretch: 7, size: -3 }];
let hostileOk = true;
for (const g of hostile) for (const id of MATERIAL_FAMILY_IDS) { try { const r = resolveMaterial(id, g as Genome); if (!inRange(r)) hostileOk = false; } catch { hostileOk = false; } }
check('half-built or hostile genomes (undefined, NaN, Infinity, strings, out of range) still resolve in range', hostileOk);
{
  const g = neutral(); const before = JSON.stringify(g); resolveMaterial('putty', g);
  check('resolveMaterial does not mutate the genome or the family table', JSON.stringify(g) === before && JSON.stringify(MATERIAL_FAMILIES.putty.physics) === JSON.stringify(resolveMaterial('putty', neutral()).physics));
}

/* ───────────────────────── 5. the extremes the research says exist ───────────────────────── */
console.log('== research extremes');
const F = MATERIAL_FAMILIES;
const argmax = (key: PhysicsKey, ids: readonly MaterialFamilyId[] = MATERIAL_FAMILY_IDS): MaterialFamilyId => ids.reduce((a, b) => (F[b].physics[key] > F[a].physics[key] ? b : a));
{
  const p = P(F.slowrise);
  check('compressible slow-recovery foam: loses >= 40% volume, Poisson ~0.3-0.4, recovery >= 3.5 s, slowest air return of any compressible family',
    p.volBleedMax >= 0.4 && effectivePoisson(p) <= 0.40 && effectivePoisson(p) >= 0.25 && recoverySeconds95(p) >= 3.5 && argmax('airReturnTau') === 'slowrise',
    `bleed ${p.volBleedMax}, nu_eff ${f3(effectivePoisson(p))}, recovery95 ${recoverySeconds95(p).toFixed(1)} s, airReturnTau ${p.airReturnTau}`);
}
{
  const p = P(F.putty);
  check('plastic putty: keeps a dent >= 0.25 R0 that heals in >= 20 s, strongest rate response, memory arm >= 4x the elastic arm',
    dentHoldDepth(p) >= 0.25 && p.healTau >= 20 && p.memStiff >= 4 && argmax('speedDamp') === 'putty' && argmax('yieldStrain') === 'putty',
    `hold ${dentHoldDepth(p).toFixed(2)} R0, heal ${p.healTau} s, memStiff ${p.memStiff}, speedDamp ${p.speedDamp}`);
}
{
  const p = P(F.jellygel);
  check('incompressible bouncy gel: nu_eff >= 0.495, no volume bleed, no held dent, low damping', effectivePoisson(p) >= 0.495 && p.volBleedMax === 0 && dentHoldDepth(p) === 0 && p.intDamp <= 6 && p.affDamp <= 30,
    `nu_eff ${effectivePoisson(p).toFixed(4)}, intDamp ${p.intDamp}, affDamp ${p.affDamp}`);
}
{
  const p = P(F.waterfill);
  check('sloshy liquid-filled: heaviest sloshing mass (>= 0.3), lightly damped (zeta <= 0.2), incompressible', p.sloshMass >= 0.3 && p.sloshZeta <= 0.2 && p.volOmega >= 500 && argmax('sloshMass') === 'waterfill',
    `mass ${p.sloshMass}, zeta ${p.sloshZeta}, f ${p.sloshHz} Hz, nu_eff ${effectivePoisson(p).toFixed(4)}`);
}
check('sticky stretchy family: the most tacky and stringy, longest pull', argmax('tack') === 'stickystretch' && P(F.stickystretch).stringiness >= 0.8 && argmax('maxPull') === 'stickystretch');
check('slime: most stringy-wet, softest shape stiffness of the table', P(F.slimegoo).stringiness >= 0.95 && MATERIAL_LIST.every((f) => f.physics.smOmega >= P(F.slimegoo).smOmega));
check('bistable pop dome is the only snap family; bead squeeze is the most jam-hardening', MATERIAL_LIST.filter((f) => f.physics.snap > 0).length === 1 && P(F.popdome).snap === 1 && argmax('jam') === 'beadsqueeze');
check('firm silicone: the stiffest incompressible family and among the most bouncy',
  argmax('smOmega', ['jellygel', 'waterfill', 'putty', 'stickystretch', 'slimegoo', 'firmsilicone', 'gummy', 'mochidough']) === 'firmsilicone' && P(F.firmsilicone).affDamp <= 10);
check('marshmallow is the fast-return compressible foam (air return < 0.5 s) and the foam is the slow one', P(F.marshmallow).airReturnTau < 0.5 && P(F.slowrise).airReturnTau > 3 * P(F.marshmallow).airReturnTau);
check('mochi dough holds a small dent (0.05-0.25 R0) that heals in 3-15 s', dentHoldDepth(P(F.mochidough)) >= 0.05 && dentHoldDepth(P(F.mochidough)) <= 0.25 && recoverySeconds95(P(F.mochidough)) >= 3 && recoverySeconds95(P(F.mochidough)) <= 15,
  `hold ${dentHoldDepth(P(F.mochidough)).toFixed(2)}, recovery95 ${recoverySeconds95(P(F.mochidough)).toFixed(1)} s`);
check('look: foam/marshmallow/putty are near opaque, gel/liquid/gummy are glassy',
  F.slowrise.look.translucency + F.slowrise.look.translucencySpan < 0.2 && F.marshmallow.look.translucency + F.marshmallow.look.translucencySpan < 0.2 && F.putty.look.translucency + F.putty.look.translucencySpan < 0.2
  && F.jellygel.look.translucency - F.jellygel.look.translucencySpan > 0.6 && F.waterfill.look.translucency - F.waterfill.look.translucencySpan > 0.85 && F.gummy.look.translucency - F.gummy.look.translucencySpan > 0.75);
check('sound: foam is the airiest, slime the wettest and lowest-pitched bubbles, beads the crackliest, sticky strings follow tack',
  argmaxSound('airPuff') === 'slowrise' && F.slimegoo.sound.wet === 1 && F.slimegoo.sound.bubbleRadiusMaxMm >= 5 && argmaxSound('bubbleRate') === 'beadsqueeze' && ['stickystretch', 'slimegoo'].includes(argmaxSound('stickyStrings')));
function argmaxSound(key: 'airPuff' | 'bubbleRate' | 'stickyStrings'): MaterialFamilyId { return MATERIAL_FAMILY_IDS.reduce((a, b) => (F[b].sound[key] > F[a].sound[key] ? b : a)); }
{
  const gelN = resolveMaterial('jellygel', neutral());
  const ident = Object.values(gelN.solver.scale).every((x) => Math.abs(x - 1) < 1e-12);
  const base = { smOmega: 44, bendK: 0.12, edgeAlphaT: 3, edgeSoftStrain: 1, volKappa: 0.5, intDamp: 6, affDamp: 21, intDamp2: 5.7, drag: 0.18, tableMu: 1.5, groundDamp: 0.03, maxPull: 1.7, extra: 7 };
  const same = JSON.stringify(applyMaterial(base, gelN)) === JSON.stringify(base);
  const foam = resolveMaterial('slowrise', neutral()), put = applyMaterial(base, foam);
  const kappaOk = Math.abs(foam.solver.scale.volKappa - (MATERIAL_FAMILIES.jellygel.physics.volOmega / foam.physics.volOmega) ** 2) < 1e-9 && put.volKappa > 50 * base.volKappa;
  check('solver mapping is relative: gel at a neutral genome is the identity, applyMaterial scales known keys and passes the rest, foam is ~160x more compressible',
    ident && same && put.extra === 7 && kappaOk && put.smOmega < base.smOmega, `foam volKappa ${base.volKappa} -> ${put.volKappa.toFixed(1)}, smOmega ${base.smOmega} -> ${put.smOmega.toFixed(1)}`);
  // soft compatibility with the PHYS defaults (another lane's file, loaded dynamically so a physics module mid-rewrite cannot crash this
  // probe: drift or a load failure is a WARN, not a failure)
  const g = makeStarterGenome(), r = resolveMaterial('jellygel', g);
  const neut = { ...g, firmness: 0.5, bounce: 0.5, stretch: 0.5 };
  let deriveParams: ((g: Genome) => unknown) | null = null, why = '';
  try { deriveParams = ((await import('../src/physics/params.ts')) as unknown as { deriveParams: (g: Genome) => unknown }).deriveParams; } catch (e) { why = String(e).slice(0, 100); }
  if (!deriveParams) warn('physics lane module src/physics/params.ts loads (deriveParams)', false, why);
  else {
    const got = applyMaterial(deriveParams(neut) as Record<ScaleKey, number>, r) as unknown as Record<string, number>, want = deriveParams(g) as Record<string, number>;
    const keys: string[] = ['smOmega', 'edgeAlphaT', 'edgeSoftStrain', 'intDamp', 'affDamp', 'intDamp2', 'maxPull'];
    warn('gel at the starter genome ~ the physics lane\'s own deriveParams(starter) (within 35%)', keys.every((k) => Math.abs(got[k] - want[k]) / want[k] < 0.35), keys.map((k) => `${k} ${got[k].toFixed(2)}/${want[k].toFixed(2)}`).join(' '));
  }
}

/* ───────────────────────── 6. 1-D reductions of the solver formulas, with the families' numbers ───────────────────────── */
console.log('== 1-D reductions (formulas of SQUISHY_SCIENCE.md section 3)');
// 6a. air-return volume target: V* falls toward the current volume with tauOut, returns with tauIn; 95% of the lost volume back in ln(20) tauIn, whatever the step
function airT95(tauIn: number, tauOut: number, bleed: number, h: number): number {
  let vs = 1; const floor = 1 - bleed;
  for (let t = 0; t < 1; t += h) { const cmd = Math.max(floor, 1 - (1 - floor) * Math.min(1, t / 0.4)); if (cmd < vs) vs += (cmd - vs) * (1 - Math.exp(-h / tauOut)); }
  const lost = 1 - vs; for (let t = 0; t < 30; t += h) { vs += (1 - vs) * (1 - Math.exp(-h / tauIn)); if (1 - vs < 0.05 * lost) return t; }
  return Infinity;
}
{
  let ok = true; const notes: string[] = [];
  for (const f of MATERIAL_LIST.filter((x) => x.physics.volBleedMax >= 0.1 && x.physics.airReturnTau >= 0.25)) {
    const r = resolveMaterial(f.id, neutral()).solver;
    for (const h of [NOMINAL_SUBSTEP_S, 1 / 60]) { const t = airT95(r.volInTau, r.volOutTau, 1 - r.volFloor, h), want = Math.log(20) * r.volInTau; if (Math.abs(t - want) > 0.04 * want + h) ok = false; notes.push(`${f.id}@${h < 0.01 ? '1/360' : '1/60'}=${t.toFixed(2)}s(want ${want.toFixed(2)})`); }
  }
  check('air-return volume target recovers 95% in ln(20) tau, independent of the step (1/360 vs 1/60)', ok, notes.join(' '));
}
// 6b. Zener memory arm in the massless reduction: finger holds dent D, then releases; k1 = 1, k2 = memStiff
function memory(ms: number, tau: number, y: number, heal: number, D: number, hold: number, T: number, h = NOMINAL_SUBSTEP_S): (t: number) => number {
  let d = 0; const kF = 1 - Math.exp(-h / tau), kH = heal < 59 ? 1 - Math.exp(-h / heal) : 0; const n = Math.round(T / h); const u: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const held = i * h < hold; const uu = held ? D : (ms * d) / (1 + ms); u[i] = uu;
    const e = uu - d, ex = Math.max(0, Math.abs(e) - y); if (ex > 0) d += Math.sign(e) * ex * kF; d += -d * kH;
  }
  return (t: number): number => u[Math.min(n - 1, Math.round(t / h))];
}
{
  let ok = true; const notes: string[] = [];
  for (const f of MATERIAL_LIST.filter((x) => x.physics.memStiff >= 0.3 && x.physics.yieldStrain === 0)) {
    const s = resolveMaterial(f.id, neutral()).solver; const hold = Math.max(6 * s.memTau, 2); const u = memory(s.memStiff, s.memTau, 0, 60, 0.3, hold, hold + 12);
    const teps = s.memTau * (1 + s.memStiff), t0 = hold + 0.3; const ratio = u(t0 + teps) / u(t0), want = Math.exp(-1);
    if (Math.abs(ratio - want) > 0.05) ok = false; notes.push(`${f.id} tail ratio ${ratio.toFixed(2)}(e^-1=${want.toFixed(2)})`);
  }
  check('Zener memory arm: after release the dent decays with the retardation time tau(1+memStiff)', ok, notes.join(' '));
}
{
  const dent = (id: MaterialFamilyId, at: number): number => { const s = resolveMaterial(id, neutral()).solver; return memory(s.memStiff, s.memTau, s.memYield, s.memHealTau, 0.5, 1.5, 1.5 + at + 1)(1.5 + at); };
  const putty6 = dent('putty', 6), gel6 = dent('jellygel', 6), foam6 = dent('slowrise', 6);
  check('plastic hold: putty still holds >= 0.15 R0 of a 0.5 R0 dent 6 s after release; gel and foam hold < 0.02', putty6 >= 0.15 && gel6 < 0.02 && foam6 < 0.02, `putty ${putty6.toFixed(3)}, gel ${gel6.toFixed(3)}, foam ${foam6.toFixed(3)}`);
  const m0 = dent('mochidough', 0.3), m10 = dent('mochidough', 10);
  check('mochi dough keeps its thumb-print then heals: dent at +10 s < 35% of the dent at +0.3 s', m10 < 0.35 * m0 && m0 > 0.05, `+0.3 s ${m0.toFixed(3)}, +10 s ${m10.toFixed(3)}`);
}
// 6c. slosh oscillator, semi-implicit Euler: stable at every step used, damping matches zeta
function sloshDecay(hz: number, zeta: number, h: number): { growth: number; zetaEst: number } {
  const w = 2 * Math.PI * hz; let s = 0.1, v = 0; const peaks: number[] = []; let prev = s, prevPrev = s; const n = Math.round(4 / h);
  for (let i = 0; i < n; i++) { v += (-w * w * s - 2 * zeta * w * v) * h; s += v * h; if (prev > prevPrev && prev > s && prev > 0) peaks.push(prev); prevPrev = prev; prev = s; }
  const growth = Math.max(...peaks) / 0.1; const zetaEst = peaks.length >= 3 ? Math.log(peaks[0] / peaks[2]) / (2 * 2 * Math.PI) : NaN;
  return { growth, zetaEst: zetaEst / Math.sqrt(1 + (zetaEst / 1) ** 2) };
}
{
  let ok = true; const notes: string[] = [];
  for (const f of MATERIAL_LIST.filter((x) => x.physics.sloshMass > 0)) for (const h of [NOMINAL_SUBSTEP_S, 1 / 60]) {
    const hzMax = Math.max(...corners.map((g) => resolveMaterial(f.id, g).physics.sloshHz)); const r = sloshDecay(hzMax, f.physics.sloshZeta, h);
    if (!(r.growth <= 1.001) || Math.abs(r.zetaEst - f.physics.sloshZeta) > 0.25 * f.physics.sloshZeta + 0.01 || 2 * Math.PI * hzMax * NOMINAL_SUBSTEP_S > 0.5) ok = false;
    notes.push(`${f.id}@${h < 0.01 ? '1/360' : '1/60'} zeta est ${r.zetaEst.toFixed(3)} (want ${f.physics.sloshZeta}) at ${hzMax.toFixed(1)} Hz`);
  }
  check('slosh oscillator is stable (never grows) at the substep and the frame step, and rings with the specified damping ratio', ok, notes.join(' '));
}

/* ───────────────────────── report ───────────────────────── */
console.log('\nfamily            nu_eff  rec95  hold  smOm volOm bleed airTau  ms   mTau  y     speed tack slosh jam snap');
for (const f of MATERIAL_LIST) {
  const p = f.physics, ff = feelOf(p);
  console.log(`${f.id.padEnd(16)}  ${effectivePoisson(p).toFixed(3)}  ${recoverySeconds95(p).toFixed(1).padStart(5)}  ${dentHoldDepth(p).toFixed(2)}  ${String(p.smOmega).padStart(4)} ${String(p.volOmega).padStart(5)} ${p.volBleedMax.toFixed(2)}  ${String(p.airReturnTau).padStart(5)}  ${p.memStiff.toFixed(1)}  ${p.memTau.toFixed(2)}  ${p.yieldStrain.toFixed(3)} ${String(p.speedDamp).padStart(5)} ${p.tack.toFixed(2)} ${p.sloshMass.toFixed(2)}  ${p.jam.toFixed(2)} ${p.snap}   feel firm ${ff.firm.toFixed(2)} squash ${ff.squashy.toFixed(2)} rise ${ff.slowRise.toFixed(2)}`);
}
void normalizeAxis;
console.log(bad ? `\n${bad} check(s) FAILED` : '\nall material checks passed');
process.exit(bad ? 1 : 0);
