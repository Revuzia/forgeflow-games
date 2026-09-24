// DYEFIELD — typed access to data/*.json (CONTRACT §4.1). THREE-free; works in Vite and in Node
// (type stripping + JSON import attributes). Data is the tuning truth: code reads numbers from here.

import mapsJson from '../../../data/maps.json' with { type: 'json' };
import teamsJson from '../../../data/teams.json' with { type: 'json' };
import weaponsJson from '../../../data/weapons.json' with { type: 'json' };
import type { Side, TeamId } from './types.ts';

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
  courtLines?: { centerCircleRadius: number; midLineZ: number; color: string; width: number };
  lighting?: { default: string; presets: Record<string, LightingPreset> };
  brushes?: unknown[];
  design?: unknown;
}

export interface TeamDef {
  id: TeamId; key: string; side: Side; name: string;
  dye: string; dyeDeep: string; dyeGloss: string; ui: string; uiInk: string;
  mark: string; markGlyph: string;
}

export const MAPS: MapDef[] = (mapsJson as unknown as { maps: MapDef[] }).maps;
export const TEAMS: TeamDef[] = (teamsJson as unknown as { teams: TeamDef[] }).teams;
export const TEAMS_RAW = teamsJson as unknown as Record<string, unknown>;
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
