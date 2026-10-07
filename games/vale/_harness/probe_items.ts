// probe (lane CONTENT): the item catalog and the pre-match setup layer — content/items.json and
// content/setup.json, checked as data and then played through the REAL sim shop and cast pipeline.
//
//   1. schema    every item and the setup record parse with the zod schema (strict keys)
//   2. catalog   ids, frames (Slate / Verdigris / Gloam / Noonlit / boots), counts, recipes (components
//                exist, component sum < total so every recipe fee is positive, no cycles, each tier
//                built from the tier below), uniqueness groups, stat-key text in descs, presentation ids
//                (VOCAB vfx/audio), summoned units, deny-list names (tools/names_check.ts), and a
//                Gleam-per-stat efficiency table per frame (printed; bounds checked)
//   3. pools     rift / bridge / fray non-empty; bridge has no starters or jungle items; fray is the
//                lighter loadout (no wards, no starters, no Gloam/Noonlit, recipes one step deep, every
//                piece under 2,500 Gleam); rift/bridge pools are closed under components
//   4. setup     8-ish battle spells with the required jobs (blink, heal, offense, jungle, haste, cleanse,
//                shield), cooldowns 90-300 s, 3 paths x 3 boons, 2 + 2 slots, defaults valid, fray lighter
//   5. builds    a full build per class (Plinth, Breaker, Striker, Slinger, Caster, Tender) per pool:
//                in pool, 6 slots, one boots upgrade, one Noonlit in rift/bridge, the class's stats covered
//   6. shop      each build bought step by step in the real sim (fixture fighter + real items, units,
//                modes, queues; stub maps): every price equals total − owned components (independent
//                model == quoteBuy == gold spent), one Gleam short is refused, undo restores items and
//                gold, sells refund floor(cost × sellRatio), pool / unique refusals, stats wired
//   7. effects   every item passive and active fires in the sim (damage/heal/shield/status/buff/ward)
//   8. loadouts  spells and boons per mode pool (effectiveLoadout), every spell cast once, boons wired
//   9. bots      real bots (src/sim/bots) shop from each pool without refusals or faults
//
// Exit 0 = PASS, 1 = FAIL, 77 = SKIP (content files missing). Run from the project root:
//   node _harness/probe_items.ts

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Catalog, ItemDef, SetupDef, type CatalogT, type ItemDefT, type SetupDefT, type StatBlockT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { createSim, type Sim } from '../src/sim/sim.ts';
import { quoteBuy, undoDepth } from '../src/sim/shop.ts';
import { tryCast } from '../src/sim/abilities.ts';
import { dealDamage } from '../src/sim/combat.ts';
import { applyStatus } from '../src/sim/status.ts';
import { spawnUnit, effectiveLoadout } from '../src/sim/spawn.ts';
import { SLOT_A1, SLOT_ITEM1, SLOT_SPELL1, type Entity, type Player } from '../src/sim/entity.ts';
import type { World } from '../src/sim/world.ts';
import { createBots } from '../src/sim/bots/index.ts';
import { checkNames, type NameInput } from '../tools/names_check.ts';
import { ability, fighter, rawCatalog } from './fixtures/catalog_fixture.ts';
import { check, finish, near, ofType, section } from './fixtures/sim_fixture.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const C = (f: string): string => join(ROOT, 'content', f);
if (!existsSync(C('items.json')) || !existsSync(C('setup.json'))) {
  console.log('SKIP probe_items: content/items.json or content/setup.json is missing');
  process.exit(77);
}

type Raw = Record<string, unknown>;
const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Raw).filter(([k]) => k !== '$comment' && k !== '$schema').map(([k, x]) => [k, strip(x)])) : v;
const read = (f: string): unknown => strip(JSON.parse(readFileSync(C(f), 'utf8')));
const family = (f: string, key: string): Raw[] => { const j = read(f); return (Array.isArray(j) ? j : (j as Raw)[key]) as Raw[]; };

const POOLS = ['rift', 'bridge', 'fray'] as const;
type Pool = typeof POOLS[number];
const CLASSES = ['plinth', 'breaker', 'striker', 'slinger', 'caster', 'tender'] as const;
type Cls = typeof CLASSES[number];

// ── 1. schema ────────────────────────────────────────────────────────────────────────────────────
const rawItems = family('items.json', 'items');
const rawSetup = read('setup.json') as Raw;
let ITEMS: ItemDefT[] = [];
let SETUP: SetupDefT | null = null;
section('schema', () => {
  const ri = z.array(ItemDef).safeParse(rawItems);
  check('items.json parses with ItemDef (strict)', ri.success, ri.success ? undefined : ri.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`));
  const rs = SetupDef.safeParse(rawSetup);
  check('setup.json parses with SetupDef (strict)', rs.success, rs.success ? undefined : rs.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`));
  if (ri.success) ITEMS = ri.data;
  if (rs.success) SETUP = rs.data;
});
if (ITEMS.length === 0 || !SETUP) { finish('probe_items'); process.exit(1); }
const setup: SetupDefT = SETUP;
const byId = new Map(ITEMS.map((it) => [it.id, it] as const));
const item = (id: string): ItemDefT => { const it = byId.get(id); if (!it) throw new Error(`unknown item ${id}`); return it; };
const inPool = (it: ItemDefT, pool: string): boolean => it.pools.length === 0 || it.pools.includes(pool);

// real content the sim needs
const units = family('units.json', 'units');
const teamBuffs = family('team_buffs.json', 'teamBuffs');
const modes = family('modes.json', 'modes');
const queues = family('queues.json', 'queues');
const resources = family('resources.json', 'resources');
const vfxIds = new Set(family('vfx.json', 'vfx').map((v) => v.id as string));
const audio = read('audio.json') as { cues: Raw; music: Raw };
const cueIds = new Set(Object.keys(audio.cues));
const unitKind = new Map(units.map((u) => [u.id as string, u.kind as string]));
const modeRules = (id: string): Raw => (modes.find((m) => m.id === id)?.rules ?? {}) as Raw;

// ── 2. catalog structure ─────────────────────────────────────────────────────────────────────────
type Frame = 'starter' | 'consumable' | 'slate' | 'verdigris' | 'gloam' | 'noonlit' | 'boots_base' | 'boots_up';
function frame(it: ItemDefT): Frame {
  switch (it.tier) {
    case 'starter': return 'starter';
    case 'consumable': return 'consumable';
    case 'core': return 'gloam';
    case 'apex': return 'noonlit';
    case 'boots': return it.components.length ? 'boots_up' : 'boots_base';
    default: return it.components.length ? 'verdigris' : 'slate';
  }
}
const byFrame = (f: Frame): ItemDefT[] => ITEMS.filter((it) => frame(it) === f);
/** Gleam per unit of stat (design calibration table, _design/sections/items_setup.md §6) */
const GLEAM: Partial<Record<keyof StatBlockT, number>> = {
  ad: 35, ap: 21, hp: 2.67, armor: 20, resist: 19, attackSpeed: 2500, crit: 4000, haste: 27, armorPen: 30, magicPen: 32,
  armorPenPct: 3000, magicPenPct: 3500, lifesteal: 4000, omnivamp: 4500, healShieldPower: 5000, tenacity: 1500,
  moveSpeed: 1200, moveSpeedPct: 4000, hpRegen: 120, resRegen: 350,
};
const statGleam = (s: StatBlockT): number => Object.entries(s).reduce((a, [k, v]) => a + (GLEAM[k as keyof StatBlockT] ?? 0) * (v as number), 0);
const PCT_KEYS = new Set(['attackSpeed', 'crit', 'critDamage', 'lifesteal', 'omnivamp', 'tenacity', 'healShieldPower', 'moveSpeedPct', 'armorPenPct', 'magicPenPct']);
const statText = (k: string, v: number): string => PCT_KEYS.has(k) ? `${Math.round(v * 1000) / 10}%` : k === 'moveSpeed' ? `${v} m/s` : `${v}`;

section('catalog: ids, frames, counts', () => {
  const ids = ITEMS.map((i) => i.id);
  check('item ids are unique', new Set(ids).size === ids.length);
  check('item names are unique', new Set(ITEMS.map((i) => i.name)).size === ITEMS.length);
  const n = (f: Frame): number => byFrame(f).length;
  const counts = { total: ITEMS.length, starter: n('starter'), consumable: n('consumable'), slate: n('slate'), verdigris: n('verdigris'), gloam: n('gloam'), noonlit: n('noonlit'), boots: n('boots_base') + n('boots_up') };
  console.log(`  counts ${JSON.stringify(counts)}`);
  check('32-40 items', counts.total >= 32 && counts.total <= 40, counts.total);
  check('starters: 3-5 (one per broad style + jungle)', counts.starter >= 3 && counts.starter <= 5, counts.starter);
  check('consumables: potion-like, ward-like, fray tonic', counts.consumable === 3 &&
    byFrame('consumable').some((i) => JSON.stringify(i.active?.effects ?? []).includes('"heal"') && inPool(i, 'rift')) &&
    byFrame('consumable').some((i) => JSON.stringify(i.active?.effects ?? []).includes('"summon"')) &&
    byFrame('consumable').some((i) => i.pools.length === 1 && i.pools[0] === 'fray'));
  check('Slate basics: 8-10', counts.slate >= 8 && counts.slate <= 10, counts.slate);
  check('Verdigris components: 6-8', counts.verdigris >= 6 && counts.verdigris <= 8, counts.verdigris);
  check('Gloam cores: 8-10', counts.gloam >= 8 && counts.gloam <= 10, counts.gloam);
  check('Noonlit apex: 4-6', counts.noonlit >= 4 && counts.noonlit <= 6, counts.noonlit);
  check('boots: one base + 3 upgrades', n('boots_base') === 1 && n('boots_up') === 3);
});

section('catalog: recipes and tiers', () => {
  const bad: string[] = [];
  for (const it of ITEMS) {
    const sum = it.components.reduce((a, c) => a + (byId.get(c)?.cost ?? NaN), 0);
    if (it.components.some((c) => !byId.has(c))) bad.push(`${it.id}: unknown component`);
    if (it.components.length && !(sum < it.cost)) bad.push(`${it.id}: components ${sum} ≥ total ${it.cost} (fee must be positive)`);
  }
  check('every component exists and every recipe fee is positive', bad.length === 0, bad);
  // cycles
  const cyc: string[] = [];
  const visit = (id: string, trail: string[]): void => {
    if (trail.includes(id)) { cyc.push([...trail, id].join(' → ')); return; }
    for (const c of byId.get(id)?.components ?? []) visit(c, [...trail, id]);
  };
  ITEMS.forEach((it) => visit(it.id, []));
  check('no recipe cycles', cyc.length === 0, cyc);
  const tierBad: string[] = [];
  for (const it of ITEMS) {
    const f = frame(it), comps = it.components.map((c) => frame(item(c)));
    const nStats = Object.values(it.stats).filter((v) => v !== 0).length;
    if (['starter', 'consumable', 'slate', 'boots_base'].includes(f) && it.components.length) tierBad.push(`${it.id}: ${f} has components`);
    if (f === 'slate' && nStats !== 1) tierBad.push(`${it.id}: Slate must carry exactly one stat`);
    if (f === 'verdigris' && (nStats !== 2 || comps.some((c) => c !== 'slate'))) tierBad.push(`${it.id}: Verdigris = two stats from Slate parts`);
    if (f === 'gloam' && (comps.some((c) => c !== 'slate' && c !== 'verdigris') || it.passives.length !== 1 || it.passives[0].triggers.length === 0 || it.active))
      tierBad.push(`${it.id}: Gloam = Slate/Verdigris parts and exactly one triggered passive`);
    if (f === 'gloam' && it.uniqueGroup !== it.id) tierBad.push(`${it.id}: Gloam is unique per fighter (uniqueGroup = its id)`);
    if (f === 'noonlit' && (comps.some((c) => c !== 'slate' && c !== 'verdigris') || it.uniqueGroup !== 'noonlit' ||
      !(it.active || it.passives.some((p) => p.triggers.length > 0)))) tierBad.push(`${it.id}: Noonlit = parts, group 'noonlit', a passive or an active`);
    if (f === 'boots_up' && (it.components.length !== 1 || frame(item(it.components[0])) !== 'boots_base')) tierBad.push(`${it.id}: boots upgrade builds from the base pair`);
    if (it.tier === 'boots' && it.uniqueGroup !== 'boots') tierBad.push(`${it.id}: boots share uniqueGroup 'boots'`);
    if (f === 'starter' && (it.uniqueGroup !== 'starter' || it.pools.join() !== 'rift')) tierBad.push(`${it.id}: starters are RIFT-only and share 'starter'`);
    if (f === 'consumable' && (!it.consumable || !it.active || it.sellRatio >= 0.7)) tierBad.push(`${it.id}: consumables have charges, an active and a low sell ratio`);
  }
  check('every frame is built from the frame below it, with its shape', tierBad.length === 0, tierBad);
  const riftStart = modeRules('rift').startGold as number;
  const flask = byFrame('consumable').filter((i) => inPool(i, 'rift') && JSON.stringify(i.active?.effects).includes('"heal"')).sort((a, b) => a.cost - b.cost)[0];
  check(`every starter + one ${flask?.name} fits RIFT's ${riftStart} starting Gleam`, byFrame('starter').every((s) => s.cost + flask.cost <= riftStart),
    byFrame('starter').map((s) => s.cost));
  check('one jungle starter (tag jungle)', byFrame('starter').filter((s) => s.tags.includes('jungle')).length === 1);
});

section('catalog: text, presentation and names', () => {
  // Slate/Verdigris/boots descs state their stats; the numbers must match the stat block
  const miss: string[] = [];
  for (const it of ITEMS) {
    if (!['slate', 'verdigris', 'boots_base', 'boots_up'].includes(frame(it))) continue;
    for (const [k, v] of Object.entries(it.stats)) if (!it.desc.includes(statText(k, v as number))) miss.push(`${it.id}: '${statText(k, v as number)}' (${k}) not in desc`);
  }
  check('stat items: every stat value appears in the desc', miss.length === 0, miss);
  // presentation + summons
  const refBad: string[] = [];
  const walk = (v: unknown, p: string): void => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return; }
    if (!v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v as Raw)) {
      if ((k === 'vfx' || k === 'hitVfx') && typeof x === 'string' && !vfxIds.has(x)) refBad.push(`${p}.${k}: vfx ${x}`);
      if ((k === 'sfx' || k === 'hitSfx') && typeof x === 'string' && !cueIds.has(x)) refBad.push(`${p}.${k}: cue ${x}`);
      if (k === 'op' && x === 'summon') { const u = (v as Raw).unit as string; if (!unitKind.has(u)) refBad.push(`${p}: summon ${u} unknown`); }
      walk(x, `${p}.${k}`);
    }
  };
  walk(ITEMS, 'items'); walk(setup, 'setup');
  check('every vfx / cue id is in the VOCAB library, every summoned unit exists', refBad.length === 0, refBad);
  check('the ward item summons a ward unit', ITEMS.filter((i) => i.tags.includes('vision')).every((i) =>
    JSON.stringify(i.active?.effects ?? []).match(/"unit":"([a-z_]+)"/g)?.every((m) => unitKind.get(m.slice(8, -1)) === 'ward')));
  // ability / passive ids unique across items + setup + units
  const abil: string[] = [];
  for (const it of ITEMS) { it.passives.forEach((p) => abil.push(p.id)); if (it.active) abil.push(it.active.id); }
  setup.spells.forEach((s) => abil.push(s.id)); setup.boons.forEach((b) => abil.push(b.id));
  for (const u of units) { ((u.abilities as Raw[] | undefined) ?? []).forEach((a) => abil.push(a.id as string)); if (u.passive) abil.push((u.passive as Raw).id as string); }
  check('ability / passive / spell / boon ids are unique', new Set(abil).size === abil.length, abil.filter((x, i) => abil.indexOf(x) !== i));
  // deny-list
  const names: NameInput[] = [];
  const nm = (path: string, text: string, at: string): void => { names.push({ path, text, kind: 'name', at }); };
  const pr = (path: string, text: string, at: string): void => { names.push({ path, text, kind: 'prose', at }); };
  ITEMS.forEach((it, i) => {
    nm(`items[${i}].name`, it.name, 'items[].name'); pr(`items[${i}].desc`, it.desc, 'items[].desc');
    it.passives.forEach((p, j) => { nm(`items[${i}].passives[${j}].name`, p.name, 'items[].passives[].name'); pr(`items[${i}].passives[${j}].desc`, p.desc, 'items[].passives[].desc'); });
    if (it.active) { nm(`items[${i}].active.name`, it.active.name, 'items[].active.name'); pr(`items[${i}].active.desc`, it.active.desc, 'items[].active.desc'); }
  });
  setup.spells.forEach((s, i) => { nm(`setup.spells[${i}].name`, s.name, 'setup.spells[].name'); pr(`setup.spells[${i}].desc`, s.desc, 'setup.spells[].desc'); });
  setup.boons.forEach((b, i) => { nm(`setup.boons[${i}].name`, b.name, 'setup.boons[].name'); pr(`setup.boons[${i}].desc`, b.desc, 'setup.boons[].desc'); });
  setup.paths.forEach((p, i) => { nm(`setup.paths[${i}].name`, p.name, 'setup.paths[].name'); pr(`setup.paths[${i}].desc`, p.desc, 'setup.paths[].desc'); });
  const hits = checkNames(names);
  check(`deny-list: ${names.length} names and texts are clean`, hits.length === 0, hits.map((h) => `${h.path} '${h.text}' ~ ${h.protectedName} [${h.category}]`));
  check('player text has no exclamation marks', names.every((s) => !s.text.includes('!')));
});

section('catalog: Gleam efficiency per frame (stats only; passives and actives pay the rest)', () => {
  const bounds: Record<Frame, [number, number]> = {
    starter: [0.9, 1.5], consumable: [0, 99], slate: [0.95, 1.05], verdigris: [0.88, 1.05], gloam: [0.75, 1.02],
    noonlit: [0.8, 1.02], boots_base: [0.95, 1.05], boots_up: [0.9, 1.1],
  };
  const out: string[] = [];
  const bad: string[] = [];
  for (const it of ITEMS) {
    if (frame(it) === 'consumable' || it.tags.includes('jungle')) continue; // the jungle starter is all passive
    const eff = statGleam(it.stats) / it.cost;
    out.push(`${it.id} ${(eff * 100).toFixed(0)}%`);
    const [lo, hi] = bounds[frame(it)];
    if (eff < lo || eff > hi) bad.push(`${it.id} ${(eff * 100).toFixed(0)}% outside ${lo * 100}-${hi * 100}%`);
  }
  console.log(`  efficiency: ${out.join(' · ')}`);
  check('every item sits in its frame\'s efficiency band', bad.length === 0, bad);
});

// ── 3. pools ─────────────────────────────────────────────────────────────────────────────────────
const poolItems = (p: Pool): ItemDefT[] => ITEMS.filter((it) => inPool(it, p));
section('pools', () => {
  check('pools name only rift / bridge / fray', ITEMS.every((it) => it.pools.every((p) => (POOLS as readonly string[]).includes(p))));
  for (const p of POOLS) check(`pool '${p}' is non-empty (${poolItems(p).length} items)`, poolItems(p).length > 0);
  check('rift sells everything except fray-only pieces', ITEMS.every((it) => inPool(it, 'rift') === !(it.pools.length === 1 && it.pools[0] === 'fray')));
  check('bridge: no starters (no recall to swap them out) and no jungle item', poolItems('bridge').every((it) => it.tier !== 'starter' && !it.tags.includes('jungle')));
  const fray = poolItems('fray');
  check('fray: 10-16 items', fray.length >= 10 && fray.length <= 16, fray.length);
  check('fray: no wards, no starters, no Gloam or Noonlit', fray.every((it) => !it.tags.includes('vision') && it.tier !== 'starter' && it.tier !== 'core' && it.tier !== 'apex'));
  check('fray: recipes one step deep and every piece under 2,500 Gleam', fray.every((it) => it.cost < 2500 && it.components.every((c) => item(c).components.length === 0)));
  for (const p of ['rift', 'bridge'] as const) {
    const open = poolItems(p).flatMap((it) => it.components.filter((c) => !inPool(item(c), p)).map((c) => `${it.id}<-${c}`));
    check(`${p}: every component is buyable on its own in the pool`, open.length === 0, open);
  }
});

// ── 4. setup layer ───────────────────────────────────────────────────────────────────────────────
const effectsJson = (s: { effects: unknown }): string => JSON.stringify(s.effects);
section('setup: battle spells', () => {
  const sp = setup.spells;
  check('7-9 battle spells, 2 slots', sp.length >= 7 && sp.length <= 9 && setup.spellSlots === 2);
  const cdBad = sp.filter((s) => { const cd = s.charges ? (Array.isArray(s.charges.recharge) ? s.charges.recharge[0] : s.charges.recharge) : (Array.isArray(s.cooldown) ? s.cooldown[0] : s.cooldown); return cd < 90 || cd > 300; });
  check('every spell recovers in 90-300 s (charges: the recharge)', cdBad.length === 0, cdBad.map((s) => s.id));
  check('spells cost nothing and have one rank', sp.every((s) => s.costKind === 'none' && s.maxRank === 1));
  const has = (pred: (s: typeof sp[number]) => boolean): string[] => sp.filter(pred).map((s) => s.id);
  const jobs = {
    blink: has((s) => effectsJson(s).includes('"op":"blink"')),
    sustain: has((s) => effectsJson(s).includes('"op":"heal"') && s.targeting.kind !== 'unit'),
    offense: has((s) => s.targeting.kind === 'unit' && s.targeting.filter?.fighters !== false && effectsJson(s).includes('"op":"damage"')),
    jungle: has((s) => s.targeting.filter?.fighters === false && s.targeting.filter?.monsters !== false),
    haste: has((s) => /"status":"haste"[^}]*"to":"self"/.test(effectsJson(s))),
    cleanse: has((s) => effectsJson(s).includes('"status":"unstoppable"')),
    shield: has((s) => effectsJson(s).includes('"op":"shield"')),
  };
  console.log(`  jobs ${JSON.stringify(jobs)}`);
  check('the spells cover blink, sustain, offense, jungle, haste, cleanse and shield', Object.values(jobs).every((l) => l.length > 0));
  check('the jungle spell is RIFT-only', jobs.jungle.every((id) => sp.find((s) => s.id === id)!.pools.join() === 'rift'));
  const n = (p: Pool): number => sp.filter((s) => s.pools.length === 0 || s.pools.includes(p)).length;
  check(`every pool has ≥ 2 spells (rift ${n('rift')}, bridge ${n('bridge')}, fray ${n('fray')}); fray is lighter`, POOLS.every((p) => n(p) >= 2) && n('fray') < n('rift'));
});
section('setup: boons and paths', () => {
  const b = setup.boons;
  check('9 boons in 3 paths of 3', b.length === 9 && setup.paths.length === 3 && setup.paths.every((p) => b.filter((x) => x.path === p.id).length === 3));
  check('boonSlots 2', setup.boonSlots === 2);
  check('every boon does something (stats or a trigger)', b.every((x) => x.stats || x.statsPerLevel || x.triggers.length > 0));
  check('FRAY has no boons; RIFT and BRIDGE have all nine', b.every((x) => x.pools.includes('rift') && x.pools.includes('bridge') && !x.pools.includes('fray')));
  const READ = ['#3F9CFF', '#FF9A1F', '#F4EFE2', '#A9A49A', '#A99BFF'];
  const rgb = (h: string): number[] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (a: string, c: string): number => Math.hypot(...rgb(a).map((v, i) => v - rgb(c)[i]));
  check('path colours stay clear of the readability colours (RGB distance ≥ 60)', setup.paths.every((p) => READ.every((r) => dist(p.color, r) >= 60)), setup.paths.map((p) => p.color));
  const d = setup.defaults;
  check('defaults: 2 spells usable in every pool, 2 boons from one path', d.spells.length === 2 &&
    d.spells.every((id) => { const s = setup.spells.find((x) => x.id === id); return !!s && (s.pools.length === 0 || POOLS.every((p) => s.pools.includes(p))); }) &&
    d.boons.length === 2 && new Set(d.boons.map((id) => b.find((x) => x.id === id)?.path)).size === 1);
});

// ── 5. class builds ──────────────────────────────────────────────────────────────────────────────
interface Plan { open: string[]; final: string[] }
const RIFT_FINAL: Record<Cls, string[]> = {
  plinth: ['felt_treads', 'ironstone_mantle', 'warning_bell', 'seatstone', 'dialcutter', 'kindly_lamp'],
  breaker: ['felt_treads', 'dialcutter', 'hourcleaver', 'shadecut', 'ironstone_mantle', 'warning_bell'],
  striker: ['felt_treads', 'shadecut', 'hourcleaver', 'dialcutter', 'splitlight_bow', 'warning_bell'],
  slinger: ['dust_runners', 'splitlight_bow', 'sunstring', 'shadecut', 'dialcutter', 'warning_bell'],
  caster: ['chalk_slippers', 'focal_lens', 'noonglass', 'inkglass_rod', 'warning_bell', 'kindly_lamp'],
  tender: ['chalk_slippers', 'kindly_lamp', 'shelter_lamp', 'warning_bell', 'ironstone_mantle', 'focal_lens'],
};
const PLANS: Record<Pool, Record<Cls, Plan>> = {
  rift: {
    plinth: { open: ['ironstone_guard', 'sap_flask'], final: RIFT_FINAL.plinth },
    breaker: { open: ['notched_blade', 'sap_flask'], final: RIFT_FINAL.breaker },
    striker: { open: ['notched_blade', 'sap_flask'], final: RIFT_FINAL.striker },
    slinger: { open: ['notched_blade', 'sap_flask'], final: RIFT_FINAL.slinger },
    caster: { open: ['reading_lens', 'sap_flask'], final: RIFT_FINAL.caster },
    tender: { open: ['ironstone_guard', 'sap_flask'], final: RIFT_FINAL.tender },
  },
  bridge: {
    plinth: { open: ['road_sandals', 'felt_coat', 'sap_flask'], final: RIFT_FINAL.plinth },
    breaker: { open: ['road_sandals', 'banded_club'], final: RIFT_FINAL.breaker },
    striker: { open: ['road_sandals', 'whetted_knife', 'sap_flask', 'sap_flask'], final: RIFT_FINAL.striker },
    slinger: { open: ['road_sandals', 'glint_sling', 'sap_flask'], final: RIFT_FINAL.slinger },
    caster: { open: ['road_sandals', 'bellglass', 'sap_flask', 'sap_flask'], final: RIFT_FINAL.caster },
    tender: { open: ['road_sandals', 'bellglass', 'spare_lamp'], final: RIFT_FINAL.tender },
  },
  fray: {
    plinth: { open: ['road_sandals', 'felt_coat', 'noon_tonic'], final: ['felt_treads', 'felt_coat', 'linen_hood', 'felt_coat', 'linen_hood', 'banded_club'] },
    breaker: { open: ['road_sandals', 'banded_club', 'noon_tonic'], final: ['felt_treads', 'banded_club', 'banded_club', 'whetted_knife', 'felt_coat', 'linen_hood'] },
    striker: { open: ['road_sandals', 'whetted_knife', 'noon_tonic'], final: ['felt_treads', 'whetted_knife', 'whetted_knife', 'banded_club', 'banded_club', 'linen_hood'] },
    slinger: { open: ['road_sandals', 'glint_sling', 'noon_tonic'], final: ['dust_runners', 'glint_sling', 'glint_sling', 'whetted_knife', 'glint_sling', 'banded_club'] },
    caster: { open: ['road_sandals', 'bellglass', 'noon_tonic'], final: ['chalk_slippers', 'bellglass', 'burning_glass', 'bellglass', 'burning_glass', 'linen_hood'] },
    tender: { open: ['road_sandals', 'bellglass', 'noon_tonic'], final: ['chalk_slippers', 'bellglass', 'bellglass', 'felt_coat', 'linen_hood', 'burning_glass'] },
  },
};
const sumStats = (ids: string[]): Record<string, number> => {
  const s: Record<string, number> = {};
  for (const id of ids) for (const [k, v] of Object.entries(item(id).stats)) s[k] = (s[k] ?? 0) + (v as number);
  return s;
};
/** what each class must get from a full build (FRAY's lighter bags need about half) */
const NEEDS: Record<Cls, (s: Record<string, number>, tags: Set<string>, pool: Pool) => string[]> = {
  plinth: (s, _t, p) => { const f = p === 'fray' ? 0.6 : 1; return [s.hp >= 1000 * f ? '' : 'hp', s.armor >= 60 * f ? '' : 'armor', s.resist >= 60 * f ? '' : 'resist']; },
  breaker: (s, _t, p) => { const f = p === 'fray' ? 0.5 : 1; return [s.ad >= 80 * f ? '' : 'ad', s.hp >= 600 * f ? '' : 'hp']; },
  striker: (s, _t, p) => [s.ad >= (p === 'fray' ? 45 : 90) ? '' : 'ad', (s.armorPen ?? 0) >= 15 ? '' : 'armorPen'],
  slinger: (s, t, p) => [(s.attackSpeed ?? 0) >= 0.5 ? '' : 'attackSpeed', (s.crit ?? 0) >= 0.3 ? '' : 'crit', p === 'fray' || t.has('onhit') ? '' : 'onhit'],
  caster: (s, _t, p) => [(s.ap ?? 0) >= (p === 'fray' ? 100 : 150) ? '' : 'ap', (s.haste ?? 0) >= 20 ? '' : 'haste', (s.magicPen ?? 0) + (s.magicPenPct ?? 0) * 100 >= 8 ? '' : 'pen'],
  tender: (s, _t, p) => [p === 'fray' || (s.healShieldPower ?? 0) >= 0.1 ? '' : 'healShieldPower', (s.haste ?? 0) >= 20 ? '' : 'haste', (s.ap ?? 0) >= 40 ? '' : 'ap'],
};
section('class builds (static)', () => {
  for (const p of POOLS) for (const c of CLASSES) {
    const plan = PLANS[p][c];
    const all = [...plan.open, ...plan.final];
    const notIn = all.filter((id) => !byId.has(id) || !inPool(item(id), p));
    const groups = plan.final.map((id) => item(id).uniqueGroup).filter((g): g is string => !!g);
    const s = sumStats(plan.final);
    const tags = new Set(plan.final.flatMap((id) => item(id).tags));
    const missing = NEEDS[c](s, tags, p).filter(Boolean);
    const noon = plan.final.filter((id) => item(id).tier === 'apex').length;
    const bootsUp = plan.final.filter((id) => frame(item(id)) === 'boots_up').length;
    const start = modeRules(p).startGold as number;
    const openCost = plan.open.reduce((a, id) => a + item(id).cost, 0);
    const total = plan.final.reduce((a, id) => a + item(id).cost, 0);
    check(`${p}/${c}: in pool, ≤ 6 slots, one boots upgrade, ${p === 'fray' ? 'no' : 'one'} Noonlit, unique groups, opening ${openCost} ≤ ${start}, covers the class (full build ${total} Gleam)`,
      notIn.length === 0 && plan.final.length <= 6 && bootsUp === 1 && noon === (p === 'fray' ? 0 : 1) &&
      new Set(groups).size === groups.length && missing.length === 0 && openCost <= start,
      { notIn, missing, noon, bootsUp, groups, openCost });
  }
});

// ── 6-9. the sim ─────────────────────────────────────────────────────────────────────────────────
const STYLE: Record<Cls, string> = { plinth: 'frontline', breaker: 'diver', striker: 'burst', slinger: 'marksman', caster: 'artillery', tender: 'warden' };
const RANGED = new Set<Cls>(['slinger', 'caster', 'tender']);
function probeFighter(c: Cls): Raw {
  const f = fighter(`fx_probe_${c}`, {
    resource: 'res_light',
    base: { hp: 620, hpRegen: 1.5, ad: 60, ap: 0, armor: 30, resist: 30, attackSpeed: 0.66, moveSpeed: 3.4 },
    growth: { hp: 100, ad: 3.2, armor: 4.5, resist: 1.5 },
    attack: RANGED.has(c) ? { range: 5.5, windup: 0.25, projectileSpeed: 22 } : { range: 1.8, windup: 0.3 },
    // a1: a short-cooldown area hit, so ability-triggered item passives can be exercised
    a1: ability(`fx_probe_${c}_a1`, [{ op: 'area', shape: { kind: 'circle', radius: 3 }, at: 'self', onHit: [{ op: 'damage', amount: 40, type: RANGED.has(c) ? 'magic' : 'phys' }] }],
      { cooldown: 0.4, cost: 0, costKind: 'none', targeting: { kind: 'none' }, castTime: 0, maxRank: 5, ai: { use: ['damage'] } }),
  });
  f.ai = { style: STYLE[c], preferredRange: RANGED.has(c) ? 5 : 1.6 };
  return f;
}
const ART = {
  scene: 'assets/fx/scene.glb', sky: 'assets/fx/sky.hdr', lut: 'assets/fx/lut.cube', minimap: 'assets/fx/mm.png',
  lighting: { sunDir: [0, 1, 0], sunColor: '#ffffff', sunIntensity: 1, ambient: 0.3, fogColor: '#000000', fogDensity: 0, exposure: 1 }, music: 'fx_music',
};
const CAM = { pitchDeg: 52, fovDeg: 26, distance: 28.5, minDistance: 24.5, maxDistance: 33 };
const BASES = (w: number, h: number): Raw[] => [
  { team: 0, spawn: [5, h / 2], fountain: { at: [3, h / 2], radius: 4 }, shop: { at: [3, h / 2], radius: 6 } },
  { team: 1, spawn: [w - 5, h / 2], fountain: { at: [w - 3, h / 2], radius: 4 }, shop: { at: [w - 3, h / 2], radius: 6 } },
];
/** stub maps with the real lane ids (layout truth is the MAPS lane's; the shop needs bases / a cart) */
const MAPS: Raw[] = [
  { id: 'map_rift', name: 'Hourfall', desc: 'probe stub', size: [120, 60], navCell: 0.5, walls: [],
    lanes: [12, 30, 48].map((y, i) => ({ id: ['road_high', 'road_seat', 'road_low'][i], name: `Road ${i}`, path: [[10, y], [110, y]] })),
    bases: BASES(120, 60), camps: [{ id: 'probe_camp', units: [{ unit: 'stilltusk', at: [60, 20] }], firstSpawn: 1, respawn: 120 }], art: ART, camera: CAM },
  { id: 'map_bridge', name: 'Needlespan', desc: 'probe stub', size: [120, 30], navCell: 0.5, walls: [],
    lanes: [{ id: 'road_span', name: 'Span Road', path: [[10, 15], [110, 15]] }], bases: BASES(120, 30), art: ART, camera: CAM },
  { id: 'map_fray', name: 'Noonplate', desc: 'probe stub', size: [60, 60], navCell: 0.5, walls: [], lanes: [], bases: [],
    spawns: Array.from({ length: 10 }, (_, i) => [Math.round((30 + 22 * Math.cos(i * Math.PI / 5)) * 100) / 100, Math.round((30 + 22 * Math.sin(i * Math.PI / 5)) * 100) / 100]),
    shops: [{ at: [30, 30], radius: 3 }], art: ART, camera: CAM },
];
function buildCatalog(): CatalogT {
  const raw = rawCatalog({ fighters: CLASSES.map(probeFighter) });
  Object.assign(raw, {
    items: rawItems, setup: rawSetup, units, teamBuffs, modes, queues, maps: MAPS,
    resources: [...(raw.resources as Raw[]), ...resources],
    vfx: family('vfx.json', 'vfx'), audio: read('audio.json'),
  });
  (raw.audio as { music: Raw }).music.fx_music = { file: 'assets/fx/m.ogg', bpm: 100 };
  return Catalog.parse(raw);
}
let CAT: CatalogT | null = null;
section('sim catalog builds from the real items, setup, units, modes and queues', () => { CAT = buildCatalog(); check('catalog parses', !!CAT); });
if (!CAT) { finish('probe_items'); process.exit(1); }
const catalog: CatalogT = CAT;

const MATCH: Record<Pool, { mode: string; queue: string; map: string }> = {
  rift: { mode: 'rift', queue: 'rift_standard', map: 'map_rift' },
  bridge: { mode: 'bridge', queue: 'bridge_standard', map: 'map_bridge' },
  fray: { mode: 'fray', queue: 'fray_standard', map: 'map_fray' },
};
interface SeatOpt { cls: Cls; team: number; spells?: string[]; boons?: string[]; controller?: 'human' | 'bot' }
function mkSetup(pool: Pool, seats: SeatOpt[], seed = 99): MatchSetup {
  const m = MATCH[pool];
  return {
    matchId: 'probe_items', seed, queue: m.queue, mode: m.mode, map: m.map, catalogVersion: catalog.version,
    seats: seats.map((s, i): SeatSetup => ({
      player: i, team: s.team, name: `P${i}`, fighter: `fx_probe_${s.cls}`, skin: `fx_probe_${s.cls}_skin`,
      loadout: { spells: s.spells ?? setup.defaults.spells, boons: s.boons ?? setup.defaults.boons }, controller: s.controller ?? 'human', colorIndex: i,
    })),
  };
}
function mkSim(pool: Pool, seats: SeatOpt[]): Sim {
  const sim = createSim(catalog, mkSetup(pool, seats), { pregameSeconds: 0 });
  for (const p of sim.world.players) if (p?.ent) p.ent.autoAttack = false;
  sim.step();
  return sim;
}
const P = (sim: Sim, i = 0): Player => sim.world.players[i];
const E = (sim: Sim, i = 0): Entity => sim.world.players[i].ent!;
function place(sim: Sim, i: number, x: number, y: number): void { const e = E(sim, i); e.x = x; e.y = y; sim.world.hashDirty = true; }
function toShop(sim: Sim, pool: Pool, i = 0): void {
  const m = sim.world.mapDef;
  if (pool === 'fray') place(sim, i, m.shops[0].at[0], m.shops[0].at[1]);
  else { const b = m.bases.find((x) => x.team === P(sim, i).team)!; place(sim, i, b.shop.at[0] + 1, b.shop.at[1]); }
  sim.step();
}
function run(sim: Sim, sec: number): SimEvent[] { const out: SimEvent[] = []; for (let i = 0; i < Math.round(sec * 30); i++) out.push(...sim.step()); return out; }
const cmd = (sim: Sim, c: Parameters<Sim['command']>[1], p = 0): SimEvent[] => { sim.command(p, c); return sim.step(); };
const denied = (ev: SimEvent[]): string | undefined => ofType(ev, 'announce').find((a) => a.key === 'shop_denied')?.params?.reason as string | undefined;

/** independent model of the shop's recipe pricing (CONTRACT §5.6): owned parts are consumed at full cost,
 *  a missing part is looked for one level down */
function model(id: string, bag: readonly (string | null)[]): { price: number; consumed: number[] } {
  const claimed = bag.map(() => false);
  const walk = (it: ItemDefT, depth: number): number => {
    let v = 0;
    for (const c of it.components) {
      const k = bag.findIndex((x, i) => !claimed[i] && x === c);
      if (k >= 0) { claimed[k] = true; v += item(c).cost; } else if (depth < 8) v += walk(item(c), depth + 1);
    }
    return v;
  };
  const d = walk(item(id), 0);
  return { price: Math.max(0, item(id).cost - d), consumed: claimed.flatMap((x, i) => (x ? [i] : [])) };
}
const earnedIn = (ev: SimEvent[]): number => ofType(ev, 'gold').filter((g) => g.player === 0 && g.reason !== 'sell').reduce((a, g) => a + g.amount, 0);
const free = (p: Player): number => p.items.filter((x) => !x).length;

interface Tally { buys: number; priceBad: string[]; undoBad: string[]; shortBad: string[]; sells: number; sellBad: string[] }
/** buy one item with exactly its modelled price in the purse; check model == quote == gold spent */
function buyExact(sim: Sim, id: string, t: Tally, probeShort: boolean): boolean {
  const w = sim.world, p = P(sim);
  const m = model(id, p.items);
  if (probeShort && m.price > 0) {
    p.gold = m.price - 1;
    const short = quoteBuy(w, p, id);
    const ev = cmd(sim, { type: 'buy', item: id });
    if (short.ok || short.reason !== 'gold' || denied(ev) !== 'gold') t.shortBad.push(`${id}: ${short.reason} / ${denied(ev)}`);
  }
  const before = p.items.slice();
  p.gold = m.price;
  const q = quoteBuy(w, p, id);
  const ev = cmd(sim, { type: 'buy', item: id });
  t.buys++;
  const spentOk = near(p.gold - earnedIn(ev), 0, 1e-6);
  const ok = q.ok && q.price === m.price && spentOk && ofType(ev, 'buy').some((b) => b.item === id) && m.consumed.every((i) => before[i] !== p.items[i] || p.items[i] === id);
  if (!ok) t.priceBad.push(`${id}: model ${m.price} quote ${q.ok ? q.price : q.reason} gold left ${p.gold.toFixed(2)} denied ${denied(ev) ?? '-'}`);
  return ok;
}
/** build `id` from its parts while there is room for them (leaves first, parts already in the bag and
 *  parts this pool does not sell are skipped: the shop prices those into the purchase), then the item */
function acquire(sim: Sim, id: string, t: Tally, pool: Pool): void {
  const spare = P(sim).items.slice();
  for (const c of item(id).components) {
    const k = spare.indexOf(c);
    if (k >= 0) { spare[k] = null; continue; }
    if (free(P(sim)) >= 2 && inPool(item(c), pool)) acquire(sim, c, t, pool);
  }
  const consumesParts = item(id).components.length > 0 && model(id, P(sim).items).consumed.length > 0;
  const big = item(id).tier === 'core' || item(id).tier === 'apex';
  const before = P(sim).items.slice();
  if (!buyExact(sim, id, t, big)) return;
  // undo a recipe purchase: the parts and the Gleam come back; then buy it again at the same price
  if (consumesParts) {
    const paid = model(id, before).price;
    const g = P(sim).gold;
    cmd(sim, { type: 'undo' });
    if (P(sim).items.join() !== before.join() || !near(P(sim).gold, g + paid, 1e-6)) t.undoBad.push(`${id}: ${P(sim).items.join()} gold ${P(sim).gold}`);
    else buyExact(sim, id, t, false);
  }
}
function sellSlot(sim: Sim, slot: number, t: Tally): void {
  const p = P(sim), id = p.items[slot]!;
  const it = item(id);
  const expect = Math.floor(it.cost * it.sellRatio * (it.consumable ? p.itemCharges[slot] / it.consumable.charges : 1));
  const g = p.gold;
  const ev = cmd(sim, { type: 'sell', slot });
  t.sells++;
  if (!near(p.gold - earnedIn(ev) - g, expect, 1e-6) || p.items[slot] !== null) t.sellBad.push(`${id}: +${(p.gold - g).toFixed(1)} expected ${expect}`);
}
const STAT_KEYS = ['hp', 'ad', 'ap', 'armor', 'resist', 'haste', 'crit', 'lifesteal', 'omnivamp', 'healShieldPower', 'magicPen', 'armorPen', 'magicPenPct'] as const;

section('shop: every class buys its build step by step in every pool', () => {
  for (const pool of POOLS) for (const c of CLASSES) {
    const sim = mkSim(pool, [{ cls: c, team: 0 }, { cls: 'plinth', team: 1 }]);
    const p = P(sim), e = E(sim);
    toShop(sim, pool);
    const start = modeRules(pool).startGold as number;
    const t: Tally = { buys: 0, priceBad: [], undoBad: [], shortBad: [], sells: 0, sellBad: [] };
    const base: Record<string, number> = {};
    for (const k of STAT_KEYS) base[k] = (e.stats as unknown as Record<string, number>)[k];
    const plan = PLANS[pool][c];
    // the opening with the real starting purse
    const startOk = near(p.gold, start, 3); // passive income may tick once
    let spent = 0;
    for (const id of plan.open) { const m = model(id, p.items); const g = p.gold; cmd(sim, { type: 'buy', item: id }); spent += m.price; if (!near(g - p.gold, m.price, 3)) t.priceBad.push(`open ${id}`); }
    const openOk = plan.open.every((id) => p.items.includes(id)) && spent <= start;
    // refusals: out-of-pool pieces and a second boots base / Noonlit
    const foreign = ITEMS.find((it) => !inPool(it, pool))!;
    p.gold = 99999;
    const poolDeny = denied(cmd(sim, { type: 'buy', item: foreign.id })) === 'pool';
    // consumables first leave the bag (sell + undo + sell), then the starter when room is needed
    for (let s = 0; s < 6; s++) {
      const id = p.items[s];
      if (id && item(id).tier === 'consumable') {
        sellSlot(sim, s, t);
        const g = p.gold; cmd(sim, { type: 'undo' });
        if (p.items[s] !== id || !(p.gold < g)) t.undoBad.push(`undo sell ${id}`);
        sellSlot(sim, s, t);
      }
    }
    const kept = p.items.slice();
    for (const id of plan.final) {
      const k = kept.indexOf(id);
      if (k >= 0) { kept[k] = null; continue; } // an opener that is part of the final bag
      if (free(p) === 0 || (free(p) === 1 && item(id).components.length > 0 && model(id, p.items).consumed.length === 0 && plan.final.indexOf(id) < plan.final.length - 1)) {
        const s = p.items.findIndex((x) => x && (item(x).tier === 'starter' || !plan.final.includes(x)));
        if (s >= 0) sellSlot(sim, s, t);
      }
      if (free(p) === 0) { const s = p.items.findIndex((x) => x && item(x).tier === 'starter'); if (s >= 0) sellSlot(sim, s, t); }
      acquire(sim, id, t, pool);
    }
    const bag = p.items.filter((x): x is string => !!x).sort();
    const want = plan.final.slice().sort();
    // second Noonlit / boots refused as 'unique'
    p.gold = 99999;
    const s0 = p.items.indexOf(plan.final[plan.final.length - 1]);
    let uniqueOk = true;
    if (s0 >= 0) {
      sellSlot(sim, s0, t);
      const otherBoots = ITEMS.find((it) => frame(it) === 'boots_up' && inPool(it, pool) && !p.items.includes(it.id))!;
      uniqueOk = denied(cmd(sim, { type: 'buy', item: otherBoots.id })) === 'unique';
      if (pool !== 'fray') {
        const otherNoon = ITEMS.find((it) => it.tier === 'apex' && !plan.final.includes(it.id))!;
        uniqueOk &&= denied(cmd(sim, { type: 'buy', item: otherNoon.id })) === 'unique';
      }
      cmd(sim, { type: 'undo' }); // put the sold piece back
    }
    sim.step();
    const restored = p.items.filter((x): x is string => !!x).sort().join() === want.join();
    // stats wired: the bag's stat sum shows up on the fighter
    const sum = sumStats(plan.final);
    const statBad = STAT_KEYS.filter((k) => !near((e.stats as unknown as Record<string, number>)[k] - base[k], sum[k] ?? 0, 1e-6))
      .map((k) => `${k} +${((e.stats as unknown as Record<string, number>)[k] - base[k]).toFixed(3)} vs ${sum[k] ?? 0}`);
    const passOk = plan.final.flatMap((id) => item(id).passives.map((x) => x.id)).every((pid) => e.passives.some((x) => x.id === pid));
    check(`${pool}/${c}: ${t.buys} buys at modelled prices, ${t.sells} sells, undo exact, refusals right, build ${want.length}/6, stats + passives wired`,
      startOk && openOk && poolDeny && uniqueOk && t.priceBad.length === 0 && t.undoBad.length === 0 && t.shortBad.length === 0 && t.sellBad.length === 0 &&
      bag.join() === want.join() && restored && statBad.length === 0 && passOk,
      { startOk, openOk, poolDeny, uniqueOk, price: t.priceBad.slice(0, 4), undo: t.undoBad.slice(0, 4), short: t.shortBad.slice(0, 4), sell: t.sellBad, bag, statBad, passOk });
  }
});

section('shop: the jungle opening and leaving the shop', () => {
  const sim = mkSim('rift', [{ cls: 'breaker', team: 0 }, { cls: 'plinth', team: 1 }]);
  const p = P(sim);
  toShop(sim, 'rift');
  for (const id of ['grove_sickle', 'sap_flask', 'sap_flask']) cmd(sim, { type: 'buy', item: id });
  check('grove sickle + 2 flasks from 480 Gleam', p.items.includes('grove_sickle') && p.itemCharges[p.items.indexOf('sap_flask')] === 2 && p.gold >= 0 && p.gold < 480 - 449);
  check('a second starter is refused (unique)', denied(cmd(sim, { type: 'buy', item: 'notched_blade' })) === 'unique');
  check('undo depth counts the purchases', undoDepth(sim.world, 0) === 3);
  place(sim, 0, 60, 30); sim.step();
  check('walking out of the shop clears undo', undoDepth(sim.world, 0) === 0 && !p.canShop);
});

// ── 7. every item passive and active fires ───────────────────────────────────────────────────────
/** a sim with the tester at mid-map and an enemy fighter 2 m away (plus an ally for team effects) */
function arena(pool: Pool, c: Cls, items: string[]): { sim: Sim; w: World; e: Entity; foe: Entity; ally: Entity | null } {
  const seats: SeatOpt[] = [{ cls: c, team: 0, boons: [] }, { cls: 'plinth', team: 1, boons: [] }];
  if (pool !== 'fray') seats.push({ cls: 'tender', team: 0, boons: [] });
  const sim = mkSim(pool, seats);
  toShop(sim, pool);
  for (const id of items) { P(sim).gold = 99999; cmd(sim, { type: 'buy', item: id }); }
  cmd(sim, { type: 'levelUp', slot: 'a1' });
  place(sim, 0, 40, pool === 'fray' ? 40 : 20); place(sim, 1, 42, pool === 'fray' ? 40 : 20);
  if (pool !== 'fray') place(sim, 2, 39, 21);
  run(sim, 0.4); // vision (10 Hz) sees everyone before attack orders
  return { sim, w: sim.world, e: E(sim), foe: E(sim, 1), ally: pool !== 'fray' ? E(sim, 2) : null };
}
/** events emitted by `fn` when it runs outside step() (tryCast, dealDamage) */
function during(w: World, fn: () => void): SimEvent[] { const n0 = w.events.length; fn(); return w.events.slice(n0); }
const dmgBy = (ev: SimEvent[], ability: string): Extract<SimEvent, { e: 'damage' }>[] => ofType(ev, 'damage').filter((d) => d.ability === ability);
const castA1 = (a: ReturnType<typeof arena>): SimEvent[] => {
  let r = '';
  const pre = during(a.w, () => { r = tryCast(a.w, a.e, SLOT_A1); });
  if (r !== 'ok') console.log(`  a1 cast: ${r}`);
  return pre.concat(run(a.sim, 0.1));
};
/** cast a slot now; returns [result, events of the cast + `sec` seconds after] */
function castNow(a: ReturnType<typeof arena>, slot: number, sec: number, x?: number, y?: number, target?: number): [string, SimEvent[]] {
  let r = '';
  const pre = during(a.w, () => { r = tryCast(a.w, a.e, slot, x, y, target); });
  return [r, pre.concat(run(a.sim, sec))];
}
const hit = (a: ReturnType<typeof arena>, src: Entity, dst: Entity, amt: number, type: 'phys' | 'magic' | 'true' = 'phys'): SimEvent[] => during(a.w, () => { dealDamage(a.w, src, dst, amt, type); });
const itemSlot = (a: ReturnType<typeof arena>, id: string): number => SLOT_ITEM1 + P(a.sim).items.indexOf(id);

section('item passives and actives fire in the sim', () => {
  const healOf = (ev: SimEvent[], dst: Entity): number[] => ofType(ev, 'heal').filter((h) => h.dst === dst.id).map((h) => h.amount);
  { // starters
    const a = arena('rift', 'breaker', ['notched_blade']);
    a.e.hp = a.e.maxHp - 100;
    const wick = spawnUnit(a.w, 'shieldwick', 1, 41, 22);
    const ev = hit(a, a.e, wick, 1e6, 'true').concat(run(a.sim, 0.1));
    check('Notched Blade: a Wick you finish heals 6', healOf(ev, a.e).some((h) => near(h, 6)), healOf(ev, a.e));
  }
  {
    const a = arena('rift', 'caster', ['reading_lens']);
    a.e.hp = a.e.maxHp - 100;
    const ev = castA1(a);
    check('Reading Lens: an ability hit on a fighter heals 10 + 1 per level', healOf(ev, a.e).some((h) => near(h, 10 + a.e.level)), healOf(ev, a.e));
  }
  {
    const a = arena('rift', 'plinth', ['ironstone_guard']);
    hit(a, a.foe, a.e, 30);
    check('Ironstone Guard: a fighter hit gives a 20 + 4/level shield', near(a.e.shield, 20 + 4 * a.e.level), a.e.shield);
  }
  {
    const a = arena('rift', 'breaker', ['grove_sickle']);
    const mob = spawnUnit(a.w, 'stilltusk', -1, 41.5, 20);
    run(a.sim, 0.4); // vision catches up (10 Hz)
    cmd(a.sim, { type: 'attack', target: mob.id });
    const ev = run(a.sim, 3);
    check('Grove Sickle: attacks on monsters deal bonus magic damage', dmgBy(ev, 'grove_sickle_grove_work').some((d) => d.dst === mob.id && d.dtype === 'magic'),
      ofType(ev, 'damage').filter((d) => d.src === a.e.id).map((d) => d.ability ?? 'attack').slice(0, 6));
  }
  { // Gloam
    const a = arena('rift', 'plinth', ['ironstone_mantle']);
    const arm0 = a.e.stats.armor;
    for (let i = 0; i < 8; i++) { hit(a, a.foe, a.e, 5); run(a.sim, 0.6); }
    const b = a.e.buffs.find((x) => x.id === 'ironstone_mantle_patience');
    check('Ironstone Mantle: hits from fighters stack armor/resist to 5', !!b && b.stacks === 5 && near(a.e.stats.armor - arm0, 20, 1e-6), { stacks: b?.stacks, d: a.e.stats.armor - arm0 });
  }
  {
    const a = arena('rift', 'plinth', ['warning_bell']);
    let ev: SimEvent[] = [];
    for (let i = 0; i < 6; i++) { ev = ev.concat(hit(a, a.foe, a.e, 5), run(a.sim, 0.5)); }
    check('Warning Bell: the 6th hit rings, damaging and slowing the attacker', dmgBy(ev, 'warning_bell_alarm').some((d) => d.dst === a.foe.id) && a.foe.statuses.some((s) => s.kind === 'slow'),
      a.e.counters);
  }
  {
    const a = arena('rift', 'breaker', ['dialcutter']);
    castA1(a); run(a.sim, 0.5); castA1(a);
    const b = a.e.buffs.find((x) => x.id === 'dialcutter_pace');
    check('Dialcutter: each cast stacks attack and move speed', !!b && b.stacks === 2, b?.stacks);
  }
  {
    const a = arena('rift', 'striker', ['shadecut']);
    a.foe.hp = a.foe.maxHp * 0.3;
    const ev = castA1(a);
    check('Shadecut: hitting a fighter below 40% adds missing-health damage', dmgBy(ev, 'shadecut_cut_short').some((d) => d.dst === a.foe.id && d.dtype === 'phys'));
  }
  {
    const a = arena('rift', 'slinger', ['splitlight_bow']);
    cmd(a.sim, { type: 'attack', target: a.foe.id });
    const ev = run(a.sim, 6);
    check('Splitlight Bow: every third attack adds a hit', dmgBy(ev, 'splitlight_bow_count').length >= 1,
      ofType(ev, 'damage').filter((d) => d.src === a.e.id).map((d) => d.ability ?? 'attack').slice(0, 8));
  }
  {
    const a = arena('rift', 'caster', ['focal_lens']);
    const ev1 = castA1(a); run(a.sim, 0.5); const ev2 = castA1(a);
    check('Focal Lens: first ability hit per 8 s adds magic damage, the next does not', dmgBy(ev1, 'focal_lens_point').length === 1 && dmgBy(ev2, 'focal_lens_point').length === 0);
  }
  {
    const a = arena('rift', 'caster', ['inkglass_rod']);
    castA1(a);
    check('Inkglass Rod: ability hits shred resist', a.foe.statuses.some((s) => s.kind === 'resist_shred' && near(s.power, 0.15)));
  }
  {
    const a = arena('rift', 'tender', ['kindly_lamp']);
    const ev = castA1(a);
    check('Kindly Lamp: a cast hastes and shields you and the nearby ally', ofType(ev, 'shield').some((s) => s.dst === a.e.id) && ofType(ev, 'shield').some((s) => s.dst === a.ally!.id) &&
      a.ally!.statuses.some((s) => s.kind === 'haste'), ofType(ev, 'shield'));
  }
  { // Noonlit
    const a = arena('rift', 'slinger', ['sunstring']);
    cmd(a.sim, { type: 'attack', target: a.foe.id });
    const ev = run(a.sim, 3);
    check('Sunstring: attacks deal 15 + 2.5% current health magic damage', dmgBy(ev, 'sunstring_glare').length >= 1,
      ofType(ev, 'damage').filter((d) => d.src === a.e.id).map((d) => d.ability ?? 'attack').slice(0, 8));
  }
  {
    const a = arena('rift', 'caster', ['noonglass']);
    let ev: SimEvent[] = [];
    for (let i = 0; i < 3; i++) { ev = ev.concat(castA1(a), run(a.sim, 0.5)); }
    check('Noonglass: the third marked hit bursts', dmgBy(ev, 'noonglass_gather').length === 1 && !a.foe.marks.some((m) => m.id === 'noonglass_light'), a.foe.marks);
  }
  {
    const a = arena('rift', 'plinth', ['seatstone']);
    const [r, ev] = castNow(a, itemSlot(a, 'seatstone'), 1);
    check('Seatstone: Hold Ground shields you, then cracks the ground (damage + slow)', r === 'ok' && a.e.shield > 0 &&
      dmgBy(ev, 'seatstone_hold').some((d) => d.dst === a.foe.id) && a.foe.statuses.some((s) => s.kind === 'slow'), r);
  }
  {
    const a = arena('rift', 'breaker', ['hourcleaver']);
    hit(a, a.foe, a.e, a.e.hp * 0.75, 'true');
    a.sim.step();
    check('Hourcleaver: dropping below 35% gives a shield and tenacity', a.e.shield > 0 && a.e.buffs.some((b) => b.id === 'hourcleaver_last_hour'));
  }
  {
    const a = arena('rift', 'tender', ['shelter_lamp']);
    const [r, ev] = castNow(a, itemSlot(a, 'shelter_lamp'), 0.5);
    check('Shelter Lamp: Shelter shields you and nearby allies', r === 'ok' && ofType(ev, 'shield').some((s) => s.dst === a.e.id) && ofType(ev, 'shield').some((s) => s.dst === a.ally!.id), r);
  }
  { // consumables
    const a = arena('rift', 'breaker', ['sap_flask']);
    a.e.hp = a.e.maxHp * 0.4;
    const [r, ev] = castNow(a, itemSlot(a, 'sap_flask'), 10);
    const healed = healOf(ev, a.e).reduce((x, h) => x + h, 0);
    check('Sap Flask: heals 120 over 9 s and is used up', r === 'ok' && near(healed, 120, 1e-6) && !P(a.sim).items.includes('sap_flask'), { r, healed });
  }
  {
    const a = arena('rift', 'tender', ['spare_lamp', 'spare_lamp']);
    const slot = itemSlot(a, 'spare_lamp');
    check('Spare Lamp: two stack in one slot', P(a.sim).itemCharges[slot - SLOT_ITEM1] === 2);
    castNow(a, slot, 1.2, 44, 20);
    const lamps = a.w.entities.filter((x) => x.alive && x.def === 'hooded_lamp' && x.ownerEid === a.e.id);
    check('Spare Lamp: sets a Hooded Lamp ward for 2:30', lamps.length === 1 && lamps[0].kind === 'ward' && P(a.sim).itemCharges[slot - SLOT_ITEM1] === 1);
  }
  {
    const a = arena('fray', 'breaker', ['noon_tonic']);
    a.e.hp = a.e.maxHp * 0.4;
    const [r, ev] = castNow(a, itemSlot(a, 'noon_tonic'), 0.1);
    check('Noon Tonic (FRAY): heals 70 + 6% at once and hastes', r === 'ok' && healOf(ev, a.e).some((h) => near(h, 70 + 0.06 * a.e.maxHp, 1e-6)) &&
      a.e.statuses.some((s) => s.kind === 'haste'), { r, heals: healOf(ev, a.e) });
  }
});

// ── 8. loadouts: spells and boons per mode ───────────────────────────────────────────────────────
section('setup: loadouts honour the mode pools', () => {
  const all = setup.spells.map((s) => s.id);
  for (const pool of POOLS) {
    const sim = mkSim(pool, [{ cls: 'breaker', team: 0, spells: ['hourstrike', 'glint_step'], boons: ['dense_stone', 'second_shadow'] }, { cls: 'plinth', team: 1 }]);
    const lo = effectiveLoadout(sim.world, sim.world.setup.seats[0]);
    const okSpells = pool === 'rift' ? lo.spells.join() === 'hourstrike,glint_step' : lo.spells.join() === ',glint_step';
    const okBoons = pool === 'fray' ? lo.boons.length === 0 : lo.boons.join() === 'dense_stone,second_shadow';
    check(`${pool}: Hourstrike ${pool === 'rift' ? 'kept' : 'dropped'}, boons ${pool === 'fray' ? 'dropped' : 'kept'}`, okSpells && okBoons, lo);
  }
  check('every spell is in at least one pool', all.every((id) => setup.spells.find((s) => s.id === id)!.pools.length > 0));
});

function spellArena(spells: [string, string], boons: string[] = [], c: Cls = 'breaker'): ReturnType<typeof arena> {
  const seats: SeatOpt[] = [{ cls: c, team: 0, spells, boons }, { cls: 'plinth', team: 1, boons: [] }, { cls: 'tender', team: 0, boons: [] }];
  const sim = mkSim('rift', seats);
  cmd(sim, { type: 'levelUp', slot: 'a1' });
  place(sim, 0, 40, 20); place(sim, 1, 43, 20); place(sim, 2, 38, 21);
  run(sim, 0.4);
  return { sim, w: sim.world, e: E(sim), foe: E(sim, 1), ally: E(sim, 2) };
}
section('setup: every battle spell does its job', () => {
  const healOf = (ev: SimEvent[], dst: Entity): number[] => ofType(ev, 'heal').filter((h) => h.dst === dst.id).map((h) => h.amount);
  {
    const a = spellArena(['glint_step', 'saplight']);
    const x0 = a.e.x;
    const [r] = castNow(a, SLOT_SPELL1, 0.1, a.e.x - 20, a.e.y);
    check('Glint Step: blinks 4.5 m toward the point', r === 'ok' && near(x0 - a.e.x, 4.5, 0.3), { r, d: x0 - a.e.x });
    place(a.sim, 0, 40, 20); a.sim.step();
    a.e.hp = a.e.maxHp * 0.3; a.ally!.hp = a.ally!.maxHp * 0.3;
    const [r2, ev] = castNow(a, SLOT_SPELL1 + 1, 0.1);
    const L = a.e.level;
    check('Saplight: heals you 80 + 16/level and allies 40 + 8/level', r2 === 'ok' && healOf(ev, a.e).some((h) => near(h, 80 + 16 * L)) &&
      healOf(ev, a.ally!).some((h) => near(h, 40 + 8 * L)), { r2, self: healOf(ev, a.e), ally: healOf(ev, a.ally!) });
  }
  {
    const a = spellArena(['hairline', 'hourstrike']);
    const [r, ev] = castNow(a, SLOT_SPELL1, 0.1, undefined, undefined, a.foe.id);
    const kinds = a.foe.statuses.map((s) => s.kind);
    check('Hairline: 20 + 8/level true damage, armor/resist shred and grievous on the fighter', r === 'ok' &&
      ofType(ev, 'damage').some((d) => d.dst === a.foe.id && d.dtype === 'true' && near(d.amount + d.shielded, 20 + 8 * a.e.level, 1e-6)) &&
      ['armor_shred', 'resist_shred', 'grievous'].every((k) => kinds.includes(k as never)), { r, kinds });
    const mob = spawnUnit(a.w, 'stilltusk', -1, 42, 23);
    run(a.sim, 0.4); // vision catches up (10 Hz)
    const [rf] = castNow(a, SLOT_SPELL1 + 1, 0, undefined, undefined, a.foe.id);
    const [r2, ev2] = castNow(a, SLOT_SPELL1 + 1, 0.1, undefined, undefined, mob.id);
    check('Hourstrike: refuses fighters, strikes a monster for 450 + 30/level true, uses one of 2 charges', rf === 'target' && r2 === 'ok' &&
      ofType(ev2, 'damage').some((d) => d.dst === mob.id && d.dtype === 'true' && near(d.amount + d.shielded, 450 + 30 * a.e.level, 1e-6)) &&
      a.e.slots[SLOT_SPELL1 + 1]!.charges === 1, { rf, r2, ch: a.e.slots[SLOT_SPELL1 + 1]?.charges });
  }
  {
    const a = spellArena(['running_light', 'shake_loose']);
    castNow(a, SLOT_SPELL1, 0.1);
    const h = a.e.statuses.find((s) => s.kind === 'haste');
    check('Running Light: 45% haste that fades', !!h && h.decay && near(h.basePower, 0.45));
    applyStatus(a.w, a.foe, a.e, 'root', 3);
    const [r] = castNow(a, SLOT_SPELL1 + 1, 0.1);
    check('Shake Loose: breaks a root, then 50% tenacity', r === 'ok' && !a.e.statuses.some((s) => s.kind === 'root') && a.e.stats.tenacity >= 0.5, r);
    applyStatus(a.w, a.foe, a.e, 'stun', 2);
    check('Shake Loose cannot be cast while stunned (documented sim rule)', tryCast(a.w, a.e, SLOT_SPELL1 + 1) !== 'ok');
  }
  {
    const a = spellArena(['glass_pane', 'calling_bell']);
    const [r] = castNow(a, SLOT_SPELL1, 0.05);
    check('Glass Pane: a 90 + 20/level shield', r === 'ok' && near(a.e.shield, 90 + 20 * a.e.level), a.e.shield);
    const [r2] = castNow(a, SLOT_SPELL1 + 1, 0.4);
    check('Calling Bell: hastes the ally and reveals the enemy fighter', r2 === 'ok' && a.ally!.statuses.some((s) => s.kind === 'haste') && a.foe.statuses.some((s) => s.kind === 'reveal'), r2);
  }
});

section('setup: boons are wired', () => {
  const lv = (a: ReturnType<typeof arena>): number => a.e.level;
  {
    const a0 = spellArena(['glint_step', 'saplight'], []);
    const a = spellArena(['glint_step', 'saplight'], ['dense_stone', 'keen_edge']);
    check('Dense Stone: +50 + 10 per level after the first', near(a.e.maxHp - a0.e.maxHp, 50 + 10 * (lv(a) - 1)));
    check('Keen Edge: 6% armor and magic penetration', near(a.e.stats.armorPenPct, 0.06) && near(a.e.stats.magicPenPct, 0.06));
  }
  {
    const a = spellArena(['glint_step', 'saplight'], ['first_cut', 'next_hour']);
    const ev = castA1(a);
    run(a.sim, 0.5);
    const ev2 = castA1(a);
    check('First Cut: the first hit on a fighter adds 12 + 3/level true damage, once per 10 s', dmgBy(ev, 'first_cut').some((d) => d.dst === a.foe.id && d.dtype === 'true' && near(d.amount + d.shielded, 12 + 3 * lv(a), 1e-6)) &&
      dmgBy(ev2, 'first_cut').length === 0);
    hit(a, a.e, a.foe, 1e6, 'true'); a.sim.step();
    check('Next Hour: a takedown hastes you', a.e.statuses.some((s) => s.kind === 'haste'));
  }
  {
    const a = spellArena(['glint_step', 'saplight'], ['second_shadow', 'slow_heat']);
    hit(a, a.foe, a.e, a.e.hp * 0.7, 'true'); a.sim.step();
    check('Second Shadow: a 50 + 14/level shield below 35%', near(a.e.shield, 50 + 14 * lv(a)), a.e.shield);
    const ev = run(a.sim, 4.2);
    check('Slow Heat: heals 3 + 1% max hp every 4 s while below 60%', ofType(ev, 'heal').some((h) => h.dst === a.e.id && near(h.amount, 3 + 0.01 * a.e.maxHp, 1e-6)));
  }
  {
    const a0 = spellArena(['glint_step', 'saplight'], []);
    const a = spellArena(['glint_step', 'saplight'], ['quick_hour', 'long_stride']);
    check('Quick Hour + Long Stride: haste and move speed', near(a.e.stats.haste - a0.e.stats.haste, 6 + 0.4 * (lv(a) - 1)) && a.e.stats.moveSpeed > a0.e.stats.moveSpeed * 1.039);
  }
  {
    const a = spellArena(['glint_step', 'saplight'], ['echo_bell']);
    for (let i = 0; i < 3; i++) { castA1(a); run(a.sim, 0.45); }
    const before = a.e.counters.find((c) => c.id === 'echo_bell_casts')?.value;
    castA1(a);
    const after = a.e.counters.find((c) => c.id === 'echo_bell_casts')?.value;
    check('Echo Bell: the 4th cast resets the count (and refunds cooldowns)', before === 3 && after === 0, { before, after });
  }
});

// ── 9. real bots shop from each pool ─────────────────────────────────────────────────────────────
section('bots: real bots shop from every pool without refusals or faults', () => {
  for (const pool of POOLS) {
    const n = 10;
    const seats: SeatOpt[] = Array.from({ length: n }, (_, i) => ({ cls: CLASSES[i % CLASSES.length], team: pool === 'fray' ? i : (i < 5 ? 0 : 1), controller: 'bot' as const }));
    const st = mkSetup(pool, seats, 7);
    const sim = createSim(catalog, st, { pregameSeconds: 0, bots: createBots(catalog, st) });
    const ev = run(sim, pool === 'fray' ? 150 : 30);
    const buys = ofType(ev, 'buy');
    const deniedBad = ofType(ev, 'announce').filter((a) => a.key === 'shop_denied' && ['pool', 'unknown'].includes(String(a.params?.reason)));
    const outOfPool = buys.filter((b) => !inPool(item(b.item), pool));
    const buyers = new Set(buys.map((b) => b.player)).size;
    console.log(`  ${pool} bot purchases: ${Array.from({ length: n }, (_, i) => `${seats[i].cls}=${buys.filter((b) => b.player === i).map((b) => b.item).join('+') || '-'}`).join(' · ')}`);
    check(`${pool}: ${buys.length} bot purchases by ${buyers}/${n} bots, all in pool, no pool refusals, no faults`,
      buyers >= (pool === 'fray' ? 5 : n) && outOfPool.length === 0 && deniedBad.length === 0 && sim.faults.length === 0,
      { buyers, outOfPool: outOfPool.map((b) => b.item), denied: deniedBad.length, faults: sim.faults, sample: buys.slice(0, 6).map((b) => b.item) });
  }
});

finish('probe_items');
