// GENESIS — the god layer's laws in the parameter registry (CONTRACT.md §11.7): every tunable god number by path, so
// `set <path> <value>`, the freeform parser and the "Laws of this world" inspector reach them: belief, creatures, the
// hand, rivals, restraint, miracles, disasters (also per world: world.disasters / world.harm), the light of a world,
// its orbit's inclination, its look, and every species' parameters (species.<id>.fertility, .lifespan, .speed, .size,
// .maturity, .elder, .swim) — species laws are content (god/runtime.ts) so the peoples' own tables follow at once.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { SpeciesDef } from '../content.ts';
import { registerParam, fmt, FAMILIES, FAMILY_LISTS, type ParamDef } from './params.ts';
import { setSpeciesLaw } from './runtime.ts';
import { resetClimateMemory } from '../fields/climate.ts';

const DEG = Math.PI / 180;

function law(path: string, label: string, unit: string, max: number, desc: string, aliases: string[] = []): ParamDef {
  return {
    path, label, unit, kind: 'number', min: 0, max, desc, aliases,
    get: (u) => u.god.law(path),
    set: (u, _p, v) => { u.god.laws[path] = Number(v); return `${label}: ${fmt(Number(v))}${unit ? ' ' + unit : ''}.`; },
  };
}

/** a law of one world ("<law>@<planet>"), falling back to the universe's */
function worldLaw(path: string, of: string, label: string, max: number, desc: string, aliases: string[] = []): ParamDef {
  return {
    path, label, unit: '×', kind: 'number', min: 0, max, desc, aliases,
    get: (u, p) => u.god.lawAt(of, p.id),
    set: (u, p, v) => { u.god.laws[`${of}@${p.id}`] = Number(v); return `On ${p.name}, ${label.toLowerCase()} is now ${fmt(Number(v))}×.`; },
  };
}

const SPECIES_KEYS: Record<string, { label: string; unit: string; min: number; max: number; desc: string }> = {
  fertility: { label: 'fertility', unit: 'births / year', min: 0, max: 20, desc: 'how many children a couple can have in a year' },
  lifespan: { label: 'lifespan', unit: 'years', min: 1, max: 5000, desc: 'how long they live' },
  speed: { label: 'speed', unit: '×', min: 0.05, max: 20, desc: 'how fast they walk' },
  size: { label: 'size', unit: 'm', min: 0.1, max: 50, desc: 'how tall they stand' },
  maturity: { label: 'age of maturity', unit: 'years', min: 0, max: 200, desc: 'when they are grown' },
  elder: { label: 'elder age', unit: 'years', min: 1, max: 4000, desc: 'when they grow old' },
  swim: { label: 'swimming', unit: '×', min: 0, max: 20, desc: 'how well they swim' },
  fly: { label: 'flight', unit: '0/1', min: 0, max: 1, desc: 'whether they fly (over water, up cliffs)' },
};

function speciesParam(u: Universe | null, id: string, key: string): ParamDef | undefined {
  const k = SPECIES_KEYS[key];
  if (!k) return undefined;
  return {
    path: `species.${id}.${key}`, label: `${id} ${k.label}`, unit: k.unit, kind: 'number', min: k.min, max: k.max, desc: `Species law: ${k.desc}.`,
    get: (uu) => { const d = uu.content.species.find(id); return d ? Number((d as unknown as Record<string, number>)[key]) : null; },
    set: (uu, _p, v) => {
      const d = uu.content.species.find(id);
      if (!d) return `There is no species called '${id}'.`;
      setSpeciesLaw(uu, id, key as keyof SpeciesDef, Number(v));
      return `${d.name}: ${k.label} is now ${fmt(Number(v))} ${k.unit}.`;
    },
  };
  void u;
}

let installed = false;

export function registerGodParams(): void {
  if (installed) return;
  installed = true;
  for (const d of [
    law('disasters.natural', 'Natural disasters', '×', 20, 'How often disasters come on their own (0 = never).', ['natural disasters', 'disaster rate']),
    law('disasters.harm', 'Disaster harm', '×', 10, 'How much disasters hurt and wreck.', ['disaster harm']),
    law('belief.gain', 'Belief gain', '×', 10, 'How strongly people answer what the gods do.', ['belief gain', 'faith gain']),
    law('belief.decay', 'Belief decay', '×', 10, 'How fast neglected faith fades.', ['faith decay']),
    law('creature.learning', 'Creature learning', '×', 10, 'How fast creatures learn from rewards, slaps and watching.', ['creature learning']),
    law('creature.growth', 'Creature growth', '×', 50, 'How fast creatures grow.', ['creature growth']),
    law('hand.strength', 'Hand strength', '×', 20, 'How hard the hand throws.', ['throw strength', 'hand strength']),
    law('rivals.activity', 'Rival activity', '×', 20, 'How often rival gods act.', ['rival activity']),
    law('restraint.costScale', 'Restraint costs', '×', 20, 'Worship costs of powers in restraint mode.', ['restraint cost']),
    law('miracles.potency', 'Miracle potency', '×', 10, 'How strong miracles are.', ['miracle strength', 'miracle potency']),
    worldLaw('world.disasters', 'disasters.natural', 'Natural disasters here', 20, 'How often disasters come on their own on this world.'),
    worldLaw('world.harm', 'disasters.harm', 'Disaster harm here', 10, 'How much disasters hurt on this world.'),
    {
      path: 'planet.light', label: 'Sunlight', unit: '×', kind: 'number', min: 0.02, max: 4, aliases: ['light', 'sunlight', 'daylight'], desc: 'How much of the star\'s light reaches this world (an eclipse lowers it).',
      get: (_u: Universe, p: Planet) => p.st.lightScale,
      set: (_u: Universe, p: Planet, v: number | boolean | string | null) => { p.st.lightScale = Number(v); resetClimateMemory(p); return `${p.name} now gets ${fmt(Number(v))}× the light.`; },
    } as ParamDef,
    {
      path: 'orbit.inclination', label: 'Orbit inclination', unit: '°', kind: 'number', min: 0, max: 90, aliases: ['inclination'], desc: 'Tilt of the orbit against the system plane.',
      get: (_u: Universe, p: Planet) => p.st.orbit.inc / DEG,
      set: (_u: Universe, p: Planet, v: number | boolean | string | null) => { p.st.orbit.inc = Number(v) * DEG; return `The orbit tilts to ${fmt(Number(v))}°.`; },
    } as ParamDef,
    {
      path: 'planet.look', label: 'World look', unit: '', kind: 'enum', values: (u: Universe) => [...new Set(u.content.planetkinds.list.map((k) => k.render))], aliases: ['palette', 'look'], desc: 'The palette the world is drawn with.',
      get: (_u: Universe, p: Planet) => p.st.render,
      set: (_u: Universe, p: Planet, v: number | boolean | string | null) => { p.st.render = String(v); return `${p.name} now looks ${v}.`; },
    } as ParamDef,
    {
      path: 'planet.name', label: 'World name', unit: '', kind: 'string', aliases: ['world name'], desc: 'What the world is called.',
      get: (_u: Universe, p: Planet) => p.name,
      set: (_u: Universe, p: Planet, v: number | boolean | string | null) => { const b = p.name; p.name = String(v).trim().slice(0, 30) || p.name; return `${b} is now called ${p.name}.`; },
    } as ParamDef,
    {
      path: 'star.name', label: 'Star name', unit: '', kind: 'string', aliases: ['sun name'], desc: 'What the star is called.',
      get: (u: Universe) => u.star.name,
      set: (u: Universe, _p: Planet, v: number | boolean | string | null) => { u.star.name = String(v).trim().slice(0, 30) || u.star.name; return `The star is now called ${u.star.name}.`; },
    } as ParamDef,
  ]) registerParam(d);
  FAMILIES.push((path) => {
    const m = path.match(/^species\.([a-z0-9-]+)\.([a-z]+)$/);
    return m ? speciesParam(null, m[1], m[2]) : undefined;
  });
  FAMILY_LISTS.push((u) => {
    const out: ParamDef[] = [];
    for (const sp of u.content.species.list) for (const key of Object.keys(SPECIES_KEYS)) { const d = speciesParam(u, sp.id, key); if (d) out.push(d); }
    return out;
  });
}
