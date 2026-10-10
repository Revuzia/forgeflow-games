// GENESIS — what the camera hears (CONTRACT §17): a pure probe of the world mirror at the listener. No WebAudio here;
// it runs in Node (tests/audio.test.ts) and a few times a second in the browser.
//
// From the camera pose and the WorldView it derives: where the listener is (which world, how high above ground or
// sea, under water, in orbit, in deep space), whether there is air to carry sound, the light (day, dusk, eclipse,
// impact-winter dark), a weighted sample of the fields under and around the camera (biomes, vegetation, open water and
// the shore's direction, rain / snow / hail / sand / ash / acid / blood precipitation, wind, temperature, fire, lava,
// running water), and from that the target level of every ambience layer: wind by altitude, surf near coasts, birds by
// day by biome, crickets and frogs at night, cicadas in heat, rain and distant thunder from the local weather, fire
// crackle, lava rumble, crowd murmur by town size, space hum in orbit, and silence-with-heartbeat on an airless world.
//
// It also lists the point sources worth placing in 3D (fires, crowds, lava, storms seen from outside, every live
// disaster, the creature, ships on the pad or in flight, herds) in LISTENER-LOCAL coordinates (x right, y up, the camera
// looks down −z: exactly WebAudio's default listener frame), and the cultures whose music should play, weighted by
// proximity. The probe is sized by altitude: a walker hears what is within tens of metres, a god hovering over a town
// hears the town.

import type {
  CreatureView, DisasterView, FieldName, HandView, MoverBlock, PlanetParams, SettlementView, ShipView, StarView, WeatherView,
} from '../sim/types.ts';
import { SettlementFlag } from '../sim/types.ts';
import { groundHeight, type GroundSource } from '../sim/grid/surface.ts';
import type { CultureMusic } from './music.ts';
import weatherData from '../data/weather.json' with { type: 'json' };
import animalData from '../data/animals.json' with { type: 'json' };

// ───────────────────────────── inputs ─────────────────────────────

/** the parts of a client PlanetView the probe reads (a PlanetView satisfies it) */
export interface ScenePlanet {
  id: number;
  grid: { count: number; pos: ArrayLike<number>; nearestCell(x: number, y: number, z: number): number };
  params: PlanetParams;
  fields: Map<FieldName, Float32Array>;
  fieldVersion?: Map<FieldName, number>;
  ground?: GroundSource;
  settlements: SettlementView[];
  weather: WeatherView[];
  disasters: DisasterView[];
  animals?: MoverBlock;
  center: ArrayLike<number>;
  quat: ArrayLike<number>;
  /** system-frame unit vector toward the star as the sim heats */
  sunDir: ArrayLike<number>;
  alive?: boolean;
}

/** the parts of the client WorldView the probe reads (a WorldView satisfies it) */
export interface SceneWorld {
  planets: ScenePlanet[];
  ships?: ShipView[];
  creatures?: CreatureView[];
  hand?: HandView | null;
  star?: StarView;
  speed?: number;
}

export interface ListenerState {
  /** system-frame camera position (m) */
  pos: ArrayLike<number>;
  /** system-frame camera orientation (x, y, z, w; the camera looks down its −z) */
  quat: ArrayLike<number>;
  /** the world the camera belongs to (-1: none / system view) */
  planet: number;
  /** the renderer's altitude estimate (m), used when the world's geometry is not known yet */
  altitude: number;
}

// ───────────────────────────── outputs ─────────────────────────────

export interface SceneLayers {
  wind: number; windPitch: number; gust: number;
  surf: number; sea: number;
  birds: number; insects: number; cicadas: number; frogs: number;
  rain: number; hail: number; snow: number; sand: number; ash: number; acid: number; blood: number;
  /** distant thunder rolls per minute (real time) */
  thunderRate: number;
  fire: number; lava: number; crowd: number; stream: number;
  space: number; heartbeat: number; underwater: number;
  /** 0..1 high-frequency damping of the whole ambience (snow, fog, under water) */
  hush: number;
  /** ground rumble from quakes and their kin */
  quake: number;
}

export type EmitterKind = 'fire' | 'crowd' | 'lava' | 'disaster' | 'storm' | 'creature' | 'ship' | 'herd';

export interface SceneEmitter {
  /** stable identity across probes ('fire:1203', 'st:4', 'dis:9', …) */
  key: string;
  kind: EmitterKind;
  /** disaster / weather kind, crowd work kind ('stone' | 'metal' | 'machine'), ship phase, herd voice, creature body */
  sub: string;
  /** listener-local position (m) at probe time */
  local: [number, number, number];
  /** body-frame position (m from the planet's centre): re-placed every frame as the camera and the world turn */
  body: [number, number, number];
  dist: number;
  /** 0..1 audible level at the listener (attenuation already applied) */
  level: number;
  /** kind-specific magnitude: fire cluster size, population, disaster intensity, creature height, herd count */
  size: number;
  /** kind-specific extra: creature anim, ship progress, disaster progress, herd nocturnal flag */
  param: number;
  /** 0..1: the listener is inside it (envelops rather than points) */
  spread: number;
}

export interface MusicCandidate {
  key: string;
  culture: CultureMusic;
  weight: number;
  /** -1..1 stereo position of the town relative to the camera */
  pan: number;
}

export interface BirdPalette { song: number; lark: number; jungle: number; gull: number; water: number; taiga: number; desert: number; raptor: number }

export interface AudioScene {
  /** the world the listener is on / over (-1: deep space) */
  planet: number;
  /** metres above ground or sea surface */
  alt: number;
  radius: number;
  /** 0..1: there is air here and we are in it */
  inAir: number;
  /** 0..1: how far into space the listener is */
  space: number;
  airless: boolean;
  /** 0..1 daylight at the listener (eclipses and dust darken it) */
  day: number;
  /** 0..1 dawn / dusk chorus window */
  dusk: number;
  /** °C at the listener */
  temp: number;
  windSpeed: number;
  layers: SceneLayers;
  birds: BirdPalette;
  /** listener-local unit direction toward the open water (null: none around) */
  coast: [number, number, number] | null;
  emitters: SceneEmitter[];
  music: MusicCandidate[];
  /** 0..1 weight of the orbital score */
  orbital: number;
  /** the god's hand, when it is on this world: listener-local position and distance */
  hand: { local: [number, number, number]; dist: number; pose: string; held: boolean; body: [number, number, number]; unit: [number, number, number] } | null;
  /** the shore direction as a body-frame vector (re-projected every frame); null: no water in hearing */
  coastBody: [number, number, number] | null;
}

export function emptyLayers(): SceneLayers {
  return {
    wind: 0, windPitch: 0, gust: 0, surf: 0, sea: 0, birds: 0, insects: 0, cicadas: 0, frogs: 0,
    rain: 0, hail: 0, snow: 0, sand: 0, ash: 0, acid: 0, blood: 0, thunderRate: 0,
    fire: 0, lava: 0, crowd: 0, stream: 0, space: 0, heartbeat: 0, underwater: 0, hush: 0, quake: 0,
  };
}

function emptyBirds(): BirdPalette {
  return { song: 0, lark: 0, jungle: 0, gull: 0, water: 0, taiga: 0, desert: 0, raptor: 0 };
}

// ───────────────────────────── maths ─────────────────────────────

export function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/** rotate v by unit quaternion q (x, y, z, w) */
export function rotate(q: ArrayLike<number>, x: number, y: number, z: number, out: number[] | [number, number, number]): void {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
  out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
}

/** rotate v by the inverse of unit quaternion q */
export function rotateInv(q: ArrayLike<number>, x: number, y: number, z: number, out: number[] | [number, number, number]): void {
  rotate([-q[0], -q[1], -q[2], q[3]], x, y, z, out);
}

/** how loud a source of reference size `ref` (m) is at distance `d`: 1 near, inverse-square-like far */
export function attenuate(d: number, ref: number): number {
  const k = d / Math.max(1, ref);
  return 1 / (1 + k * k);
}

/** the listener's hearing scale: high above a town the god hears the town, on foot only the street */
export function hearingRef(base: number, alt: number): number {
  return base + 0.45 * Math.max(0, alt);
}

/** body-frame point (m) `h` metres above the ground at direction `u` */
export function bodyPoint(pv: ScenePlanet, u: ArrayLike<number>, h: number): [number, number, number] {
  const l = Math.hypot(u[0], u[1], u[2]) || 1;
  const ux = u[0] / l, uy = u[1] / l, uz = u[2] / l;
  const g = pv.ground && pv.fields.get('surface') ? groundHeight(pv.ground, ux, uy, uz) : pv.params.radius;
  const rr = g + h;
  return [ux * rr, uy * rr, uz * rr];
}

/** listener-local position [x, y, z, distance] of a body-frame point, with the planet's and camera's current frames */
export function toLocal(pv: { center: ArrayLike<number>; quat: ArrayLike<number> }, L: { pos: ArrayLike<number>; quat: ArrayLike<number> }, b: ArrayLike<number>, out: number[] = [0, 0, 0, 0]): [number, number, number, number] {
  const v = [0, 0, 0];
  rotate(pv.quat, b[0], b[1], b[2], v);
  rotateInv(L.quat, pv.center[0] + v[0] - L.pos[0], pv.center[1] + v[1] - L.pos[1], pv.center[2] + v[2] - L.pos[2], v);
  out[0] = v[0]; out[1] = v[1]; out[2] = v[2]; out[3] = Math.hypot(v[0], v[1], v[2]);
  return out as [number, number, number, number];
}

// ───────────────────────────── content tables ─────────────────────────────

interface WeatherKind { id: string; precipType?: string; lightning?: number; wind?: number }
const WEATHER = new Map<string, WeatherKind>();
for (const w of (weatherData as unknown as { weather: WeatherKind[] }).weather) WEATHER.set(w.id, w);

/** weather kinds the client does not know (a freeform-invented weather): judged by name */
function weatherTraits(kind: string): { lightning: number; wind: number } {
  const w = WEATHER.get(kind);
  if (w) return { lightning: w.lightning ?? 0, wind: Math.max(0, w.wind ?? 0) };
  const k = kind.toLowerCase();
  return {
    lightning: /thunder|storm|lightning|hurricane|cyclone/.test(k) ? 6 : 0,
    wind: /hurricane|cyclone|tornado|gale/.test(k) ? 30 : /storm|blizzard|sand|wind/.test(k) ? 14 : 2,
  };
}

interface AnimalKind { id: string; kind: string; body: string; nocturnal?: boolean; size?: number }
const ANIMALS = (animalData as unknown as { animals: AnimalKind[] }).animals;

/** the voice a herd of this species has ('' = silent): grazers low, canines howl, birds cluck, swarms buzz */
export function herdVoice(species: number): { voice: string; nocturnal: boolean; size: number } {
  const a = ANIMALS[species] ?? ANIMALS[species % Math.max(1, ANIMALS.length)];
  if (!a) return { voice: 'grazer', nocturnal: false, size: 1 };
  const b = a.body ?? '';
  const voice = a.kind === 'insect' || b === 'swarm' ? 'swarm'
    : b.includes('canine') ? 'canine'
    : b.includes('equine') ? 'equine'
    : b.includes('woolly') ? 'woolly'
    : b.includes('heavy') ? 'heavy'
    : b.includes('stocky') ? 'stocky'
    : b.startsWith('bird') ? 'fowl'
    : b === 'whale' ? 'whale'
    : b.includes('fish') ? ''
    : b.includes('ray') ? 'ray'
    : b === 'hexapod' || b === 'lizard' ? 'chitter'
    : 'grazer';
  return { voice, nocturnal: !!a.nocturnal, size: a.size ?? 1 };
}

/** per biome (biomes.json order): bird palette weights, night insects, cicadas, frogs */
const BIOME_AUDIO: { birds: Partial<BirdPalette>; insects: number; cicadas: number; frogs: number }[] = [
  { birds: { gull: 0.3 }, insects: 0, cicadas: 0, frogs: 0 },                                   // 0 ocean
  { birds: { gull: 0.6 }, insects: 0, cicadas: 0, frogs: 0 },                                   // 1 reef
  { birds: { gull: 1, song: 0.2 }, insects: 0.3, cicadas: 0.1, frogs: 0.1 },                    // 2 coast
  { birds: { raptor: 0.05 }, insects: 0, cicadas: 0, frogs: 0 },                                // 3 ice
  { birds: { taiga: 0.4 }, insects: 0.3, cicadas: 0, frogs: 0.1 },                              // 4 tundra
  { birds: { taiga: 1, song: 0.3 }, insects: 0.5, cicadas: 0.1, frogs: 0.2 },                   // 5 taiga
  { birds: { lark: 1, song: 0.5 }, insects: 1, cicadas: 0.3, frogs: 0.1 },                      // 6 grassland
  { birds: { song: 1, taiga: 0.2 }, insects: 0.8, cicadas: 0.6, frogs: 0.2 },                   // 7 forest
  { birds: { jungle: 1, song: 0.3 }, insects: 1.2, cicadas: 1, frogs: 0.6 },                    // 8 rainforest
  { birds: { water: 1, song: 0.4 }, insects: 1, cicadas: 0.2, frogs: 1 },                       // 9 wetland
  { birds: { desert: 0.4 }, insects: 0.3, cicadas: 0.4, frogs: 0 },                             // 10 desert
  { birds: { desert: 0.15 }, insects: 0.1, cicadas: 0.1, frogs: 0 },                            // 11 dune
  { birds: { desert: 0.5, lark: 0.4 }, insects: 0.7, cicadas: 0.8, frogs: 0 },                  // 12 scrub
  { birds: { raptor: 0.6, taiga: 0.2 }, insects: 0.2, cicadas: 0, frogs: 0 },                   // 13 mountain
  { birds: { raptor: 0.1 }, insects: 0, cicadas: 0, frogs: 0 },                                 // 14 volcanic
  { birds: {}, insects: 0, cicadas: 0, frogs: 0 },                                              // 15 barren
  { birds: { lark: 0.6, song: 0.4, desert: 0.3 }, insects: 1, cicadas: 1, frogs: 0.1 },         // 16 savanna
  { birds: { lark: 1, raptor: 0.3 }, insects: 0.8, cicadas: 0.3, frogs: 0 },                    // 17 steppe
];

const DISASTER_QUAKE = new Set(['quake', 'sinkhole', 'rift', 'volcano', 'supervolcano', 'moon-fall', 'rogue-flyby']);
const ERA_WORK: Record<string, string> = {
  stone: 'stone', fire: 'stone', clay: 'stone', bronze: 'metal', iron: 'metal', classical: 'metal', medieval: 'metal',
  gunpowder: 'metal', steam: 'machine', electric: 'machine', space: 'machine',
};

// ───────────────────────────── the probe ─────────────────────────────

const N_SAMPLES = 37;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

interface CellCache { version: number; cells: number[] }

/**
 * The probe. Stateful only for caches (the burning / molten cell lists, rebuilt when their field version changes);
 * every result is a function of (world, listener).
 */
export class SceneProbe {
  private fireCache = new Map<number, CellCache>();
  private lavaCache = new Map<number, CellCache>();
  private readonly t3: [number, number, number] = [0, 0, 0];

  probe(w: SceneWorld, L: ListenerState): AudioScene {
    const sc: AudioScene = {
      planet: -1, alt: Math.max(0, L.altitude), radius: 0, inAir: 0, space: 1, airless: true, day: 0, dusk: 0, temp: 0,
      windSpeed: 0, layers: emptyLayers(), birds: emptyBirds(), coast: null, emitters: [], music: [], orbital: 1, hand: null,
      coastBody: null,
    };
    const pv = this.pickPlanet(w, L);
    if (!pv) {
      // between the worlds: the hum of space and the orbital score
      sc.layers.space = 1;
      return sc;
    }
    this.probePlanet(w, pv, L, sc);
    return sc;
  }

  private pickPlanet(w: SceneWorld, L: ListenerState): ScenePlanet | null {
    let best: ScenePlanet | null = null, bestD = Infinity;
    for (const p of w.planets) {
      if (p.alive === false) continue;
      if (p.id === L.planet) return p;
      const d = Math.hypot(L.pos[0] - p.center[0], L.pos[1] - p.center[1], L.pos[2] - p.center[2]) - p.params.radius;
      if (d < p.params.radius * 3 && d < bestD) { bestD = d; best = p; }
    }
    return best;
  }

  private probePlanet(w: SceneWorld, pv: ScenePlanet, L: ListenerState, sc: AudioScene): void {
    const R = pv.params.radius;
    const t = this.t3;
    rotateInv(pv.quat, L.pos[0] - pv.center[0], L.pos[1] - pv.center[1], L.pos[2] - pv.center[2], t);
    const r = Math.hypot(t[0], t[1], t[2]) || 1;
    const dx = t[0] / r, dy = t[1] / r, dz = t[2] / r;
    const F = pv.fields;
    const fWater = F.get('water'), fIce = F.get('ice'), fSurface = F.get('surface');
    const c0 = pv.grid.nearestCell(dx, dy, dz);
    const ground = pv.ground && fSurface ? groundHeight(pv.ground, dx, dy, dz) : R + (fSurface?.[c0] ?? 0);
    const water0 = fWater?.[c0] ?? 0;
    const top = water0 > 0.05 ? Math.max(ground, R + (fSurface?.[c0] ?? 0) + water0) : ground;
    const altW = r - top;
    const alt = Math.max(0, altW);
    sc.planet = pv.id;
    sc.radius = R;
    sc.alt = alt;

    // ── air and space ──
    const P = pv.params.atmosphere?.pressure ?? 0;
    const air = smoothstep(0.015, 0.3, P);
    sc.airless = P < 0.02;
    const atmTop = R * 0.2;
    const space = smoothstep(atmTop * 0.9, atmTop * 3.5, alt);
    sc.space = space;
    sc.inAir = air * (1 - space);
    const inAir = sc.inAir;
    const lay = sc.layers;
    lay.space = space;
    lay.underwater = clamp01(-altW / 1.5) * (water0 > 0.3 ? 1 : 0);

    // ── light ──
    rotateInv(pv.quat, pv.sunDir[0], pv.sunDir[1], pv.sunDir[2], t);
    const sinE = dx * t[0] + dy * t[1] + dz * t[2];
    let light = Math.exp(-Math.max(0, pv.params.atmosphere?.dust ?? 0) * 0.45);
    for (const d of pv.disasters) {
      if (d.kind === 'eclipse') light *= 1 - clamp01(d.params?.coverage ?? 0.8) * 0.9;
      else if (d.kind === 'impact-winter') light *= 0.5;
    }
    sc.day = smoothstep(-0.1, 0.15, sinE) * light;
    sc.dusk = Math.exp(-(((sinE - 0.02) / 0.1) ** 2)) * light;
    const night = 1 - smoothstep(-0.12, 0.05, sinE);

    // ── the field sample: a golden-angle disk around the point under the camera ──
    const S = Math.min(1600, 35 + alt * 0.8);
    const ang = S / R;
    // tangent basis at the sub-camera point
    let ex = dz, ez = -dx;
    let el = Math.hypot(ex, ez);
    if (el < 1e-6) { ex = 1; ez = 0; el = 1; }
    ex /= el; ez /= el;
    const nx = dy * ez, ny = dz * ex - dx * ez, nz = -dy * ex;
    const fBiome = F.get('biome'), fTree = F.get('tree'), fShrub = F.get('shrub'), fGrass = F.get('grass'), fCrop = F.get('crop');
    const fFire = F.get('fire'), fLava = F.get('lava'), fPrecip = F.get('precip'), fPType = F.get('precipType');
    const fWX = F.get('windX'), fWY = F.get('windY'), fWZ = F.get('windZ'), fTemp = F.get('temperature');
    const fSal = F.get('salinity'), fFX = F.get('flowX'), fFY = F.get('flowY'), fFZ = F.get('flowZ');
    const biomeW = new Float64Array(BIOME_AUDIO.length);
    let wSum = 0, wWater = 0, sal = 0, wWaterS = 0, cx = 0, cy = 0, cz = 0;
    let tree = 0, shrub = 0, grass = 0, crop = 0, fire = 0, fireMax = 0, lava = 0, wind = 0, stream = 0;
    const pType = new Float64Array(8);
    let precip = 0;
    for (let i = 0; i < N_SAMPLES; i++) {
      const rho = ang * Math.sqrt((i + 0.5) / N_SAMPLES);
      const th = i * GOLDEN;
      const cr = Math.cos(rho), sr = Math.sin(rho);
      const tx = ex * Math.cos(th) + nx * Math.sin(th), ty = ny * Math.sin(th), tz = ez * Math.cos(th) + nz * Math.sin(th);
      const px = dx * cr + tx * sr, py = dy * cr + ty * sr, pz = dz * cr + tz * sr;
      const c = pv.grid.nearestCell(px, py, pz);
      const wgt = 1 / (1 + (rho / (0.5 * ang)) ** 2);
      wSum += wgt;
      const wat = fWater?.[c] ?? 0;
      const ice = fIce?.[c] ?? 0;
      if (wat > 0.4 && ice < 0.1) {
        wWater += wgt;
        cx += (px - dx) * wgt; cy += (py - dy) * wgt; cz += (pz - dz) * wgt;
        sal += (fSal?.[c] ?? 0) * wgt; wWaterS += wgt;
      } else if (wat > 0.02 && wat < 3 && fFX) {
        const fl = Math.hypot(fFX[c], fFY?.[c] ?? 0, fFZ?.[c] ?? 0);
        stream += clamp01(fl * 6) * clamp01(wat * 2) * wgt;
      }
      const b = fBiome ? Math.round(fBiome[c]) : 15;
      if (b >= 0 && b < biomeW.length) biomeW[b] += wgt;
      tree += (fTree?.[c] ?? 0) * wgt; shrub += (fShrub?.[c] ?? 0) * wgt; grass += (fGrass?.[c] ?? 0) * wgt; crop += (fCrop?.[c] ?? 0) * wgt;
      const fi = fFire?.[c] ?? 0;
      fire += fi * wgt; if (fi * wgt > fireMax) fireMax = fi * wgt;
      lava += clamp01((fLava?.[c] ?? 0) / 0.5) * wgt;
      const pr = fPrecip?.[c] ?? 0;
      if (pr > 0) { precip += pr * wgt; pType[Math.max(0, Math.min(7, Math.round(fPType?.[c] ?? 1)))] += pr * wgt; }
      if (fWX) wind += Math.hypot(fWX[c], fWY?.[c] ?? 0, fWZ?.[c] ?? 0) * wgt;
    }
    const iw = 1 / wSum;
    const wf = wWater * iw;
    // the shore: surf carries for hundreds of metres, so a second, wider ring of samples looks for the waterline — the
    // distance to the nearest sample of the other kind (water seen from land, land seen from the water) and the bearing
    const Ss = Math.min(1600, Math.max(S, 160 + alt * 0.6));
    const angS = Ss / R;
    const c0wet = water0 > 0.4 && (fIce?.[c0] ?? 0) < 0.1;
    let shoreD = Infinity, sx = 0, sy = 0, sz = 0, deep = 0, wetN = 0, salS = 0;
    for (let i = 0; i < 28; i++) {
      const rho = angS * Math.sqrt((i + 0.5) / 28);
      const th = i * GOLDEN + 0.7;
      const cr = Math.cos(rho), sr = Math.sin(rho);
      const tx = ex * Math.cos(th) + nx * Math.sin(th), ty = ny * Math.sin(th), tz = ez * Math.cos(th) + nz * Math.sin(th);
      const px = dx * cr + tx * sr, py = dy * cr + ty * sr, pz = dz * cr + tz * sr;
      const c = pv.grid.nearestCell(px, py, pz);
      const wat = fWater?.[c] ?? 0;
      const wet = wat > 0.4 && (fIce?.[c] ?? 0) < 0.1;
      if (wet) { wetN++; if (wat > 4) deep++; salS += fSal?.[c] ?? 0; sx += px - dx; sy += py - dy; sz += pz - dz; }
      if (wet !== c0wet) shoreD = Math.min(shoreD, rho * R);
    }
    // (open water all round leaves shoreD infinite: that is the sea's swell, not surf)
    const saline = Math.max(wWaterS > 0 ? sal / wWaterS : 0, wetN ? salS / wetN : 0, wetN ? deep / wetN : 0);
    tree *= iw; shrub *= iw; grass *= iw; crop *= iw; fire *= iw; lava *= iw; wind *= iw; stream *= iw; precip *= iw;
    for (let b = 0; b < biomeW.length; b++) biomeW[b] *= iw;
    sc.temp = fTemp?.[c0] ?? 15;
    const temp = sc.temp;

    // weather systems: storms around the listener raise the wind and bring thunder
    let stormWind = 0, thunder = 0, sandStorm = 0, fog = 0;
    const emit: SceneEmitter[] = [];
    for (const wv of pv.weather) {
      const tr = weatherTraits(wv.kind);
      const gd = Math.acos(Math.max(-1, Math.min(1, wv.pos[0] * dx + wv.pos[1] * dy + wv.pos[2] * dz))) * R;
      const inside = gd < wv.radius ? 1 : Math.exp(-(gd - wv.radius) / Math.max(50, wv.radius * 1.5));
      stormWind = Math.max(stormWind, (tr.wind / 30) * wv.intensity * (gd < wv.radius ? 1 : 0));
      thunder += tr.lightning * wv.intensity * inside * 0.45;
      if (wv.kind === 'sandstorm') sandStorm = Math.max(sandStorm, wv.intensity * (gd < wv.radius ? 1 : 0));
      if (wv.kind === 'fog') fog = Math.max(fog, wv.intensity * (gd < wv.radius ? 1 : 0));
      // a storm seen from outside: a wall of rain and wind somewhere over there
      if (gd > wv.radius * 0.8 && gd < wv.radius * 4 && (tr.lightning > 0 || tr.wind >= 9)) {
        const lvl = inAir * wv.intensity * Math.exp(-(gd - wv.radius * 0.8) / Math.max(60, wv.radius * 1.2)) * 0.8;
        if (lvl > 0.02) this.pushEmitter(emit, pv, L, `wx:${wv.id}`, 'storm', wv.kind, wv.pos, 260, lvl, wv.radius, wv.intensity, 0);
      }
    }
    sc.windSpeed = wind;

    // ── the layers ──
    const nearS = 1 / (1 + (alt / 160) ** 2);
    const midS = 1 / (1 + (alt / 450) ** 2);
    const farS = 1 / (1 + (alt / 900) ** 2);
    const windN = clamp01(wind / 20);
    const altWind = smoothstep(15, 520, alt);
    lay.wind = inAir * clamp01(0.14 + 0.55 * windN + 0.5 * altWind + 0.6 * stormWind);
    lay.windPitch = clamp01(windN * 0.6 + altWind * 0.45 + stormWind * 0.4 + (temp < -5 ? 0.15 : 0));
    lay.gust = clamp01(0.25 + windN * 0.6 + stormWind * 0.5);
    // waves break at the waterline: as loud as it is near (a lake laps, the sea pounds; wind and storms raise it)
    const edge = Number.isFinite(shoreD) ? attenuate(Math.hypot(shoreD, alt), 70 + 0.4 * alt) * (wetN > 1 || c0wet ? 1 : 0.5) : 0;
    lay.surf = inAir * clamp01(edge * 1.3) * (0.35 + 0.65 * clamp01(saline)) * (0.6 + 0.4 * windN + 0.4 * stormWind);
    lay.sea = inAir * midS * smoothstep(0.72, 1, wf) * (0.45 + 0.4 * windN + 0.5 * stormWind);
    if (!c0wet && wetN) { cx = sx; cy = sy; cz = sz; }
    if ((wf > 0.03 || wetN) && (cx || cy || cz)) {
      // shore direction: body-frame offset → system → listener-local
      const cl = Math.hypot(cx, cy, cz);
      if (cl > 1e-12) sc.coastBody = [cx / cl, cy / cl, cz / cl];
      const v = [0, 0, 0];
      rotate(pv.quat, cx, cy, cz, v);
      rotateInv(L.quat, v[0], v[1], v[2], v);
      const l = Math.hypot(v[0], v[1], v[2]);
      if (l > 1e-9) sc.coast = [v[0] / l, v[1] / l, v[2] / l];
    }

    const veg = clamp01(tree + shrub * 0.8 + grass * 0.6 + crop * 0.5);
    const ground01 = clamp01(grass + shrub + crop * 0.8);
    let birdiness = 0, insectB = 0, cicadaB = 0, frogB = 0;
    const birds = sc.birds;
    for (let b = 0; b < biomeW.length; b++) {
      const bw = biomeW[b];
      if (bw <= 0) continue;
      const ba = BIOME_AUDIO[b];
      for (const k of Object.keys(ba.birds) as (keyof BirdPalette)[]) { const v = (ba.birds[k] ?? 0) * bw; birds[k] += v; birdiness += v; }
      insectB += ba.insects * bw; cicadaB += ba.cicadas * bw; frogB += ba.frogs * bw;
    }
    if (birdiness > 0) for (const k of Object.keys(birds) as (keyof BirdPalette)[]) birds[k] /= birdiness;
    // gulls follow the sea wherever the biome map draws the line
    if (wetN && saline > 0.2) { birds.gull = Math.max(birds.gull, 0.5 * edge); birdiness = Math.max(birdiness, 0.6 * edge); }
    const precipK = clamp01(1 - Math.exp(-precip / 3));
    const ptot = pType[1] + pType[2] + pType[3] + pType[4] + pType[5] + pType[6] + pType[7] || 1;
    const under = alt < 420 ? 1 : 1 - smoothstep(420, 900, alt);
    const pr = (k: number): number => inAir * under * precipK * (pType[k] / ptot);
    lay.rain = pr(1) + pr(5) + pr(6);
    lay.snow = pr(2);
    lay.hail = pr(3);
    lay.ash = pr(4);
    lay.acid = pr(5);
    lay.blood = pr(6);
    lay.sand = clamp01(pr(7) + inAir * sandStorm * nearS * 1.2);
    const wet = clamp01(lay.rain * 1.2 + lay.hail);
    const dayChorus = clamp01(sc.day + sc.dusk * 0.6);
    const life = Math.sqrt(veg);
    lay.birds = inAir * nearS * dayChorus * life * clamp01(birdiness) * (1 - 0.85 * wet) * (temp > -8 ? 1 : 0.25) * (1 - 0.5 * stormWind);
    lay.insects = inAir * nearS * night * ground01 * smoothstep(7, 18, temp) * clamp01(insectB) * (1 - 0.8 * wet);
    lay.cicadas = inAir * nearS * sc.day * clamp01(tree + shrub) * smoothstep(21, 30, temp) * clamp01(cicadaB) * (1 - wet);
    lay.frogs = inAir * nearS * clamp01(night + sc.dusk * 0.5) * clamp01(frogB + wf * veg * 0.6 * (1 - saline)) * smoothstep(9, 16, temp) * (1 - 0.5 * wet);
    lay.stream = inAir * nearS * clamp01(stream * 3);
    lay.fire = clamp01((fire * 1.5 + fireMax * 2) * midS) * (sc.airless ? 0.35 : 1);
    lay.lava = clamp01(lava * 1.6) * midS;
    lay.thunderRate = inAir * Math.min(8, thunder) * farS;
    lay.hush = clamp01(lay.snow * 0.7 + fog * 0.5 + lay.underwater);
    // an airless world: no wind, no birds, no rain — only what the body hears of itself
    lay.heartbeat = sc.airless ? (1 - space) * (1 - lay.underwater) : 0;

    // ── point sources ──
    const ref = (base: number): number => hearingRef(base, alt);
    // settlements: crowds, and the cultures whose music plays here
    let crowdAmb = 0;
    let towns = 0;
    const musicNear = 1 / (1 + (alt / 1100) ** 2);
    for (const st of pv.settlements) {
      if (st.flags & SettlementFlag.fallen || st.population <= 0) continue;
      towns++;
      const pop = st.population;
      const size = 25 + 9 * Math.sqrt(pop);
      const loc = this.localOf(pv, L, st.pos, 3);
      const d = loc[3];
      const intrinsic = clamp01(0.25 + Math.log10(1 + pop) / 2.6);
      const lvl = inAir * intrinsic * attenuate(d, ref(size));
      const gd = Math.acos(Math.max(-1, Math.min(1, st.pos[0] * dx + st.pos[1] * dy + st.pos[2] * dz))) * R;
      const inside = 1 - smoothstep(size * 0.5, size * 1.4, gd);
      crowdAmb = Math.max(crowdAmb, inside * intrinsic * midS * inAir);
      if (lvl > 0.01) emit.push({ key: `st:${st.id}`, kind: 'crowd', sub: ERA_WORK[st.era] ?? 'stone', local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: d, level: clamp01(lvl), size: pop, param: st.flags, spread: inside * 0.6 });
      const mw = musicNear * attenuate(d, size * 1.6 + 0.6 * alt) * (sc.airless ? 0.6 : 1);
      if (mw > 0.02) {
        const pan = Math.max(-1, Math.min(1, loc[0] / Math.max(1, Math.hypot(loc[0], loc[2]))));
        sc.music.push({
          key: `st:${st.id}`, weight: mw, pan,
          culture: {
            id: st.id, language: st.language, species: st.species, mode: st.music?.mode, tempo: st.music?.tempo,
            instruments: st.music?.instruments, alignment: st.alignment, era: st.era, population: pop, age: st.age ?? '',
            war: !!(st.flags & SettlementFlag.atWar) || !!(st.war && st.war.length) || !!st.besieged,
          },
        });
      }
    }
    lay.crowd = clamp01(crowdAmb);
    sc.music.sort((a, b) => b.weight - a.weight);
    if (sc.music.length > 3) sc.music.length = 3;
    // the orbital score in space, and softly over a world nobody lives on yet (the opening's barren rock)
    const nearestTown = sc.music[0]?.weight ?? 0;
    sc.orbital = Math.max(space, towns === 0 ? 0.32 : 0) * (1 - clamp01(nearestTown * 1.5));
    if (space > 0.5) sc.orbital = space;

    // fires: the hottest burning clusters near the listener
    if (fFire) {
      const cells = this.cellList(this.fireCache, pv, 'fire', fFire, 0.04);
      this.topCells(emit, pv, L, cells, fFire, 3, 'fire', alt, (v) => v, 30, inAir);
    }
    if (fLava) {
      const cells = this.cellList(this.lavaCache, pv, 'lava', fLava, 0.05);
      this.topCells(emit, pv, L, cells, fLava, 2, 'lava', alt, (v) => clamp01(v / 0.6), 45, 1 - space);
    }
    // disasters: every live one is a source; quakes also shake the ground under the listener
    for (const d of pv.disasters) {
      const h = d.kind === 'meteor' || d.kind === 'comet' || d.kind === 'moon-fall' ? Math.max(0, d.params?.alt ?? 0) : d.kind === 'tornado' || d.kind === 'hurricane' ? 120 : 2;
      const loc = this.localOf(pv, L, d.pos, h);
      const gd = Math.acos(Math.max(-1, Math.min(1, d.pos[0] * dx + d.pos[1] * dy + d.pos[2] * dz))) * R;
      const inside = 1 - smoothstep(d.radius * 0.6, d.radius * 1.3, gd);
      const carrier = d.kind === 'solar-flare' || d.kind === 'magnetic-storm' || d.kind === 'eclipse' || d.kind === 'rogue-flyby' ? 1 : Math.max(inAir, 0.25);
      const lvl = carrier * clamp01(0.35 + 0.65 * Math.min(1.5, d.intensity)) * Math.max(inside, attenuate(loc[3], ref(60 + d.radius)));
      if (lvl > 0.01) emit.push({ key: `dis:${d.id}`, kind: 'disaster', sub: d.kind, local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: loc[3], level: clamp01(lvl), size: d.intensity, param: d.progress, spread: inside });
      if (DISASTER_QUAKE.has(d.kind) && !d.frozen) lay.quake = Math.max(lay.quake, clamp01(d.intensity) * Math.max(inside, attenuate(gd, d.radius * 2)) * (d.kind === 'quake' || d.kind === 'sinkhole' ? 1 : 0.6));
    }
    // the creature(s)
    for (const c of w.creatures ?? []) {
      if (c.planet !== pv.id) continue;
      const loc = this.localOf(pv, L, c.pos, c.height * 0.5);
      const lvl = Math.max(inAir, 0.2) * clamp01(0.35 + c.height / 25) * attenuate(loc[3], ref(25 + c.height * 2));
      if (lvl > 0.01) emit.push({ key: `cr:${c.id}`, kind: 'creature', sub: c.body, local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: loc[3], level: clamp01(lvl), size: c.height, param: c.anim, spread: 0 });
    }
    // ships on this world: building, fuelling, the launch itself, the descent
    for (const s of w.ships ?? []) {
      if (s.planet !== pv.id) continue;
      const base = s.phase === 'ascent' ? 1 : s.phase === 'descent' ? 0.9 : s.phase === 'fuelling' ? 0.35 : s.phase === 'building' ? 0.4
        : s.phase === 'boarding' || s.phase === 'pad' ? 0.2 : s.phase === 'sailing' ? 0.3 : 0;
      if (base <= 0) continue;
      const loc = this.localOf(pv, L, s.pos, Math.max(0, s.alt));
      const big = s.phase === 'ascent' || s.phase === 'descent';
      const lvl = Math.max(big ? 0.5 : 0, inAir) * base * attenuate(loc[3], ref(big ? 900 : 60));
      if (lvl > 0.01) emit.push({ key: `ship:${s.id}`, kind: 'ship', sub: s.phase, local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: loc[3], level: clamp01(lvl), size: s.alt, param: s.progress, spread: 0 });
    }
    // herds: the two nearest groups of animals with a voice
    const A = pv.animals;
    if (A && A.count && inAir > 0.05) {
      const best = new Map<number, { d: number; i: number; n: number }>();
      const reach = ref(70);
      for (let i = 0; i < A.count; i++) {
        const x = A.pos[i * 3], y = A.pos[i * 3 + 1], z = A.pos[i * 3 + 2];
        const gd = Math.acos(Math.max(-1, Math.min(1, x * dx + y * dy + z * dz))) * R;
        if (gd > reach * 3) continue;
        const g = A.group[i];
        const e = best.get(g);
        if (!e) best.set(g, { d: gd, i, n: 1 });
        else { e.n++; if (gd < e.d) { e.d = gd; e.i = i; } }
      }
      const herds = [...best.entries()].sort((a, b) => a[1].d - b[1].d).slice(0, 2);
      for (const [g, e] of herds) {
        const hv = herdVoice(A.species[e.i]);
        if (!hv.voice) continue;
        const loc = this.localOf(pv, L, [A.pos[e.i * 3], A.pos[e.i * 3 + 1], A.pos[e.i * 3 + 2]], Math.max(0, A.alt[e.i]) + 1);
        const lvl = inAir * clamp01(0.3 + Math.log2(1 + e.n) / 6) * attenuate(loc[3], reach);
        if (lvl > 0.015) emit.push({ key: `herd:${g}`, kind: 'herd', sub: hv.voice, local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: loc[3], level: clamp01(lvl), size: e.n, param: hv.nocturnal ? 1 : 0, spread: 0 });
      }
    }
    // the hand
    const hand = w.hand;
    if (hand && hand.planet === pv.id) {
      const loc = this.localOf(pv, L, hand.pos, Math.max(0, hand.alt));
      sc.hand = { local: [loc[0], loc[1], loc[2]], dist: loc[3], pose: hand.pose, held: !!hand.held, body: this.lastBody, unit: [hand.pos[0], hand.pos[1], hand.pos[2]] };
    }
    emit.sort((a, b) => b.level - a.level);
    if (emit.length > 24) emit.length = 24;
    sc.emitters = emit;
  }

  /**
   * listener-local position of a point `h` metres above the ground at body-frame direction `u` (any length), and its
   * distance: [x, y, z, d]
   */
  localOf(pv: ScenePlanet, L: ListenerState, u: ArrayLike<number>, h: number): [number, number, number, number] {
    const b = bodyPoint(pv, u, h);
    this.lastBody = b;
    return toLocal(pv, L, b);
  }

  /** the body-frame point of the last localOf (emitters keep it) */
  lastBody: [number, number, number] = [0, 0, 0];

  private pushEmitter(
    out: SceneEmitter[], pv: ScenePlanet, L: ListenerState, key: string, kind: EmitterKind, sub: string, u: ArrayLike<number>,
    h: number, level: number, size: number, param: number, spread: number,
  ): void {
    const loc = this.localOf(pv, L, u, h);
    out.push({ key, kind, sub, local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: loc[3], level: clamp01(level), size, param, spread });
  }

  /** cells of a field above a threshold, rebuilt only when the field's version changes */
  private cellList(cache: Map<number, CellCache>, pv: ScenePlanet, f: FieldName, arr: Float32Array, min: number): number[] {
    const v = pv.fieldVersion?.get(f) ?? -1;
    const c = cache.get(pv.id);
    if (c && c.version === v && v >= 0) return c.cells;
    const cells: number[] = [];
    for (let i = 0; i < arr.length; i++) if (arr[i] > min) cells.push(i);
    cache.set(pv.id, { version: v, cells });
    return cells;
  }

  /** the k loudest cells of a field at the listener, at least ~60 m apart, as emitters (with the cluster size) */
  private topCells(
    out: SceneEmitter[], pv: ScenePlanet, L: ListenerState, cells: number[], arr: Float32Array, k: number, kind: EmitterKind,
    alt: number, level: (v: number) => number, base: number, carrier: number,
  ): void {
    if (!cells.length || carrier <= 0) return;
    const P = pv.grid.pos;
    const R = pv.params.radius;
    const t = this.t3;
    rotateInv(pv.quat, L.pos[0] - pv.center[0], L.pos[1] - pv.center[1], L.pos[2] - pv.center[2], t);
    const r = Math.hypot(t[0], t[1], t[2]) || 1;
    const lx = t[0] / r, ly = t[1] / r, lz = t[2] / r;
    const reach = hearingRef(base, alt);
    const scored: { c: number; s: number }[] = [];
    for (const c of cells) {
      const dot = P[c * 3] * lx + P[c * 3 + 1] * ly + P[c * 3 + 2] * lz;
      const gd = Math.acos(Math.max(-1, Math.min(1, dot))) * R;
      const d = Math.hypot(gd, alt);
      const s = level(arr[c]) * attenuate(d, reach);
      if (s > 0.004) scored.push({ c, s });
    }
    scored.sort((a, b) => b.s - a.s);
    const picked: number[] = [];
    const minSep = Math.cos(60 / R);
    for (const e of scored) {
      if (picked.length >= k) break;
      let ok = true;
      for (const p of picked) if (P[p * 3] * P[e.c * 3] + P[p * 3 + 1] * P[e.c * 3 + 1] + P[p * 3 + 2] * P[e.c * 3 + 2] > minSep) { ok = false; break; }
      if (!ok) continue;
      picked.push(e.c);
      // cluster: how much burns / flows around it (a roar's depth)
      let size = 0;
      const near = Math.cos(120 / R);
      for (const c of cells) if (P[c * 3] * P[e.c * 3] + P[c * 3 + 1] * P[e.c * 3 + 1] + P[c * 3 + 2] * P[e.c * 3 + 2] > near) size += arr[c];
      const u = [P[e.c * 3], P[e.c * 3 + 1], P[e.c * 3 + 2]];
      const loc = this.localOf(pv, L, u, kind === 'fire' ? 3 : 0.5);
      out.push({ key: `${kind}:${e.c}`, kind, sub: kind, local: [loc[0], loc[1], loc[2]], body: this.lastBody, dist: loc[3], level: clamp01(e.s * 1.4 * carrier), size, param: arr[e.c], spread: loc[3] < 25 ? 0.5 : 0 });
    }
  }
}
