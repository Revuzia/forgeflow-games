// Synthetic catalog for sim probes (lane SIM). NOT content: every id is a placeholder (fx_*).
//
// `buildCatalog(patch)` assembles a full raw catalog, lets the caller patch it, then runs the real
// zod `Catalog.parse` so fixtures stay honest (strict keys, defaults applied exactly as the
// content build would apply them). Helpers build raw records with sensible defaults.

import { Catalog, type CatalogT } from '../../src/contracts/catalog.ts';

type Raw = Record<string, unknown>;
type Eff = Raw;

const ICON = 'assets/fx/icon.png';

export function ability(id: string, effects: Eff[], opts: Raw = {}): Raw {
  return {
    id, name: `Fx ${id}`, desc: 'synthetic', icon: ICON, cooldown: 5, cost: 0,
    targeting: { kind: 'none' }, castTime: 0, effects, ai: { use: ['damage'] }, ...opts,
  };
}

export function passive(id: string, triggers: Raw[] = [], opts: Raw = {}): Raw {
  return { id, name: `Fx ${id}`, desc: 'synthetic', icon: ICON, triggers, ...opts };
}

export interface FighterOpts {
  base?: Raw; growth?: Raw; attack?: Raw; resource?: string; radius?: number;
  passive?: Raw; a1?: Raw; a2?: Raw; a3?: Raw; ult?: Raw;
}
export function fighter(id: string, o: FighterOpts = {}): Raw {
  return {
    id, name: `Fx ${id}`, title: 'synthetic', role: 'fx_role', resource: o.resource ?? 'fx_mana', job: 'synthetic',
    difficulty: 1, lore: 'synthetic', tags: [],
    base: { hp: 1000, hpRegen: 0, res: 0, resRegen: 0, ad: 60, ap: 0, armor: 0, resist: 0, attackSpeed: 1, moveSpeed: 3.5, ...(o.base ?? {}) },
    growth: o.growth ?? {},
    attack: o.attack ?? { range: 1.5, windup: 0.3 },
    collisionRadius: o.radius ?? 0.5,
    kit: {
      passive: o.passive ?? passive(`${id}_p`),
      a1: o.a1 ?? ability(`${id}_a1`, []),
      a2: o.a2 ?? ability(`${id}_a2`, []),
      a3: o.a3 ?? ability(`${id}_a3`, []),
      ult: o.ult ?? ability(`${id}_ult`, []),
    },
    art: {
      model: 'assets/fx/f.glb', portrait: 'assets/fx/p.png', splash: 'assets/fx/s.png', icon: ICON, height: 1.8,
      // zod 4: a record keyed by an enum is exhaustive, so every clip role is listed
      clips: Object.fromEntries(['idle', 'run', 'attack1', 'attack2', 'crit', 'cast_a1', 'cast_a2', 'cast_a3', 'cast_ult',
        'channel', 'death', 'recall', 'spawn', 'victory', 'stunned', 'dash', 'idle_lobby', 'taunt'].map((k) => [k, k])),
    },
    ai: { style: 'skirmisher', preferredRange: 2 },
    palette: { primary: '#334455', secondary: '#667788' },
  };
}

export function unit(id: string, kind: string, o: Raw = {}): Raw {
  return {
    id, name: `Fx ${id}`, kind,
    base: { hp: 500, ad: 20, attackSpeed: 1, moveSpeed: 3, ...((o.base as Raw) ?? {}) },
    collisionRadius: 0.4,
    art: { model: 'assets/fx/u.glb', height: 1 },
    ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'base')),
  };
}

export function item(id: string, o: Raw = {}): Raw {
  return { id, name: `Fx ${id}`, desc: 'synthetic', icon: ICON, tier: 'basic', cost: 300, ...o };
}

export const FX_RULES = {
  startLevel: 1, maxLevel: 18, startGold: 500, passiveGoldPerSec: 2, passiveGoldStart: 60, goldMult: 1, xpMult: 1,
  xpTable: [280, 380, 480, 580, 680, 780, 880, 980, 1080, 1180, 1280, 1380, 1480, 1580, 1680, 1780, 1880],
  respawn: { base: 6, perLevel: 2, max: 50 },
  shopAccess: 'base', recall: true, recallTime: 8, fountainHeals: true, itemPool: 'fx_pool',
  structures: true, jungle: true,
  end: { kind: 'core', coreStructure: 'fx_tower' },
  bounty: { kill: 300, assistShare: 0.5, streakStep: 50, streakMax: 500, shutdownMax: 700 },
  abilityRanks: { basicMax: 5, ultLevels: [6, 11, 16] },
};

/** 60×60 m arena: a wall slab across the middle with a gap at the top, one thicket */
export const FX_MAP = {
  id: 'fx_map', name: 'Fx Map', desc: 'synthetic', size: [60, 60], navCell: 0.5,
  walls: [
    [[28, 0], [32, 0], [32, 45], [28, 45]],
  ],
  thickets: [
    [[8, 40], [16, 40], [16, 48], [8, 48]],
  ],
  lanes: [{ id: 'fx_lane', name: 'Fx Lane', path: [[5, 55], [55, 55]] }],
  bases: [
    { team: 0, spawn: [5, 5], fountain: { at: [3, 3], radius: 4 }, shop: { at: [3, 3], radius: 6 } },
    { team: 1, spawn: [55, 5], fountain: { at: [57, 3], radius: 4 }, shop: { at: [57, 3], radius: 6 } },
  ],
  art: {
    scene: 'assets/fx/scene.glb', sky: 'assets/fx/sky.hdr', lut: 'assets/fx/lut.cube', minimap: 'assets/fx/mm.png',
    lighting: { sunDir: [0, 1, 0], sunColor: '#ffffff', sunIntensity: 1, ambient: 0.3, fogColor: '#000000', fogDensity: 0, exposure: 1 },
    music: 'fx_music',
  },
  camera: { pitchDeg: 55, fovDeg: 40, distance: 20, minDistance: 10, maxDistance: 30 },
};

export interface CatalogPatch {
  fighters?: Raw[];
  units?: Raw[];
  items?: Raw[];
  spells?: Raw[];
  boons?: Raw[];
  teamBuffs?: Raw[];
  maps?: Raw[];
  resources?: Raw[];
  rules?: Raw;
  queueRules?: Raw;
  /** replace the mode list (default: one 'fx_mode' on 'fx_map' with FX_RULES ⊕ rules) */
  modes?: Raw[];
  /** replace the queue list (default: 'fx_queue' standard + 'fx_practice') */
  queues?: Raw[];
  /** extra skins on top of one base skin per fighter (`<fighter>_skin`) */
  skins?: Raw[];
}

/** a raw ModeDef (rules = FX_RULES ⊕ rules) */
export function mode(id: string, map: string, rules: Raw = {}, o: Raw = {}): Raw {
  return {
    id, name: `Fx ${id}`, tagline: 'synthetic', desc: 'synthetic', map, teams: 2, perTeam: 5, pick: 'draft',
    rules: { ...FX_RULES, ...rules }, roles: false,
    card: { art: 'assets/fx/card.png', accent: '#abcdef', glyph: 'assets/fx/glyph.png' }, ...o,
  };
}
/** a raw QueueDef */
export function queue(id: string, modeId: string, kind = 'standard', o: Raw = {}): Raw {
  return {
    id, mode: modeId, name: `Fx ${id}`, desc: 'synthetic', kind, rules: {},
    bots: { fill: 'all_open', difficulty: 'adept' }, partyMax: 5,
    grants: { win: 10, loss: 5, perMinute: 1, cap: 50, xpWin: 10, xpLoss: 5 }, order: 1, ...o,
  };
}

export function rawCatalog(p: CatalogPatch = {}): Raw {
  const fighters = p.fighters ?? [fighter('fx_fighter_a'), fighter('fx_fighter_b')];
  const botNames = Array.from({ length: 20 }, (_, i) => `Fx Bot ${i + 1}`);
  return {
    schema: 1, version: '2026.10.0', builtAt: '2026-10-07T00:00:00Z',
    roles: [{ id: 'fx_role', name: 'Fx Role', contract: 'synthetic', icon: ICON, color: '#112233' }],
    resources: p.resources ?? [
      { id: 'fx_mana', name: 'Fx Mana', desc: 'pool', color: '#2244ff', model: 'pool', max: 300, regen: 2 },
      { id: 'fx_fury', name: 'Fx Fury', desc: 'build', color: '#ff2222', model: 'build', max: 100, startFull: false, decayPerSec: 10, decayDelay: 2, gainOnAttack: 10, gainOnHitTaken: 5, gainOnAbilityHit: 7 },
      { id: 'fx_heat', name: 'Fx Heat', desc: 'heat', color: '#ff8800', model: 'heat', max: 100, startFull: false, decayPerSec: 20, decayDelay: 1, overheatLock: 2 },
      { id: 'fx_none', name: 'Fx None', desc: 'none', color: '#888888', model: 'none', max: 0 },
    ],
    fighters,
    skins: [...fighters.map((f) => ({
      id: `${f.id as string}_skin`, fighter: f.id, name: 'Fx Skin', tier: 'base', model: 'assets/fx/f.glb',
      portrait: 'assets/fx/p.png', splash: 'assets/fx/s.png', releasedIn: '2026.10.0',
    })), ...(p.skins ?? [])],
    items: p.items ?? [item('fx_item_sword', { stats: { ad: 20 } })],
    setup: {
      spells: p.spells ?? [
        ability('fx_spell_blink', [{ op: 'blink', distance: 4 }], { cooldown: 100, targeting: { kind: 'point', range: 0 } }),
        ability('fx_spell_heal', [{ op: 'heal', amount: { base: [50, 60, 70] }, to: 'self' }], { cooldown: 120 }),
      ],
      spellSlots: 2,
      boons: p.boons ?? [{ ...passive('fx_boon_a'), path: 'fx_path' }],
      boonSlots: 1,
      paths: [{ id: 'fx_path', name: 'Fx Path', desc: 'synthetic', color: '#445566', icon: ICON }],
      defaults: { spells: ['fx_spell_blink', 'fx_spell_heal'], boons: ['fx_boon_a'] },
    },
    units: p.units ?? [
      unit('fx_minion', 'minion', { attack: { range: 1, windup: 0.3 } }),
      unit('fx_tower', 'structure', { base: { hp: 3000, ad: 100, attackSpeed: 0.8, moveSpeed: 0 }, attack: { range: 7, windup: 0.2, projectileSpeed: 20 } }),
      unit('fx_summon', 'summon', { attack: { range: 1, windup: 0.3 } }),
      unit('fx_ward', 'ward', { base: { hp: 3, moveSpeed: 0 }, sightRange: 8 }),
      unit('fx_dummy', 'minion', { base: { hp: 100000, ad: 0, moveSpeed: 0, attackSpeed: 0 } }),
      unit('fx_monster', 'monster', { attack: { range: 1, windup: 0.3 } }),
    ],
    teamBuffs: p.teamBuffs ?? [{ id: 'fx_teambuff', name: 'Fx Team', desc: 'synthetic', icon: ICON, stats: { ad: 10 }, minionStats: { ad: 5 } }],
    maps: p.maps ?? [FX_MAP],
    modes: p.modes ?? [{
      id: 'fx_mode', name: 'Fx Mode', tagline: 'synthetic', desc: 'synthetic', map: 'fx_map', teams: 2, perTeam: 5, pick: 'draft',
      rules: { ...FX_RULES, ...(p.rules ?? {}) }, roles: false,
      card: { art: 'assets/fx/card.png', accent: '#abcdef', glyph: 'assets/fx/glyph.png' },
    }],
    queues: p.queues ?? [
      {
        id: 'fx_queue', mode: 'fx_mode', name: 'Fx Queue', desc: 'synthetic', kind: 'standard', rules: p.queueRules ?? {},
        bots: { fill: 'all_open', difficulty: 'adept' }, partyMax: 5,
        grants: { win: 10, loss: 5, perMinute: 1, cap: 50, xpWin: 10, xpLoss: 5 }, order: 1,
      },
      {
        id: 'fx_practice', mode: 'fx_mode', name: 'Fx Practice', desc: 'synthetic', kind: 'practice', rules: {},
        bots: { fill: 'none', difficulty: 'adept' }, partyMax: 1,
        grants: { win: 0, loss: 0, perMinute: 0, cap: 0, xpWin: 0, xpLoss: 0 }, order: 2,
      },
    ],
    ranks: [],
    store: { currencies: [{ id: 'fx_coin', name: 'Fx Coin', desc: 'synthetic', icon: ICON, earnedOnly: true }], offers: [], shelves: [] },
    client: {
      nav: [], modeSlots: [],
      home: {
        headline: 'fx', sub: 'fx',
        feature: { art: 'assets/fx/a.png', title: 'fx', body: 'fx', cta: { label: 'fx', screen: 'fx_screen' } },
        tiles: [],
      },
      menuScene: { model: 'assets/fx/m.glb', sky: 'assets/fx/sky.hdr', lut: 'assets/fx/lut.cube' },
    },
    audio: { cues: {}, music: { fx_music: { file: 'assets/fx/m.ogg', bpm: 100 } } },
    vfx: [],
    strings: {},
    botNames,
  };
}

/** raw → zod-validated CatalogT (throws with the zod issues if a fixture is malformed) */
export function buildCatalog(p: CatalogPatch = {}): CatalogT {
  const raw = rawCatalog(p);
  const r = Catalog.safeParse(raw);
  if (!r.success) {
    const msg = r.error.issues.slice(0, 8).map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`fixture catalog failed schema validation:\n${msg}`);
  }
  return r.data;
}
