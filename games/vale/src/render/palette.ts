// VALE render — readability colours (STYLE_BIBLE "Palette", tokens.json `team`, `fray`, `damage`).
//
// "Stone tells you whose land; light tells you whose side." Every relationship colour the renderer
// draws (accents, bars, rings, telegraphs, team-keyed VFX) comes from here, resolved for ONE viewer:
//   self (Noonwhite) · ally (Dawn azure) · enemy / HARM (Dusk marigold) · neutral (Dialstone)
// with the deutan / protan / tritan alternates from Settings.access.colorblind. FRAY (free-for-all,
// detected from the mode's rules kind, never from an id) gives every other seat its seat colour and
// keeps the local player Noonwhite. Spectators (you < 0) see side colours (azure ▲ / marigold ◠).
//
// Colours are returned as THREE.Color in the LINEAR working space (Color.setStyle converts the sRGB
// hex). Overlays render after the grade into a linear buffer and the last pass encodes to sRGB, so an
// opaque overlay pixel is exactly the bible hex.

import { Color } from 'three';
import type { CatalogT, ModeDefT } from '../contracts/catalog.ts';
import type { MatchSetup, PlayerId, TeamId } from '../contracts/sim.ts';

export type Relation = 'self' | 'ally' | 'enemy' | 'neutral';
export type ColorblindMode = 'off' | 'deutan' | 'protan' | 'tritan';

/** tokens.json `team` + `team.colorblind` (sRGB hex). */
export const TEAM_HEX: Readonly<Record<ColorblindMode, Readonly<Record<'self' | 'ally' | 'enemy' | 'neutral' | 'a' | 'b', string>>>> = {
  off: { self: '#F4EFE2', ally: '#3F9CFF', enemy: '#FF9A1F', neutral: '#A9A49A', a: '#3F9CFF', b: '#FF9A1F' },
  deutan: { self: '#FBF8F0', ally: '#2FA8FF', enemy: '#FFC21F', neutral: '#A9A49A', a: '#2FA8FF', b: '#FFC21F' },
  protan: { self: '#FBF8F0', ally: '#3F9CFF', enemy: '#FFC21F', neutral: '#A9A49A', a: '#3F9CFF', b: '#FFC21F' },
  tritan: { self: '#FBF8F0', ally: '#2FA8FF', enemy: '#FF3D6E', neutral: '#A9A49A', a: '#2FA8FF', b: '#FF3D6E' },
};

/** tokens.json `fray` — seat colour, glyph and keyline (identical for every viewer). */
export const FRAY_SEATS: readonly { color: string; glyph: string; keyline: 'chalk' | 'ink' | 'none' }[] = [
  { color: '#B2354A', glyph: '●', keyline: 'chalk' }, { color: '#767305', glyph: '▲', keyline: 'chalk' },
  { color: '#D9FF17', glyph: '○', keyline: 'ink' }, { color: '#20A04E', glyph: '✚', keyline: 'none' },
  { color: '#26F3FF', glyph: '■', keyline: 'ink' }, { color: '#19AFFE', glyph: '⧗', keyline: 'none' },
  { color: '#7273F5', glyph: '☾', keyline: 'none' }, { color: '#8121FC', glyph: '✖', keyline: 'chalk' },
  { color: '#993F94', glyph: '▬', keyline: 'chalk' }, { color: '#DC6294', glyph: '◆', keyline: 'none' },
];

/** UI / overlay ink and chalk (tokens.json `colors`). */
export const INK = {
  ink0: '#0B0D11', ink1: '#11141A', ink2: '#171B22', chalk: '#EDE6D6', chalkHi: '#FFF8EA', noonwhite: '#F4EFE2',
  shield: '#DCE8EE', heal: '#63D88B', physical: '#F1E2C6', magic: '#FF7BD5', trueDmg: '#101216', fogTint: '#2A3140',
} as const;

export function linear(hex: string): Color { return new Color().setStyle(hex); }

export interface ViewerInfo {
  you: PlayerId;          // < 0: spectator
  team: TeamId;           // the viewer's team (−1 spectator)
  ffa: boolean;
}

/** FFA = a mode whose end rule is last-standing or whose pick is per-seat (never an id check). */
export function isFfaMode(mode: ModeDefT | undefined): boolean {
  if (!mode) return false;
  return mode.rules.end.kind === 'last_standing_or_score' || mode.pick === 'ffa_pick' || (mode.teams > 2 && mode.perTeam === 1);
}

export class Palette {
  readonly viewer: ViewerInfo;
  private cvd: ColorblindMode = 'off';
  private readonly seatHex: string[];
  private readonly teamOfSeat = new Map<PlayerId, TeamId>();
  private readonly seatOfPlayer = new Map<PlayerId, number>();
  private readonly cache = new Map<string, Color>();

  constructor(catalog: CatalogT, setup: MatchSetup | null, you: PlayerId, colorblind: ColorblindMode = 'off') {
    const mode = setup ? catalog.modes.find((m) => m.id === setup.mode) : undefined;
    const ffa = isFfaMode(mode);
    const seat = setup?.seats.find((s) => s.player === you);
    this.viewer = { you: seat ? you : -1, team: seat ? seat.team : -1, ffa };
    this.seatHex = (mode?.playerColors && mode.playerColors.length > 0 ? mode.playerColors : FRAY_SEATS.map((s) => s.color)).slice();
    for (const s of setup?.seats ?? []) { this.teamOfSeat.set(s.player, s.team); this.seatOfPlayer.set(s.player, s.colorIndex); }
    this.cvd = colorblind;
  }

  setColorblind(mode: ColorblindMode): void { if (mode !== this.cvd) { this.cvd = mode; this.cache.clear(); } }
  get colorblind(): ColorblindMode { return this.cvd; }

  /** relationship of a unit (team, owning seat) to the viewer */
  relation(team: TeamId, owner: PlayerId | -1, isFighter: boolean): Relation {
    if (team < 0) return 'neutral';
    if (isFighter && owner >= 0 && owner === this.viewer.you) return 'self';
    if (this.viewer.team < 0) return team === 0 ? 'ally' : 'enemy'; // spectator: side a = azure, b = marigold
    if (this.viewer.ffa) return team === this.viewer.team ? 'ally' : 'enemy';
    return team === this.viewer.team ? 'ally' : 'enemy';
  }

  /** the bible hex for a relationship */
  relationHex(r: Relation): string { return TEAM_HEX[this.cvd][r]; }
  relationColor(r: Relation): Color { return this.get(TEAM_HEX[this.cvd][r]); }

  /**
   * The readability colour of a unit: relationship colour in team modes; in FRAY a fighter (or a
   * unit owned by a seat) other than you shows its seat colour; spectators see side colours.
   */
  unitHex(team: TeamId, owner: PlayerId | -1, isFighter: boolean): string {
    const r = this.relation(team, owner, isFighter);
    if (r === 'self' || r === 'neutral') return this.relationHex(r);
    if (this.viewer.ffa && owner >= 0) return this.seatHexOf(owner);
    if (this.viewer.team < 0) return TEAM_HEX[this.cvd][team === 0 ? 'a' : 'b'];
    return this.relationHex(r);
  }
  unitColor(team: TeamId, owner: PlayerId | -1, isFighter: boolean): Color { return this.get(this.unitHex(team, owner, isFighter)); }

  seatHexOf(player: PlayerId): string {
    const idx = this.seatOfPlayer.get(player) ?? player;
    return this.seatHex[((idx % this.seatHex.length) + this.seatHex.length) % this.seatHex.length];
  }
  seatGlyph(player: PlayerId): string {
    const idx = this.seatOfPlayer.get(player) ?? player;
    return FRAY_SEATS[((idx % FRAY_SEATS.length) + FRAY_SEATS.length) % FRAY_SEATS.length].glyph;
  }
  get ffa(): boolean { return this.viewer.ffa; }

  /** cached linear colour for a hex */
  get(hex: string): Color {
    let c = this.cache.get(hex);
    if (!c) { c = linear(hex); this.cache.set(hex, c); }
    return c;
  }
}
