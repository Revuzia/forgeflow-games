// core/types.ts — Neon Veil shared type definitions.
//
// This is a *type-only* module. It was elided from the shipped JS bundle
// (types carry no runtime code), so the sourcemap could not recover it.
// It has been reconstructed from how every type is USED across the codebase:
//   - WEAPONS / MAPS / DEFAULT_SETTINGS in core/config.ts (field shapes)
//   - PlayerState fields in net/LocalBotAdapter.ts (makePlayer) + ai/AIPilot.ts + hud/HUD.ts
//   - GameMode / SessionConfig in Game.ts + ui/Menu.ts
//   - MapId / MapStyle unions in world/*.ts switches
//   - KillEvent in net/LocalBotAdapter.ts (onKill)

/** Weapon identifiers — the keys of WEAPONS in core/config.ts. */
export type WeaponId = 'plasma' | 'rocket' | 'rail' | 'laser' | 'torpedo' | 'scatter';

/** Arena / biome identifiers — the keys of MAPS in core/config.ts. */
export type MapId = 'sky-city' | 'the-pit' | 'cloud-sea' | 'upper-atmo' | 'deep-space';

/**
 * Visual/gameplay style of a map. Drives world generation (CityGenerator)
 * and atmosphere (BiomeAtmosphere). Values come from the `style` field of
 * every entry in MAPS and the `case` labels of the world switches.
 */
export type MapStyle = 'open' | 'pit' | 'clouds' | 'atmo' | 'space';

/**
 * Selectable game modes. 'multiplayer' + 'outlaw' are the menu data-mode
 * values; 'freeroam' is the default (Game.mode initialiser + the else branch
 * of startSession).
 */
export type GameMode = 'freeroam' | 'multiplayer' | 'outlaw';

/** Team id: 0 = free-for-all (no team); 1 / 2 = the two teams in team modes. */
export type TeamId = 0 | 1 | 2;

/** 3-component tuple [x, y, z]. */
export type Vec3 = [number, number, number];

/** Quaternion tuple [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** User-tunable settings (see DEFAULT_SETTINGS + ui/Menu SettingsUI). */
export interface Settings {
  mouseSens: number;
  volume: number;
  invertY: boolean;
  mute: boolean;
}

/** Static weapon definition (see WEAPONS in core/config.ts). */
export interface WeaponDef {
  id: WeaponId;
  name: string;
  damage: number;
  fireRate: number;
  projectileSpeed: number;
  splashRadius: number;
  /** -1 = infinite ammo (plasma). */
  ammo: number;
  heatPerShot: number;
  selfDamageScale: number;
  /** Hex color for the projectile / bolt. */
  color: number;
  /** Hex color for the trail. */
  trailColor: number;
}

/** Static map / arena definition (see MAPS in core/config.ts). */
export interface MapDef {
  id: MapId;
  name: string;
  bounds: number;
  minAlt: number;
  maxAlt: number;
  fogColor: number;
  fogDensity: number;
  ambient: number;
  sunColor: number;
  sunIntensity: number;
  skyTop: number;
  skyBottom: number;
  style: MapStyle;
  hasGround: boolean;
  /** Candidate spawn positions, each [x, y, z]. */
  spawnPoints: Vec3[];
}

/**
 * Per-pilot replicated state (local player + bots). Every field is populated
 * by LocalBotAdapter.makePlayer; AIPilot / HUD / Game read + mutate them.
 */
export interface PlayerState {
  id: string;
  callsign: string;
  team: TeamId;
  /** World position [x, y, z]. */
  position: Vec3;
  /** Orientation quaternion [x, y, z, w]. */
  rotation: Quat;
  /** Linear velocity [x, y, z]. */
  velocity: Vec3;
  health: number;
  shield: number;
  shieldDeployed: boolean;
  weapon: WeaponId;
  kills: number;
  deaths: number;
  score: number;
  alive: boolean;
  isBot: boolean;
  ping: number;
  /** Online: true = a remote human, driven by wire packets (skip local AI/sim). */
  netRemote?: boolean;
}

/** Launch parameters handed from the menu to Game.startSession. */
export interface SessionConfig {
  callsign: string;
  mode: GameMode;
  mapId: MapId;
}

/** Kill notification delivered to the net adapter (INetAdapter.onKill). */
export interface KillEvent {
  killerId: string;
  victimId: string;
  /** Weapon that scored the kill, when known. */
  weaponId?: WeaponId;
}
