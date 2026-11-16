// PLAYGROUND world data: the place and thing id tables, the mechanism and zone library ids, the shared PlaceDef types, PLACE_INFO, THING_KINDS,
// MECH_RANGES and loadPlaceDef (specs: _spec/PLACES.md, _spec/PLAYGROUND_BUILD.md 6). Owned by the DATA lane (PG_DATA).
//
// LOADING (D-69): this module ships in the post-play LIFE CHUNK with life.ts, quests.ts and place_home.ts. Each other place's PlaceDef is its own
// lazy module src/data/place_<id>.ts (flat in src/data, probe_genome lists it non-recursively), loaded with its place through loadPlaceDef(id).
// journal_text.ts is never imported from here. Every id list is APPEND-ONLY (its index is saved): DT-14 freezes them in a lock list.
// Pure data: no DOM, no three, no clock. Relative imports end in .ts; `as const` objects, no enums (erasableSyntaxOnly).

/* ───────────────────────────── ids (append-only: idx is saved) ───────────────────────────── */

export const PLACE_IDS = ['home', 'hearthlog', 'ripple', 'frostbell', 'rainleaf', 'fizzwell', 'cogwhistle', 'lanternroof', 'echohollow', 'cloudloft'] as const;
export const THING_IDS = ['feltball', 'musicbox', 'snoozerug', 'warmlamp', 'keepsakeshelf', 'bouncepad',              // Home 0..5
  'hearth', 'rockerboard', 'yarnball', 'pillowswing', 'snugbasket', 'kettle',                                           // Hearthlog 6..11
  'rockpool', 'bobring', 'driftlog', 'shellchimes', 'pebbleball', 'sandmound',                                          // Ripple 12..17
  'icepond', 'glideramp', 'steampool', 'iciclebells', 'snowdriftnest', 'snowball', 'shakepine',                         // Frostbell 18..24
  'splashspots', 'leafteeter', 'mossbouncer', 'dripleaf', 'steppingstones', 'seedpod',                                  // Rainleaf 25..30
  'bathwater', 'tap', 'swirlride', 'soapslide', 'spongeraft', 'bubblepatch',                                           // Fizzwell 31..36
  'spinningcog', 'windupkey', 'springplate', 'magnet', 'steelmarble', 'tickclock', 'littlebell',                       // Cogwhistle 37..43
  'lanternline', 'vanedisc', 'hammock', 'chimneycorner', 'moondish', 'starscope',                                      // Lanternroof 44..49
  'crystals', 'glowpool', 'stoneslide', 'mossbed', 'echostone', 'humrock',                                             // Echo Hollow 50..55
  'puffpads', 'updraft', 'kiteswing', 'sunbowarch', 'cloudnest', 'cloudball'] as const;                                // Cloudloft 56..61
export type PlaceId = (typeof PLACE_IDS)[number];
export type ThingId = (typeof THING_IDS)[number];

/** The 14 mechanisms (PLACES 2.1). 0 = a patch or zone thing with no collider (the Ice Pond, the Updraft, the Snooze Rug). */
export const MECH = { block: 1, bar: 2, mound: 3, ring: 4, ramp: 5, pool: 6, seesaw: 7, swing: 8, turntable: 9, chime: 10, pad: 11, floater: 12, ball: 13, switch: 14 } as const;
/** The 9 zone kinds (PLACES 2.2). Physics zones: water, current, wind, updraft, magnet. Flag zones: warm, cold, wet, echo. */
export const ZONE = { water: 1, current: 2, wind: 3, updraft: 4, magnet: 5, warm: 6, cold: 7, wet: 8, echo: 9 } as const;
/** Ground marks (PLACES 2.2; StageLike.stampMark). */
export const MARK = { print: 1, trail: 2, dust: 3, dent: 4, glow: 5 } as const;
/** A thing's sound kind (SquishAudio.prop). */
export const PROP_SOUND = { ball: 1, creak: 2, chime: 3, splash: 4, crunch: 5, crackle: 6, boing: 7, bell: 8, tick: 9, kettle: 10, rustle: 11, whoosh: 12 } as const;

/** Each place's signature verb event (P13, DT-13) and finale spectacle (render and audio ids; looks and sound only, inside the flash gate). */
export const SIGNATURE = { arrive: 1, toast: 2, squirt: 3, glide: 4, splashjump: 5, floatsit: 6, cogride: 7, moongaze: 8, echotalk: 9, updraft: 10 } as const;
export const FINALE = { wishtrip: 1, firesong: 2, sunset: 3, stars: 4, rainstop: 5, bubblecolumn: 6, machinetune: 7, lanternsong: 8, crystalscale: 9, sunrise: 10 } as const;

/* ───────────────────────────── the shared types (PLAYGROUND_BUILD 6, revision 4) ───────────────────────────── */

/** An area on the ground: a disc (r) or a box (half sizes hx, hz, turned by yaw radians). Metres, x right, z toward the camera. */
export interface Area { readonly shape: 'disc' | 'box'; readonly x: number; readonly z: number; readonly r?: number; readonly hx?: number; readonly hz?: number; readonly yaw?: number }
export interface GroundMods { readonly grip: number; readonly glue: number; readonly peel: number; readonly drag: number }
/** A ground patch with its own modifiers and marks. ice: grip = the family's ice grip (life.ts FAMILY_REACT) and drag 0.25; nap: a nap spot
 *  (rest falls twice as fast). A patch belongs to the thing whose `patch` equals its id (or the part of its id before the first '.'). */
export interface PatchDef extends Area { readonly id: string; readonly mods: Partial<GroundMods>; readonly ice?: boolean; readonly nap?: boolean; readonly mark?: number; readonly markLifeS?: number }
/** A zone (PLACES 2.2). kind: ZONE id; strength 0..1; surfaceY: a water surface (m, at most 0.30, P4); ramp: the physics depth ramp at the
 *  edge (m); flow: a current, [tangential, radial] m/s for a disc, [vx, vz] for a box; falloff: [the radius of full strength, the strength at
 *  the edge] (the cabin's Fireside Warmth: 1.0 inside 0.8 m, 0.4 at r); glow: the water glows (the Glow Pool, REACT GLOW). A zone belongs to
 *  the thing whose `zone` equals its id or the part of its id before the first '.' (the three Splash Spots, the steam pool's warm twin). */
export interface ZoneDef extends Area { readonly id: string; readonly kind: number; readonly strength: number; readonly surfaceY?: number; readonly ramp?: number;
  readonly wave?: { readonly amp: number; readonly everyS: readonly [number, number] }; readonly flow?: readonly [number, number];
  readonly gust?: { readonly everyS: readonly [number, number]; readonly forS: number }; readonly shower?: { readonly onS: number; readonly offS: number }; readonly switchable?: boolean;
  readonly falloff?: readonly [number, number]; readonly glow?: boolean }
/** One thing (PLACES 4). size per mech: a box or block its half sizes [hx, hy, hz] (a ramp's long axis is local x); a bar or seat capsule
 *  [r, TOTAL length including both caps, 0] (lying along local x; p.standing = 1 stands it up); a ring [ringR, segR, gapDeg] with yaw = the gap
 *  direction (atan2(z, x): pi/2 opens toward the camera); a ball [r, 0, 0]; a mound [sphere r, top above ground, 0]; a pad or turntable
 *  [r, half thickness, 0]; a pool [r (or hx), surfaceY, 0 (or hz)]; mech 0 (a patch or zone thing) its area [r, 0, 0] or [hx, 0, hz].
 *  A ramp slopes DOWN toward its local +x (yaw points downhill): its top (where the player sets a rider) is at local -x, its foot at +x.
 *  A thing of several parts (chimes, bells, crystals, lanterns: p.n parts spaced evenly over p.span metres along its yaw axis; the puff pads:
 *  p.x1, p.z1, p.x2, p.z2 for parts 1 and 2) keeps its parts in that order (PropWorldLike's prop order); a row with p.curve bows that many
 *  metres toward its local +z at the middle (a parabola; the Singing Crystals curve toward the room). p holds the mechanism parameters
 *  (MECH_RANGES' names; angles in degrees). useSpot: where a body stands to use it (a ring: its inner spot; the swing and rides: their
 *  riders' spots come from p.rider or the seat); peek: S13's two spots [lx, lz, rx, rz]; push: a swing's S11 push spot. */
export interface ThingDef { readonly id: ThingId; readonly place: PlaceId; readonly mech: number; readonly x: number; readonly z: number; readonly yaw: number;
  readonly size: readonly [number, number, number];
  readonly mu: number; readonly p: Readonly<Record<string, number>>;
  readonly ride: boolean;
  readonly zone?: string; readonly patch?: string;
  readonly switch?: 'zone' | 'motor' | 'tune' | 'shower' | 'echo' | 'fire' | 'comet';
  readonly notes?: readonly number[]; readonly useSpot?: readonly [number, number];
  readonly peek?: readonly [number, number, number, number];
  readonly push?: readonly [number, number];
  readonly fromN?: number;
  readonly verb: number; readonly icon: number; readonly look: string; readonly sound: number;
  readonly arrives?: { readonly after: string } }
/** The tall layout's (or Home's TALL frame's) spot of one ThingDef: position, yaw and the spots that move with it. */
export interface Spot { readonly x: number; readonly z: number; readonly yaw: number; readonly use?: readonly [number, number]; readonly peek?: readonly [number, number, number, number];
  readonly push?: readonly [number, number]; readonly fromN?: number }
/** A layout: one Spot per ThingDef and one Area per ZoneDef and PatchDef, in the same order. */
export interface LayoutDef { readonly bounds: Area & { readonly round: number }; readonly walls: readonly Area[];
  readonly spawn: readonly (readonly [number, number])[] | 'matLayout';
  readonly things: readonly Spot[]; readonly zones: readonly Area[]; readonly patches: readonly Area[] }
export interface PlaceDef { readonly id: PlaceId; readonly idx: number; readonly name: string; readonly coined?: readonly string[];
  readonly stampsToOpen: number | 'firstWish'; readonly shipped: boolean; readonly night: boolean;
  readonly ground: GroundMods & { readonly mark: number; readonly markLifeS: number }; readonly patches: readonly PatchDef[]; readonly zones: readonly ZoneDef[];
  readonly things: readonly ThingDef[]; readonly bounds: Area & { readonly round: number }; readonly walls: readonly Area[];
  readonly pad: readonly [number, number, number]; readonly spawn: readonly (readonly [number, number])[] | 'matLayout';
  /** The portrait layout (D-68); the fields above are the wide layout. */
  readonly tall: LayoutDef;
  /** Home: thing spots are in slot units, x bodyScale like stage.matLayout (D-67); Home's WIDE frame is the PlaceDef's own fields, TALL is `tall`. */
  readonly unit?: 'slot';
  /** yawRange in degrees either side of the place's front; pitch in radians; zoom factors (P8). */
  readonly camera: { readonly yawRange: number; readonly pitch: readonly [number, number]; readonly zoom: readonly [number, number] };
  readonly light: string; readonly sky: string; readonly weather: string; readonly ambience: string; readonly music: string;
  readonly ceremonyDim: number; readonly signature: number; readonly finale: number;
  /** The channel of every cell of PLACES 4 (D-80); PLACES 3's defaults (life.ts DEFAULT_REACTIONS) fill the rest. */
  readonly reactions: readonly Reaction[] }
/** target: a place-local thing index, or 100 + a zone index; family: MATERIAL_FAMILY_IDS index; tag: the cell's P / L / S / B letter; chan: a
 *  life.ts CHANNEL id; arg: its level or id (life.ts says how to read it per channel). */
export interface Reaction { readonly target: number; readonly family: number; readonly tag: 'P' | 'L' | 'S' | 'B'; readonly chan: number; readonly arg: number }

const TAGS = ['P', 'L', 'S', 'B'] as const;
/** Unpack a place module's packed reaction cells [target, family, tag 0..3, chan, arg] x n (built once at module load). */
export function cells(a: readonly number[]): readonly Reaction[] {
  const out: Reaction[] = [];
  for (let i = 0; i + 4 < a.length; i += 5) out.push({ target: a[i], family: a[i + 1], tag: TAGS[a[i + 2]], chan: a[i + 3], arg: a[i + 4] });
  return out;
}
/** Does a zone or patch with this id belong to the thing whose `zone` / `patch` is `ref`? (equal, or ref is the id's part before the first '.') */
export function ownsArea(ref: string | undefined, areaId: string): boolean {
  if (!ref) return false;
  const dot = areaId.indexOf('.');
  return ref === (dot < 0 ? areaId : areaId.slice(0, dot));
}

/* ───────────────────────────── what Travel and the reducer need without loading a place ───────────────────────────── */

/** Every place's name and opening rule (QUESTS 7). `shipped`: true for home and hearthlog only; the orchestrator flips the others when their
 *  slice ships (and in the same change their PlaceDef's own `shipped`). coined: the coined single words of its names (NAME gate rules, PLACES 7). */
export const PLACE_INFO: readonly Pick<PlaceDef, 'id' | 'idx' | 'name' | 'coined' | 'stampsToOpen' | 'shipped' | 'night' | 'sky'>[] = [
  { id: 'home', idx: 0, name: 'Home', stampsToOpen: 0, shipped: true, night: false, sky: 'home' },
  { id: 'hearthlog', idx: 1, name: 'Hearthlog Cabin', coined: ['Hearthlog'], stampsToOpen: 'firstWish', shipped: true, night: false, sky: 'cabin' },
  { id: 'ripple', idx: 2, name: 'Ripple Shore', stampsToOpen: 12, shipped: false, night: false, sky: 'shore' },
  { id: 'frostbell', idx: 3, name: 'Frostbell Ridge', coined: ['Frostbell'], stampsToOpen: 20, shipped: false, night: false, sky: 'ridge' },
  { id: 'rainleaf', idx: 4, name: 'Rainleaf Garden', coined: ['Rainleaf'], stampsToOpen: 28, shipped: false, night: false, sky: 'garden' },
  { id: 'fizzwell', idx: 5, name: 'Fizzwell Tub', coined: ['Fizzwell'], stampsToOpen: 36, shipped: false, night: false, sky: 'bath' },
  { id: 'cogwhistle', idx: 6, name: 'Cogwhistle Bench', coined: ['Cogwhistle'], stampsToOpen: 45, shipped: false, night: true, sky: 'bench' },
  { id: 'lanternroof', idx: 7, name: 'Lanternroof', coined: ['Lanternroof'], stampsToOpen: 54, shipped: false, night: true, sky: 'roof' },
  { id: 'echohollow', idx: 8, name: 'Echo Hollow', stampsToOpen: 63, shipped: false, night: false, sky: 'hollow' },
  { id: 'cloudloft', idx: 9, name: 'Cloudloft', coined: ['Cloudloft', 'Sunbow'], stampsToOpen: 72, shipped: false, night: false, sky: 'cloud' },
];
/** A bit per thing-wish glyph kind (life.ts THING_KIND: ball 1, bell 2, droplet 4, note 8, flame 16, sun 32) each place's things have, from
 *  each ThingDef's icon (QUESTS 8; the wish scheduler's mask, LF-25). DT-16 recomputes it from the PlaceDefs. */
export const THING_KINDS: Readonly<Record<PlaceId, number>> = {
  home: 41, hearthlog: 25, ripple: 7, frostbell: 7, rainleaf: 5, fizzwell: 4, cogwhistle: 11, lanternroof: 18, echohollow: 6, cloudloft: 1,
};
/** Mechanism parameter ranges (PLACES 2.1, revision 3), checked by DT-01. Lengths in m, angles in degrees, notes in MIDI. */
export const MECH_RANGES: Readonly<Record<number, Readonly<Record<string, readonly [number, number]>>>> = {
  [MECH.block]: { side: [0.16, 3.0], mu: [0.3, 1.5] },
  [MECH.bar]: { r: [0.08, 0.3], length: [0.3, 3.0] },
  [MECH.mound]: { r: [0.6, 1.2], top: [0.15, 0.3] },
  [MECH.ring]: { ringR: [0.85, 1.1], segR: [0.08, 0.1], gap: [90, 130], segments: [4, 6], opening: [1.35, 3] },
  [MECH.ramp]: { angle: [0, 16], top: [0, 0.55], mu: [0.05, 0.6] },
  [MECH.pool]: { surface: [0.04, 0.3] },
  [MECH.seesaw]: { length: [1.6, 2.4], thickness: [0.16, 0.4], pivot: [0.12, 0.3], limit: [0, 14], inertia: [0.3, 0.8], damping: [0.6, 1.5] },
  [MECH.swing]: { rope: [1.2, 1.5], limit: [0, 30], seatR: [0.08, 0.1], seatY: [0.15, 0.22], seatLength: [0.5, 0.9], damping: [0.15, 0.4] },
  [MECH.turntable]: { r: [0.5, 0.8], motor: [0, 0.4] },
  [MECH.chime]: { note: [62, 83], limit: [0, 25], damping: [0.8, 0.8], hang: [0.3, 0.7] },
  [MECH.pad]: { r: [0.35, 0.6], travel: [0, 0.1], gain: [1.0, 1.25], apex: [0, 0.35], maxBounces: [0, 5] },
  [MECH.floater]: { bob: [0, 0.04], bobHz: [0, 0.4] },
  [MECH.ball]: { r: [0.2, 0.3], mass: [0.1, 0.4], rollDamp: [0.3, 1.5] },
};

/** A place's PlaceDef, loaded lazily (D-69): a dynamic import of src/data/place_<id>.ts, so each place is its own chunk (T1 sums it with the
 *  place's render and audio chunks). Home's module is in the life chunk: the life host imports place_home.ts statically, and this call then
 *  resolves from the same module. Rejects on a load failure (Travel keeps the player where they were). */
export function loadPlaceDef(id: PlaceId): Promise<PlaceDef> {
  switch (id) {
    case 'home': return import('./place_home.ts').then((m) => m.PLACE);
    case 'hearthlog': return import('./place_hearthlog.ts').then((m) => m.PLACE);
    case 'ripple': return import('./place_ripple.ts').then((m) => m.PLACE);
    case 'frostbell': return import('./place_frostbell.ts').then((m) => m.PLACE);
    case 'rainleaf': return import('./place_rainleaf.ts').then((m) => m.PLACE);
    case 'fizzwell': return import('./place_fizzwell.ts').then((m) => m.PLACE);
    case 'cogwhistle': return import('./place_cogwhistle.ts').then((m) => m.PLACE);
    case 'lanternroof': return import('./place_lanternroof.ts').then((m) => m.PLACE);
    case 'echohollow': return import('./place_echohollow.ts').then((m) => m.PLACE);
    case 'cloudloft': return import('./place_cloudloft.ts').then((m) => m.PLACE);
  }
}
