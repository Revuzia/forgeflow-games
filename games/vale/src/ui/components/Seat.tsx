// VALE UI — FRAY seat marks and team marks for lists (draft, loading, post-game). FRAY seats are
// identical for every viewer: colour + glyph (bible table), the roman numeral drawn in code (the
// strings file cannot hold "VI"). You are drawn in Noonwhite with your glyph and your seat colour as a
// line. Options: Standard · Stamp-forward (glyph 150 %, fill 60 %) · Simple colours (every other seat
// in HARM with its glyph).

import type { CSSProperties, JSX } from 'preact';
import { useApp } from '../app_ctx.ts';
import { TOKENS } from '../tokens.ts';
import { SeatGlyph, seatToken, TeamMark } from './Glyphs.tsx';

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const roman = (seat: number): string => ROMAN[seat - 1] ?? String(seat);

/** seat 1..10 from a player index / colorIndex */
export const seatOf = (colorIndex: number): number => (colorIndex % TOKENS.fray.length) + 1;

export function seatStyle(seat: number, you: boolean, mode: 'standard' | 'stamp' | 'simple'): CSSProperties {
  const t = seatToken(seat);
  const color = you ? 'var(--team-self)' : mode === 'simple' ? 'var(--team-enemy)' : t.color;
  return { '--seat': color, '--seat-own': t.color, '--seat-fill': mode === 'stamp' && !you ? '0.6' : '1' } as CSSProperties;
}

export function SeatMark(p: { seat: number; you?: boolean; size?: number; showNumeral?: boolean; class?: string }): JSX.Element {
  const { state, cv } = useApp();
  const mode = state.frayColors.value;
  const t = seatToken(p.seat);
  const scale = mode === 'stamp' && !p.you ? 1.5 : 1;
  const color = p.you ? TOKENS.team.self : mode === 'simple' ? undefined : t.color;
  const name = cv.t(`fray.seat.${p.seat}`, t.name);
  return (
    <span class={`seatmark ${p.you ? 'is-you' : ''} ${p.class ?? ''}`} style={seatStyle(p.seat, !!p.you, mode)}
      title={cv.t('fray.seat.label', 'Seat {roman} · {color}', { roman: roman(p.seat), color: name })}>
      <span class="seatmark__glyph" style={mode === 'simple' && !p.you ? { color: 'var(--team-enemy)' } : undefined}>
        <SeatGlyph seat={p.seat} size={(p.size ?? 18) * scale} color={color ?? 'currentColor'} keyline={!p.you} title={`${roman(p.seat)} ${name}`} />
      </span>
      {p.showNumeral !== false ? <span class="seatmark__num num">{roman(p.seat)}</span> : null}
    </span>
  );
}

/** a team's side mark with its name (spectator-style absolute marks: Aubade ▲ spire, Serenade ◠ dome) */
export function SideMark(p: { team: number; you?: boolean; withName?: boolean }): JSX.Element {
  const { cv } = useApp();
  const side = p.team === 0 ? TOKENS.team.a : TOKENS.team.b;
  const name = cv.t(p.team === 0 ? 'team.aubade' : 'team.serenade', side.name);
  return (
    <span class={`sidemark sidemark--${p.team === 0 ? 'a' : 'b'}`}>
      <TeamMark team={p.team === 0 ? 0 : 1} size={14} title={name} />
      {p.withName ? <span class="t-caption">{name}</span> : null}
    </span>
  );
}
