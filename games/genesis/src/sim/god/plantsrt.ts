// GENESIS — LIVING CONTENT (LIVING.md §4.3): plants the god invents.
//
//   content.plant { name, type: 'tree' | 'shrub' | 'grass' | 'crop', like?, yields?: { item?, food?, tags? }, pos?, settlement? }
//       A new plant in the runtime pack (god/runtime.ts): its tolerances copied from `like` (or the plant of its kind
//       that best suits the place it is grown, else the commonest of its kind), a colour of its own, and what it gives —
//       a new food (or fibre) item, gathered from the wild plant by every people that forages (it joins the foraging
//       lore) or harvested from fields of the crop (season and harvest as plants.json). The wild plant is grown where
//       the god points; a crop is sown by the settlement named (settlement.introduce crop).
//       Free text: "grow a new plant called silverleaf", "invent a new crop called sunroot" (god/freeform-content.ts).

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { ItemDef, PlantDef, PlantType, RecipeDef } from '../content.ts';
import { hash32 } from '../core/rng.ts';
import { bestSpecies, plantArea } from '../fields/vegetation.ts';
import { rebuildContent, slug, titleCase } from './runtime.ts';
import { fail, herePos, norm, ok, placeName } from './util.ts';

export interface PlantSpec {
  name: string;
  type: PlantType;
  like?: string;
  yields?: { item?: string; food?: number; tags?: string[] };
}

/** the plant a new one copies its tolerances from, by kind (when none is named and the place does not choose) */
const LIKE: Record<PlantType, string> = { tree: 'oak', shrub: 'berry-bush', grass: 'meadow-grass', crop: 'wheat' };

/** is this word a fibre plant's (flax, hemp, cotton, silk...) — the lexicon's fibre material words */
function fibreWord(u: Universe, name: string): boolean {
  const L = u.content.lexicon as Record<string, unknown>;
  const words = ((L.materialKinds as Record<string, string[]> | undefined)?.fibre ?? []).filter((w) => w !== 'silverleaf');
  const n = name.toLowerCase();
  return words.some((w) => n.includes(w)) || /\b(hemp|flax|reed|rush|nettle|fibre|fiber|thread|cotton)\b/.test(n);
}

/** a stable tint of a base colour by the plant's name */
function tint(hex: string, id: string): string {
  let h = 0x9a1;
  for (let i = 0; i < id.length; i++) h = hash32(h, id.charCodeAt(i));
  const v = parseInt(hex.slice(1), 16);
  const ch = (s: number, k: number) => Math.max(0, Math.min(255, ((v >> s) & 255) + (((h >> k) & 63) - 32))).toString(16).padStart(2, '0');
  return `#${ch(16, 0)}${ch(8, 6)}${ch(0, 12)}`;
}

/**
 * Make (or find) a plant: a runtime PlantDef with its own item; the wild ones join the foraging lore. `rebuild` false
 * leaves the content rebuild to the caller (god/materials.ts makes a plant and more in one go). Returns the plant id and
 * its item.
 */
export function makePlant(u: Universe, spec: PlantSpec, rebuild = true, near?: ArrayLike<number>, p?: import('../world/planet.ts').Planet): { id: string; item: string; made: boolean } {
  const name = String(spec.name).trim().slice(0, 40);
  const id = slug(name);
  const have = u.content.plants.find(id);
  if (have) return { id: have.id, item: have.fruit?.item ?? have.gather?.[0]?.item ?? have.harvest?.[0]?.item ?? '', made: false };
  const r = u.god.runtime;
  const type = spec.type;
  // what it is like: the named plant, else the plant of its kind that best suits the place it is grown
  let like = spec.like && u.content.plants.has(spec.like) ? u.content.plants.get(spec.like) : undefined;
  if (like && (like.type === 'crop') !== (type === 'crop')) like = undefined;
  if (!like && near && p && type !== 'crop') {
    const ti = ['grass', 'shrub', 'tree'].indexOf(type);
    const b = bestSpecies(p, u.content.plantTable, ti, p.cellAt(near));
    if (b.sp >= 0) like = u.content.plants.list[b.sp];
  }
  if (!like) like = u.content.plants.get(LIKE[type]);
  // what it gives: a new food, or a fibre for a fibre plant
  const fibre = spec.yields?.tags?.includes('fibre') || (!spec.yields?.food && fibreWord(u, name));
  const itemId = spec.yields?.item && u.content.items.has(spec.yields.item) ? spec.yields.item : spec.yields?.item ? slug(spec.yields.item) : type === 'tree' ? `${id}-fruit` : id === 'plant' ? `${id}-leaves` : id;
  if (!u.content.items.has(itemId)) {
    const tags = fibre ? ['raw', 'fibre', 'plant'] : ['food', 'plant', ...(type === 'crop' || type === 'grass' ? ['seed'] : []), ...(type === 'tree' ? ['fruit'] : [])];
    const item: ItemDef = {
      id: itemId, name: type === 'tree' && !spec.yields?.item ? `${titleCase(name)} fruit` : titleCase(spec.yields?.item ?? name), tags: [...new Set([...tags, ...(spec.yields?.tags ?? []), 'invented'])].sort(),
      weight: 0.5, value: 0.4,
      ...(fibre ? {} : { food: Math.max(0.05, Math.min(2, Number(spec.yields?.food ?? (type === 'crop' ? 0.3 : 0.25)))), decay: type === 'crop' ? 0.006 : 0.04 }),
    };
    const i = r.items.findIndex((x) => x.id === itemId);
    if (i >= 0) r.items[i] = item; else r.items.push(item);
  }
  const def: PlantDef = {
    ...(JSON.parse(JSON.stringify(like)) as PlantDef), id, name: titleCase(name), type,
    colors: { ...like.colors, leaf: tint(like.colors.leaf, id), ...(like.colors.flower ? { flower: tint(like.colors.flower, `${id}f`) } : {}) },
  };
  delete def.domesticatesTo; delete def.fruit; delete def.gather; delete def.harvest; delete def.understory; delete def.nitrogen;
  if (type === 'crop') {
    def.domestic = true;
    def.edible = !fibre;
    def.season = like.season ? { sow: [like.season.sow[0], like.season.sow[1]], grow: like.season.grow } : { sow: [0, 0.25], grow: 4 };
    def.harvest = [{ item: itemId, qty: fibre ? 25 : 40 }];
  } else {
    delete def.domestic;
    if (type === 'tree') def.fruit = { item: itemId, qty: 1, season: [0.3, 0.5] };
    else def.gather = [{ item: itemId, qty: 1 }];
    def.edible = !fibre;
  }
  r.plants ??= [];
  const pi = r.plants.findIndex((x) => x.id === id);
  if (pi >= 0) r.plants[pi] = def; else r.plants.push(def);
  // the wild plant's gift joins the foraging lore (every people that forages finds it where it grows)
  if (type !== 'crop') {
    const base = (r.recipes.find((x) => x.id === 'foraging') ?? u.content.recipes.find('foraging')) as RecipeDef | undefined;
    if (base && base.gather) {
      const fr = JSON.parse(JSON.stringify(base)) as RecipeDef;
      if (!fr.gather!.items.includes(itemId)) fr.gather!.items.push(itemId);
      const i = r.recipes.findIndex((x) => x.id === 'foraging');
      if (i >= 0) r.recipes[i] = fr; else r.recipes.push(fr);
    }
  }
  if (rebuild) rebuildContent(u);
  return { id, item: itemId, made: true };
}

const pPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };

export function registerPlantCommands(r: CommandRegistry): void {
  r.register('content.plant', ({ u, p, cmd }, a) => {
    const name = String(a.name ?? '').trim().slice(0, 40);
    if (!name) return fail('Name the plant.');
    const type = (['tree', 'shrub', 'grass', 'crop'].includes(String(a.type)) ? String(a.type) : 'shrub') as PlantType;
    if (u.content.items.has(slug(name)) && !u.content.plants.has(slug(name)) && !u.god.runtime.items.some((x) => x.id === slug(name))) {
      return fail(`${titleCase(name)} is already a thing of this world: name the new plant differently.`);
    }
    const yields = a.yields && typeof a.yields === 'object' ? a.yields as PlantSpec['yields'] : undefined;
    const at = norm(a.pos ?? herePos(u, p));
    const m = makePlant(u, { name, type, like: typeof a.like === 'string' ? a.like : undefined, yields }, true, at, p);
    const def = u.content.plants.find(m.id)!;
    const item = u.content.items.find(m.item);
    let grown = '';
    if (type !== 'crop' && a.plant !== false) {
      const sp = u.content.plants.idx(m.id);
      const n = plantArea(u, p, sp, at, Number(a.radius ?? 150), 0.6);
      grown = n ? ` It grows ${placeName(p, at)} (${n} cells).` : ` Nowhere ${placeName(p, at)} can hold it.`;
    }
    u.emit({ t: 'content.plant', planet: p.id, pos: at, text: m.id, data: { plant: m.id, item: m.item, type } });
    void cmd;
    if (!m.made) return ok(`${def.name} already grows in this world.${grown}`);
    return ok(`${def.name} is a new ${type === 'crop' ? 'crop' : type}${def.type !== 'crop' ? '' : ' to sow'}: it gives ${item ? item.name.toLowerCase() : 'nothing yet'}.${grown}`);
  }, {
    desc: 'Invent a new plant or crop (and what it gives)', category: 'Life',
    params: {
      name: { type: 'string', required: true }, type: { type: 'enum', values: ['tree', 'shrub', 'grass', 'crop'], default: 'shrub' },
      like: { type: 'enum', values: (u) => u.content.plants.ids(), desc: 'the plant it is like (its climate)' }, yields: { type: 'any', desc: '{ item?, food?, tags? }' },
      pos: pPos, radius: { type: 'number', min: 20, max: 20000, default: 150 }, plant: { type: 'boolean', default: true, desc: 'grow the wild plant there now' },
    },
  });
}
