// GENESIS — content → visuals resolver for the life layer (CONTRACT.md §9, §15.6). Three-free, so the lookdev
// fabricator (src/client) and the renderer share it.
//
// Snapshots carry CONTENT INDICES (BuildingBlock.type / material, MoverBlock.species, carry item ids, ...). The renderer
// needs visual archetypes: "a round thatched hut", "a quadruped with antlers", "an axe in the right hand". Content is
// data the SIM lane authors (src/data/buildings.json, materials.json, species, animals.json, items.json) and mods
// extend at runtime, so nothing here may depend on a file existing: every registry is read from the base pack when it
// is present (by id / function / tags / body plan, never by position) and falls back to the built-in defaults below
// (which are also what the lookdev fabricator emits when the base pack has no such registry).
//
// Resolution is cached per registry identity, so a mod pack replacing a registry is picked up on the next lookup.

import { BASE_PACK } from '../../data/index.ts';

// ───────────────────────────── generic registry access ─────────────────────────────

type Def = Record<string, unknown>;

/** a registry of the base pack by name (undefined when the SIM lane has not authored it) */
export function packList(name: string): Def[] | undefined {
  const v = (BASE_PACK as unknown as Record<string, unknown>)[name];
  return Array.isArray(v) && v.length ? (v as Def[]) : undefined;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.toLowerCase() : '');
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' ? [v.toLowerCase()] : []);

const srgbToLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
/** '#rrggbb' → linear RGB, or the fallback */
export function hexLinear(h: unknown, fallback: [number, number, number]): [number, number, number] {
  if (typeof h !== 'string' || !/^#[0-9a-f]{6}$/i.test(h)) return fallback;
  const n = parseInt(h.slice(1), 16);
  return [srgbToLin(((n >> 16) & 255) / 255), srgbToLin(((n >> 8) & 255) / 255), srgbToLin((n & 255) / 255)];
}
/** packed 0xRRGGBB (sRGB) → linear RGB */
export function packedLinear(n: number): [number, number, number] {
  return [srgbToLin(((n >> 16) & 255) / 255), srgbToLin(((n >> 8) & 255) / 255), srgbToLin((n & 255) / 255)];
}

// ───────────────────────────── eras ─────────────────────────────

export const ERAS = ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'] as const;
export type Era = (typeof ERAS)[number];
/** era label → 0..10 (unknown labels map by keyword, else 0) */
export function eraIndex(label: string | undefined | null): number {
  const s = (label ?? '').toLowerCase();
  const i = (ERAS as readonly string[]).indexOf(s);
  if (i >= 0) return i;
  if (/space|orbit|rocket|atomic/.test(s)) return 10;
  if (/electr|radio|modern/.test(s)) return 9;
  if (/steam|industr/.test(s)) return 8;
  if (/gun|renaiss/.test(s)) return 7;
  if (/mediev|feudal/.test(s)) return 6;
  if (/classic|antiq/.test(s)) return 5;
  if (/iron/.test(s)) return 4;
  if (/bronze|copper/.test(s)) return 3;
  if (/clay|potter|neolith/.test(s)) return 2;
  if (/fire/.test(s)) return 1;
  return 0;
}
/** clothing tier by era: 0 hides and furs, 1 woven undyed, 2 dyed with trim, 3 tailored (industrial) */
export function clothTier(era: number): number { return era <= 1 ? 0 : era <= 3 ? 1 : era <= 7 ? 2 : 3; }
/** night light kind by era (BuildingBlock.light kinds): 1 hearth, 2 oil, 3 gas, 4 electric */
export function lightKindForEra(era: number): number { return era <= 4 ? 1 : era <= 7 ? 2 : era === 8 ? 3 : 4; }
/** road surface tier by era: 0 trail, 1 dirt, 2 cobble, 3 paved */
export function paveTier(era: number): number { return era <= 1 ? 0 : era <= 4 ? 1 : era <= 7 ? 2 : 3; }

// ───────────────────────────── materials ─────────────────────────────

/** surface codes understood by the building shader (render/life/buildingmat.ts) */
export const SURF = {
  plaster: 0, ashlar: 1, rubble: 2, brick: 3, mudbrick: 4, planks: 5, logs: 6, daub: 7, thatch: 8, tiles: 9, slate: 10,
  hide: 11, cloth: 12, metal: 13, concrete: 14, glass: 15, beam: 16, earth: 17, chitin: 18, ice: 19, ember: 20, bark: 21,
  shingle: 22, rope: 23, iron: 24,
} as const;

export interface MaterialLook {
  id: string;
  /** wall surface code and base albedo (linear) */
  wall: number;
  wallCol: [number, number, number];
  /** preferred roof: 'thatch' | 'tile' | 'slate' | 'flat' | 'hide' | 'shingle' | 'metal' | 'dome' */
  roof: string;
  /** structural tier: 0 flimsy (hide, thatch) .. 4 industrial (concrete, steel) */
  tier: number;
}

const DEFAULT_MATERIALS: MaterialLook[] = [
  { id: 'thatch', wall: SURF.daub, wallCol: [0.32, 0.25, 0.17], roof: 'thatch', tier: 0 },
  { id: 'hide', wall: SURF.hide, wallCol: [0.3, 0.2, 0.12], roof: 'hide', tier: 0 },
  { id: 'wood', wall: SURF.planks, wallCol: [0.24, 0.16, 0.1], roof: 'thatch', tier: 1 },
  { id: 'wattle', wall: SURF.daub, wallCol: [0.42, 0.34, 0.24], roof: 'thatch', tier: 1 },
  { id: 'mudbrick', wall: SURF.mudbrick, wallCol: [0.48, 0.33, 0.2], roof: 'flat', tier: 1 },
  { id: 'stone', wall: SURF.rubble, wallCol: [0.36, 0.34, 0.31], roof: 'slate', tier: 2 },
  { id: 'brick', wall: SURF.brick, wallCol: [0.4, 0.15, 0.08], roof: 'tile', tier: 3 },
  { id: 'timber', wall: SURF.logs, wallCol: [0.26, 0.17, 0.1], roof: 'shingle', tier: 2 },
  { id: 'concrete', wall: SURF.concrete, wallCol: [0.45, 0.44, 0.41], roof: 'flat', tier: 4 },
  { id: 'steel', wall: SURF.metal, wallCol: [0.3, 0.31, 0.32], roof: 'metal', tier: 4 },
  { id: 'glass', wall: SURF.glass, wallCol: [0.12, 0.16, 0.18], roof: 'flat', tier: 4 },
  { id: 'ice', wall: SURF.ice, wallCol: [0.62, 0.74, 0.82], roof: 'dome', tier: 1 },
  { id: 'chitin', wall: SURF.chitin, wallCol: [0.3, 0.22, 0.12], roof: 'dome', tier: 1 },
  { id: 'resin', wall: SURF.chitin, wallCol: [0.42, 0.28, 0.08], roof: 'dome', tier: 1 },
  { id: 'ashlar', wall: SURF.ashlar, wallCol: [0.5, 0.46, 0.39], roof: 'tile', tier: 3 },
];
const DEFAULT_MAT_BY_ID = new Map(DEFAULT_MATERIALS.map((m) => [m.id, m]));

function materialFromDef(d: Def): MaterialLook {
  const id = str(d.id);
  const base = DEFAULT_MAT_BY_ID.get(id)
    ?? (/stone|rock|granite|marble/.test(id) ? DEFAULT_MAT_BY_ID.get('stone')!
      : /brick|terracotta/.test(id) ? DEFAULT_MAT_BY_ID.get('brick')!
        : /mud|adobe|clay|earth/.test(id) ? DEFAULT_MAT_BY_ID.get('mudbrick')!
          : /log|timber|plank|wood|bamboo/.test(id) ? DEFAULT_MAT_BY_ID.get('timber')!
            : /concrete|cement/.test(id) ? DEFAULT_MAT_BY_ID.get('concrete')!
              : /steel|iron|metal|alum/.test(id) ? DEFAULT_MAT_BY_ID.get('steel')!
                : /reed|straw|grass|thatch/.test(id) ? DEFAULT_MAT_BY_ID.get('thatch')!
                  : /skin|hide|leather|fur/.test(id) ? DEFAULT_MAT_BY_ID.get('hide')!
                    : DEFAULT_MAT_BY_ID.get('wood')!);
  const colors = (d.colors ?? d.color) as unknown;
  const c = typeof colors === 'string' ? colors : (colors && typeof colors === 'object' ? (colors as Def).wall ?? (colors as Def).base : undefined);
  return { ...base, id: id || base.id, wallCol: hexLinear(c, base.wallCol) };
}

let matCacheKey: unknown = null;
let matCache: MaterialLook[] = DEFAULT_MATERIALS;
/** the material registry (content order) */
export function materials(): MaterialLook[] {
  const l = packList('materials');
  if (l !== matCacheKey) { matCacheKey = l; matCache = l ? l.map(materialFromDef) : DEFAULT_MATERIALS; }
  return matCache;
}
export function materialAt(i: number): MaterialLook {
  const m = materials();
  return m[i] ?? m[0] ?? DEFAULT_MATERIALS[0];
}
export function materialIndex(id: string): number {
  const m = materials();
  const i = m.findIndex((x) => x.id === id);
  return i >= 0 ? i : 0;
}

// ───────────────────────────── buildings ─────────────────────────────

/** visual archetypes the generator knows (render/gen/buildinggen.ts) */
export const BUILDING_KINDS = [
  'lean-to', 'tent', 'hut', 'wattle', 'mudbrick', 'stone-house', 'timber', 'brick-house', 'half-timber', 'block',
  'hearth', 'kiln', 'furnace', 'forge', 'granary', 'workshop', 'temple', 'library', 'market', 'mill', 'aqueduct', 'wall',
  'gate', 'tower', 'dock', 'shipyard', 'lighthouse', 'observatory', 'factory', 'radio', 'launchpad', 'pen', 'well',
  'hive-mound', 'longhouse', 'barn', 'tenement',
] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export interface BuildingLook {
  id: string;
  kind: BuildingKind;
  /** footprint (m) before BuildingBlock.scale: width (x), depth (z) */
  w: number;
  d: number;
  /** default material index order preference (content material ids) */
  materials: string[];
  /** a building whose look follows its material (shelters): the archetype is re-chosen from the material */
  byMaterial: boolean;
  /** has a fire (hearth light, chimney smoke, emissive mouth) */
  fire: number;
}

const B = (id: string, kind: BuildingKind, w: number, d: number, materials: string[], byMaterial = false, fire = 0): BuildingLook =>
  ({ id, kind, w, d, materials, byMaterial, fire });

/** built-in building registry: also the index space the lookdev fabricator uses when the base pack has none */
const DEFAULT_BUILDINGS: BuildingLook[] = [
  B('lean-to', 'lean-to', 3.2, 2.4, ['wood']),
  B('hide-tent', 'tent', 4.2, 4.2, ['hide']),
  B('hut', 'hut', 5.2, 5.2, ['thatch', 'wattle'], true),
  B('house', 'wattle', 6.5, 5, ['wattle', 'mudbrick', 'stone', 'timber', 'brick', 'concrete'], true),
  B('longhouse', 'longhouse', 12, 6, ['timber', 'wood']),
  B('hearth', 'hearth', 3, 3, ['stone'], false, 1),
  B('kiln', 'kiln', 3.4, 3.4, ['mudbrick', 'brick'], false, 1),
  B('furnace', 'furnace', 4, 4, ['stone', 'brick'], false, 1),
  B('forge', 'forge', 7, 6, ['stone', 'timber', 'brick'], false, 1),
  B('granary', 'granary', 5, 5, ['wattle', 'mudbrick', 'stone', 'timber']),
  B('workshop', 'workshop', 8, 6, ['timber', 'stone', 'brick']),
  B('temple', 'temple', 14, 20, ['stone', 'mudbrick', 'brick', 'ashlar']),
  B('library', 'library', 12, 9, ['stone', 'brick', 'ashlar']),
  B('market', 'market', 16, 12, ['wood', 'timber', 'stone']),
  B('mill', 'mill', 6, 6, ['timber', 'stone']),
  B('aqueduct', 'aqueduct', 4, 24, ['stone', 'ashlar']),
  B('wall', 'wall', 2.4, 16, ['wood', 'stone', 'brick']),
  B('gate', 'gate', 10, 6, ['wood', 'stone', 'brick']),
  B('tower', 'tower', 6, 6, ['wood', 'stone', 'brick']),
  B('dock', 'dock', 6, 22, ['wood', 'timber', 'stone']),
  B('shipyard', 'shipyard', 14, 26, ['timber', 'wood']),
  B('lighthouse', 'lighthouse', 7, 7, ['stone', 'brick']),
  B('observatory', 'observatory', 11, 11, ['stone', 'ashlar', 'brick']),
  B('factory', 'factory', 22, 16, ['brick', 'concrete', 'steel'], false, 1),
  B('radio-mast', 'radio', 8, 8, ['steel']),
  B('launchpad', 'launchpad', 30, 30, ['concrete', 'steel']),
  B('pen', 'pen', 14, 12, ['wood']),
  B('well', 'well', 2.4, 2.4, ['stone']),
  B('hive-mound', 'hive-mound', 9, 9, ['chitin', 'resin', 'mudbrick']),
  B('barn', 'barn', 9, 12, ['timber', 'wood', 'stone']),
  B('tenement', 'tenement', 10, 9, ['brick', 'concrete']),
];

function kindFromDef(d: Def): BuildingKind {
  const id = str(d.id), fn = str(d.function), name = str(d.name);
  const all = `${id} ${name}`;
  const direct = (BUILDING_KINDS as readonly string[]).find((k) => id === k);
  if (direct) return direct as BuildingKind;
  if (/lean/.test(all)) return 'lean-to';
  if (/tent|yurt|tipi|teepee/.test(all)) return 'tent';
  if (/longhouse|hall/.test(all)) return 'longhouse';
  if (/hive|mound|nest/.test(all)) return 'hive-mound';
  if (/tenement|apartment/.test(all)) return 'tenement';
  if (/barn|stable/.test(all)) return 'barn';
  if (/well|cistern/.test(all)) return 'well';
  if (/lighthouse/.test(all)) return 'lighthouse';
  if (/gate/.test(all)) return 'gate';
  if (/hut/.test(all)) return 'hut';
  switch (fn) {
    case 'shelter': case 'house': case 'home': return 'wattle';
    case 'store': case 'granary': return 'granary';
    case 'hearth': case 'fire': return 'hearth';
    case 'kiln': return 'kiln';
    case 'furnace': case 'smelter': return 'furnace';
    case 'forge': case 'smithy': return 'forge';
    case 'workshop': case 'craft': return 'workshop';
    case 'temple': case 'shrine': return 'temple';
    case 'library': case 'school': return 'library';
    case 'market': return 'market';
    case 'mill': return 'mill';
    case 'aqueduct': return 'aqueduct';
    case 'wall': return 'wall';
    case 'tower': return 'tower';
    case 'dock': case 'port': case 'harbour': case 'harbor': return 'dock';
    case 'shipyard': return 'shipyard';
    case 'observatory': return 'observatory';
    case 'factory': case 'industry': return 'factory';
    case 'radio': return 'radio';
    case 'launchpad': return 'launchpad';
    case 'pen': case 'pasture': return 'pen';
    case 'farm': return 'barn';
    case 'lighthouse': return 'lighthouse';
    case 'gate': return 'gate';
  }
  return 'wattle';
}

function buildingFromDef(d: Def): BuildingLook {
  const kind = kindFromDef(d);
  const dflt = DEFAULT_BUILDINGS.find((b) => b.kind === kind) ?? DEFAULT_BUILDINGS[3];
  const fp = d.footprint;
  let w = dflt.w, dd = dflt.d;
  if (Array.isArray(fp) && fp.length >= 2) { w = num(fp[0], w); dd = num(fp[1], dd); }
  else if (typeof fp === 'number') {
    // a footprint given in cells / tiles / metres: anything under 4 is a cell count (≈ 4 m per unit), else metres
    const m = fp < 4 ? fp * 4.5 : fp;
    const k = m / Math.max(dflt.w, dflt.d);
    w = dflt.w * k; dd = dflt.d * k;
  }
  const fn = str(d.function);
  const mats = strs(d.materials);
  return {
    id: str(d.id) || dflt.id, kind, w: Math.max(1.5, Math.min(60, w)), d: Math.max(1.5, Math.min(60, dd)),
    materials: mats.length ? mats : dflt.materials,
    byMaterial: fn === 'shelter' || fn === 'house' || fn === 'home' || dflt.byMaterial,
    fire: /hearth|kiln|furnace|forge|factory|smelter/.test(`${fn} ${kind}`) ? 1 : 0,
  };
}

let bCacheKey: unknown = null;
let bCache: BuildingLook[] = DEFAULT_BUILDINGS;
export function buildingDefs(): BuildingLook[] {
  const l = packList('buildings');
  if (l !== bCacheKey) { bCacheKey = l; bCache = l ? l.map(buildingFromDef) : DEFAULT_BUILDINGS; }
  return bCache;
}
export function buildingAt(i: number): BuildingLook {
  const b = buildingDefs();
  return b[i] ?? DEFAULT_BUILDINGS[3];
}
/** index of a building by id or archetype kind (lookdev); -1 if the registry has nothing like it */
export function buildingIndex(idOrKind: string): number {
  const b = buildingDefs();
  let i = b.findIndex((x) => x.id === idOrKind);
  if (i < 0) i = b.findIndex((x) => x.kind === idOrKind);
  return i;
}

/**
 * The archetype a building is drawn as: shelters follow the material the builders had (a hut of thatch, a house of
 * mudbrick, of stone, of brick...), and the settlement's era refines it (brick → half-timbered in medieval styles,
 * tenements in industrial cities).
 */
export function shelterKind(look: BuildingLook, mat: MaterialLook, era: number, style: number): BuildingKind {
  if (!look.byMaterial) return look.kind;
  switch (mat.id) {
    case 'hide': return 'tent';
    case 'thatch': case 'reed': case 'grass': return 'hut';
    case 'wood': return era <= 1 ? 'lean-to' : 'hut';
    case 'wattle': return era <= 2 ? 'hut' : 'wattle';
    case 'mudbrick': return 'mudbrick';
    case 'stone': case 'ashlar': return 'stone-house';
    case 'timber': return style % 3 === 2 ? 'longhouse' : 'timber';
    case 'brick': return era >= 8 && style % 2 === 0 ? 'tenement' : era >= 5 && era <= 7 && style % 2 === 1 ? 'half-timber' : 'brick-house';
    case 'concrete': case 'steel': return 'block';
    case 'ice': case 'chitin': case 'resin': return 'hive-mound';
  }
  return mat.tier <= 0 ? 'hut' : mat.tier === 1 ? 'mudbrick' : mat.tier === 2 ? 'stone-house' : mat.tier === 3 ? 'brick-house' : 'block';
}

// ───────────────────────────── species (peoples) ─────────────────────────────

export type BodyPlan = 'biped' | 'quadruped' | 'hexapod' | 'aquatic' | 'flyer' | 'serpent' | 'blob' | 'bird' | 'fish' | 'insect';

export interface SpeciesLook {
  id: string;
  plan: BodyPlan;
  /** standing height (m) of an adult */
  height: number;
  skin: [number, number, number];
  hair: [number, number, number];
  /** fur coat (cold folk): the body is drawn furred, clothing over it */
  furred: boolean;
  /** amphibious (coastal folk): webbed, sleek, fins */
  webbed: boolean;
  /** buoyant drifters: float at an altitude */
  floats: boolean;
}

const DEFAULT_SPECIES: SpeciesLook[] = [
  { id: 'plains-folk', plan: 'biped', height: 1.72, skin: [0.36, 0.2, 0.12], hair: [0.05, 0.035, 0.025], furred: false, webbed: false, floats: false },
  { id: 'coastal-folk', plan: 'biped', height: 1.66, skin: [0.17, 0.26, 0.24], hair: [0.03, 0.06, 0.07], furred: false, webbed: true, floats: false },
  { id: 'hive', plan: 'hexapod', height: 1.25, skin: [0.22, 0.13, 0.05], hair: [0.05, 0.03, 0.02], furred: false, webbed: false, floats: false },
  { id: 'cold-folk', plan: 'biped', height: 1.85, skin: [0.55, 0.5, 0.46], hair: [0.62, 0.6, 0.57], furred: true, webbed: false, floats: false },
  { id: 'methane-drifters', plan: 'flyer', height: 2.2, skin: [0.45, 0.3, 0.55], hair: [0.7, 0.5, 0.8], furred: false, webbed: false, floats: true },
];

function planOf(v: unknown, id: string): BodyPlan {
  const s = str(v) || id;
  if (/hexa|hive|insect|ant/.test(s)) return 'hexapod';
  if (/quad/.test(s)) return 'quadruped';
  if (/aqua|fish|swim/.test(s)) return 'aquatic';
  if (/fly|drift|float|bird|wing/.test(s)) return 'flyer';
  if (/serp|snake|worm/.test(s)) return 'serpent';
  if (/blob|slime/.test(s)) return 'blob';
  return 'biped';
}

function speciesFromDef(d: Def): SpeciesLook {
  const id = str(d.id);
  const dflt = DEFAULT_SPECIES.find((s) => s.id === id)
    ?? (/coast|sea|amphib/.test(id) ? DEFAULT_SPECIES[1] : /hive|insect/.test(id) ? DEFAULT_SPECIES[2] : /cold|ice|frost|snow/.test(id) ? DEFAULT_SPECIES[3] : /methane|drift/.test(id) ? DEFAULT_SPECIES[4] : DEFAULT_SPECIES[0]);
  const body = (d.body ?? d.bodyPlan ?? d.plan) as unknown;
  const plan = planOf(typeof body === 'object' && body ? (body as Def).plan ?? (body as Def).kind : body, dflt.plan);
  const size = d.size;
  const height = typeof size === 'number' ? (size < 3 ? size * (size < 1.2 ? 1.72 : 1) : 1.72) : dflt.height;
  const colors = (d.colors ?? {}) as Def;
  return {
    id: id || dflt.id, plan, height: Math.max(0.4, Math.min(4, height)),
    skin: hexLinear(colors.skin ?? colors.body ?? colors.carapace, dflt.skin),
    hair: hexLinear(colors.hair ?? colors.fur ?? colors.accent, dflt.hair),
    furred: !!(d.furred ?? (/fur/.test(JSON.stringify(d.traits ?? '')) || dflt.furred)),
    webbed: dflt.webbed || /coast|amphib/.test(str(d.habitat)),
    floats: dflt.floats || str(d.breathes) === 'methane' && plan === 'flyer',
  };
}

let sCacheKey: unknown = null;
let sCache: SpeciesLook[] = DEFAULT_SPECIES;
export function speciesDefs(): SpeciesLook[] {
  const l = packList('species');
  if (l !== sCacheKey) { sCacheKey = l; sCache = l ? l.map(speciesFromDef) : DEFAULT_SPECIES; }
  return sCache;
}
export function speciesAt(i: number): SpeciesLook {
  const s = speciesDefs();
  return s[i] ?? s[0] ?? DEFAULT_SPECIES[0];
}
export function speciesIndex(id: string): number {
  const i = speciesDefs().findIndex((s) => s.id === id);
  return i >= 0 ? i : 0;
}

// ───────────────────────────── animals ─────────────────────────────

/** quadruped / bird / fish / insect body variants the generator knows (render/gen/bodygen.ts) */
export const ANIMAL_FORMS = ['deer', 'boar', 'wolf', 'bear', 'bison', 'goat', 'sheep', 'horse', 'cattle', 'bird', 'gull', 'fish', 'locust', 'hare'] as const;
export type AnimalForm = (typeof ANIMAL_FORMS)[number];

export interface AnimalLook {
  id: string;
  form: AnimalForm;
  /** shoulder height (quadrupeds) or length (fish / birds), m */
  size: number;
  coat: [number, number, number];
  belly: [number, number, number];
}

const DEFAULT_ANIMALS: AnimalLook[] = [
  { id: 'deer', form: 'deer', size: 1.15, coat: [0.24, 0.12, 0.05], belly: [0.55, 0.45, 0.35] },
  { id: 'boar', form: 'boar', size: 0.85, coat: [0.08, 0.06, 0.05], belly: [0.12, 0.09, 0.07] },
  { id: 'wolf', form: 'wolf', size: 0.8, coat: [0.2, 0.19, 0.17], belly: [0.5, 0.48, 0.44] },
  { id: 'bear', form: 'bear', size: 1.2, coat: [0.1, 0.06, 0.035], belly: [0.12, 0.075, 0.045] },
  { id: 'bison', form: 'bison', size: 1.75, coat: [0.09, 0.055, 0.03], belly: [0.16, 0.1, 0.06] },
  { id: 'goat', form: 'goat', size: 0.75, coat: [0.5, 0.45, 0.38], belly: [0.65, 0.62, 0.56] },
  { id: 'sheep', form: 'sheep', size: 0.8, coat: [0.62, 0.58, 0.5], belly: [0.55, 0.5, 0.42] },
  { id: 'horse', form: 'horse', size: 1.55, coat: [0.2, 0.09, 0.035], belly: [0.22, 0.1, 0.04] },
  { id: 'cattle', form: 'cattle', size: 1.4, coat: [0.32, 0.18, 0.08], belly: [0.6, 0.55, 0.48] },
  { id: 'songbird', form: 'bird', size: 0.25, coat: [0.12, 0.09, 0.06], belly: [0.45, 0.35, 0.25] },
  { id: 'gull', form: 'gull', size: 0.45, coat: [0.7, 0.72, 0.74], belly: [0.8, 0.82, 0.84] },
  { id: 'fish', form: 'fish', size: 0.45, coat: [0.12, 0.16, 0.18], belly: [0.6, 0.62, 0.6] },
  { id: 'locust', form: 'locust', size: 0.07, coat: [0.3, 0.25, 0.08], belly: [0.4, 0.33, 0.12] },
  { id: 'hare', form: 'hare', size: 0.3, coat: [0.3, 0.22, 0.14], belly: [0.6, 0.55, 0.48] },
];

function animalFromDef(d: Def): AnimalLook {
  const id = str(d.id);
  const all = `${id} ${str(d.name)} ${str(d.kind)} ${str(d.body)} ${str(d.form)} ${strs(d.tags).join(' ')}`;
  const form: AnimalForm = (ANIMAL_FORMS as readonly string[]).includes(id) ? id as AnimalForm
    : /locust|insect|swarm|bee/.test(all) ? 'locust'
      : /fish|salmon|cod|tuna|shoal/.test(all) ? 'fish'
        : /gull|albatross|sea.?bird/.test(all) ? 'gull'
          : /bird|crow|sparrow|pigeon|duck|goose|hawk|eagle/.test(all) ? 'bird'
            : /bison|buffalo|aurochs|yak/.test(all) ? 'bison'
              : /cow|cattle|ox/.test(all) ? 'cattle'
                : /horse|zebra|pony|camel/.test(all) ? 'horse'
                  : /sheep|ram/.test(all) ? 'sheep'
                    : /goat|ibex/.test(all) ? 'goat'
                      : /bear/.test(all) ? 'bear'
                        : /wolf|dog|fox|jackal|cat|lion|tiger|predator/.test(all) ? 'wolf'
                          : /boar|pig|hog/.test(all) ? 'boar'
                            : /hare|rabbit/.test(all) ? 'hare'
                              : 'deer';
  const dflt = DEFAULT_ANIMALS.find((a) => a.form === form) ?? DEFAULT_ANIMALS[0];
  const colors = (d.colors ?? {}) as Def;
  return {
    id: id || dflt.id, form, size: Math.max(0.03, Math.min(6, num(d.size, dflt.size))),
    coat: hexLinear(colors.coat ?? colors.fur ?? colors.body ?? d.color, dflt.coat),
    belly: hexLinear(colors.belly ?? colors.under, dflt.belly),
  };
}

let aCacheKey: unknown = null;
let aCache: AnimalLook[] = DEFAULT_ANIMALS;
export function animalDefs(): AnimalLook[] {
  const l = packList('animals');
  if (l !== aCacheKey) { aCacheKey = l; aCache = l ? l.map(animalFromDef) : DEFAULT_ANIMALS; }
  return aCache;
}
export function animalAt(i: number): AnimalLook {
  const a = animalDefs();
  return a[i] ?? a[0] ?? DEFAULT_ANIMALS[0];
}
export function animalIndex(idOrForm: string): number {
  const a = animalDefs();
  let i = a.findIndex((x) => x.id === idOrForm);
  if (i < 0) i = a.findIndex((x) => x.form === idOrForm);
  return i >= 0 ? i : 0;
}

// ───────────────────────────── items carried / tools held ─────────────────────────────

/** held-item meshes (render/gen/bodygen.ts): 0 none */
export const HELD = {
  none: 0, axe: 1, hoe: 2, spear: 3, hammer: 4, basket: 5, logs: 6, pot: 7, torch: 8, staff: 9, rod: 10, sword: 11,
  bundle: 12, stone: 13, scroll: 14, sickle: 15, pick: 16, rifle: 17, child: 18,
} as const;

const DEFAULT_ITEMS = ['stone', 'wood', 'berries', 'meat', 'fish', 'grain', 'clay', 'pot', 'water', 'hide', 'flint', 'tool', 'ore', 'bread', 'cloth', 'book'];

let iCacheKey: unknown = null;
let iCache: number[] = [];
function itemHeldTable(): number[] {
  const l = packList('items');
  if (l !== iCacheKey || !iCache.length) {
    iCacheKey = l;
    const ids = l ? l.map((d) => `${str(d.id)} ${strs(d.tags).join(' ')}`) : DEFAULT_ITEMS;
    iCache = ids.map((s) =>
      /axe/.test(s) ? HELD.axe : /hoe|plough|plow|shovel|spade/.test(s) ? HELD.hoe : /spear|lance/.test(s) ? HELD.spear
        : /hammer|mallet/.test(s) ? HELD.hammer : /sword|blade|dagger/.test(s) ? HELD.sword : /rifle|musket|gun/.test(s) ? HELD.rifle
          : /pick/.test(s) ? HELD.pick : /sickle|scythe/.test(s) ? HELD.sickle : /torch|fire/.test(s) ? HELD.torch
            : /book|scroll|tablet|paper/.test(s) ? HELD.scroll : /rod|net/.test(s) ? HELD.rod
              : /wood|log|stick|timber|branch/.test(s) ? HELD.logs : /stone|flint|ore|rock|brick/.test(s) ? HELD.stone
                : /pot|jar|water|beer|wine|oil/.test(s) ? HELD.pot
                  : /hide|cloth|fiber|fibre|rope|wool|bundle/.test(s) ? HELD.bundle
                    : HELD.basket);
  }
  return iCache;
}

/** the held mesh for a carried item id (-1 none) */
export function heldForItem(item: number): number {
  if (item < 0) return HELD.none;
  const t = itemHeldTable();
  return t[item] ?? HELD.basket;
}

/** index of an item by id in the item registry (lookdev); -1 when missing */
export function itemIndex(id: string): number {
  const l = packList('items');
  if (l) return l.findIndex((d) => str(d.id) === id);
  return DEFAULT_ITEMS.indexOf(id);
}
