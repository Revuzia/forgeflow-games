// DYEFIELD — typed access to data/*.json (CONTRACT §4.1). THREE-free; works in Vite and in Node
// (type stripping + JSON import attributes). Data is the tuning truth: code reads numbers from here.

import mapsJson from '../../../data/maps.json' with { type: 'json' };
import teamsJson from '../../../data/teams.json' with { type: 'json' };
import weaponsJson from '../../../data/weapons.json' with { type: 'json' };
import type { MatchMode, Side, TeamId } from './types.ts';

export type V3 = [number, number, number];

export interface LightingPreset {
  sunElevationDeg: number; sunAzimuthDeg: number; sunColor: string; sunIntensity: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  skyZenith: string; skyHorizon: string;
  fogColor: string; fogDensity: number; exposure: number;
  waterDeep: string; waterShallow: string;
}

export interface MapDef {
  id: string;
  status: 'built' | 'planned';
  name: string;
  type: string;
  tagline: string;
  favors: string[];
  symmetry: string;
  bounds?: { min: V3; max: V3 };
  killY?: number;
  waterY?: number;
  paint?: { texelsPerMeter: number; atlasMax: number };
  scoring?: { wallWeight: number; floorMinNy: number };
  minimap?: { min: [number, number]; max: [number, number] };
  spawns?: Record<Side, { pos: V3; yaw: number }>;
  /** CHANGED(CORE) (CONTRACT_FFA §F1): the 8 FFA drop-pad spawns, yaw in DEGREES (written by _harness/gen_ffa_spawns.ts) */
  ffaSpawns?: Array<{ pos: V3; yaw: number }>;
  /** CHANGED(SPAWNS) (CONTRACT_FFA_SPAWNS §S1): the FFA spawn-site POOL (16–24 per map, sized to its floor area; the first 8
   *  = ffaSpawns), yaw in DEGREES facing the map's open centre (written by _harness/gen_ffa_spawns.ts --count auto --write) */
  ffaSites?: Array<{ pos: V3; yaw: number }>;
  courtLines?: { centerCircleRadius: number; midLineZ: number; color: string; width: number };
  lighting?: { default: string; presets: Record<string, LightingPreset> };
  brushes?: unknown[];
  design?: unknown;
  /** CHANGED(WASHOUT) (CONTRACT_WASHOUT §W1): this map's WASHOUT score limits (TEAMS / FREE-FOR-ALL), tuned per map with
   *  `npm run probe:washout:tune`; a missing / bad value falls back to data/weapons.json → washout (world.ts washoutLimitFor) */
  washout?: { teamLimit?: number; ffaLimit?: number };
}

export interface TeamDef {
  id: TeamId; key: string; side: Side; name: string;
  dye: string; dyeDeep: string; dyeGloss: string; ui: string; uiInk: string;
  mark: string; markGlyph: string;
}

/** CHANGED(CORE) (CONTRACT_FFA §F6): a crew of either mode — a teams.json team (side set) or an FFA crew (no side;
 *  `name` is only the colour label for UI chips, the crew's shown name is its runner's). */
export interface CrewDef {
  id: TeamId; key: string; side?: Side; name: string;
  dye: string; dyeDeep: string; dyeGloss: string; ui: string; uiInk: string;
  mark: string; markGlyph: string;
}

export const MAPS: MapDef[] = (mapsJson as unknown as { maps: MapDef[] }).maps;
export const TEAMS: TeamDef[] = (teamsJson as unknown as { teams: TeamDef[] }).teams;
export const TEAMS_RAW = teamsJson as unknown as Record<string, unknown>;
/** CHANGED(CORE): teams.json → ffa, the 8 FFA crews (ids 1..8, ascending) */
export const FFA_CREWS: CrewDef[] = ((teamsJson as unknown as { ffa?: CrewDef[] }).ffa ?? []).slice().sort((a, b) => a.id - b.id);
export const WEAPONS = weaponsJson as unknown as {
  hp: number; respawnSeconds: number;
  kits: Array<Record<string, unknown> & { id: string; name: string; role: string; model: string; sub: string; special: string; stats: Record<string, number> }>;
  subs: Array<Record<string, unknown> & { id: string; name: string }>;
  specials: Array<Record<string, unknown> & { id: string; name: string }>;
  specialCharge: Record<string, number>;
};

export function mapById(id: string): MapDef {
  const m = MAPS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown map id '${id}' (data/maps.json has: ${MAPS.map((x) => x.id).join(', ')})`);
  return m;
}

/** Only maps whose status is 'built' may be offered to players (maps.json _doc). */
export function playableMaps(): MapDef[] {
  return MAPS.filter((m) => m.status === 'built');
}

export function teamById(id: TeamId): TeamDef {
  const t = TEAMS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown team id ${id}`);
  return t;
}

/** a crew's dye (sRGB hex): teams.json, or its `colorblind` block when Settings → Colorblind marks is on.
 *  CHANGED(CORE): crewDyeHex(mode, team, colorblind) is the FFA-aware form; the old crewDyeHex(team, colorblind) means
 *  teams mode. FFA crews have no colorblind swap (their marks carry identity). */
export function crewDyeHex(mode: MatchMode, team: TeamId, colorblind: boolean): string;
export function crewDyeHex(team: TeamId, colorblind: boolean): string;
export function crewDyeHex(a: MatchMode | TeamId, b: TeamId | boolean, c?: boolean): string {
  const mode: MatchMode = typeof a === 'string' ? a : 'teams';
  const team = (typeof a === 'string' ? b : a) as TeamId;
  const colorblind = typeof a === 'string' ? !!c : !!b;
  if (mode === 'ffa') return crewDef('ffa', team).dye;
  const t = teamById(team);
  if (colorblind) {
    const cb = (TEAMS_RAW.colorblind as Record<string, { dye?: unknown }> | undefined)?.[t.key];
    if (cb && typeof cb.dye === 'string') return cb.dye;
  }
  return t.dye;
}

/** CHANGED(CORE): a crew's palette entry in `mode` (teams → teams.json teams; ffa → teams.json ffa). 0 / unknown throws. */
export function crewDef(mode: MatchMode, team: TeamId): CrewDef {
  if (mode !== 'ffa') return teamById(team);
  const c = FFA_CREWS.find((x) => x.id === team);
  if (!c) throw new Error(`unknown FFA crew id ${team} (teams.json ffa has: ${FFA_CREWS.map((x) => x.id).join(', ')})`);
  return c;
}

/** CHANGED(CORE): the crew ids of a mode (teams [1, 2] · ffa [1..8]) */
export function crewIds(mode: MatchMode): TeamId[] {
  return mode === 'ffa' ? FFA_CREWS.map((c) => c.id) : TEAMS.map((t) => t.id).sort((x, y) => x - y);
}

export function teamBySide(side: Side): TeamDef {
  const t = TEAMS.find((x) => x.side === side);
  if (!t) throw new Error(`no team on side ${side}`);
  return t;
}

/** '#RRGGBB' → [r,g,b] 0..1 (sRGB, not linearised). */
export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
