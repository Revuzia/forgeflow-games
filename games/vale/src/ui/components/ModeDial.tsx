// VALE UI — the Mode Dial (bible §Menu mood): the stations of catalog.client.modeSlots along the arc of
// a dial — RIFT three roads crossed by the noon line, BRIDGE one line over an arc, FRAY a ring of ten
// ticks, and the uncarved hour (dashed, focusable, never selectable). Choosing swings the gnomon shadow
// CLOCKWISE to the station in 360 ms. Modes get no colour: mark, station and motif tell them apart.
// Arrow keys move between stations; Enter or Space chooses.

import type { JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import type { ModeSlotT } from '../catalog_view.ts';
import { ModeMarkGlyph } from './Glyphs.tsx';
import { TipText, useTip } from './Tooltip.tsx';

const W = 1000, H = 330, CX = 500, CY = 360, R = 300;

function stationAngles(n: number): number[] {
  if (n <= 1) return [0];
  const span = Math.min(126, 42 * (n - 1));
  return Array.from({ length: n }, (_, i) => -span / 2 + (span * i) / (n - 1));
}

function Station(p: { slot: ModeSlotT; angle: number; selected: boolean; onPick: () => void }): JSX.Element {
  const { cv, sound } = useApp();
  const mode = cv.mode(p.slot.mode);
  const reserved = !mode || p.slot.status === 'reserved';
  const rad = (p.angle * Math.PI) / 180;
  const x = CX + R * Math.sin(rad), y = CY - R * Math.cos(rad);
  const name = mode?.name ?? p.slot.label ?? cv.t('state.reserved.title', 'The uncarved hour');
  const note = p.slot.note ?? (reserved ? cv.t('state.reserved.body', 'A new mode will be cut here.') : mode?.tagline);
  const tip = useTip(reserved ? () => <TipText text={cv.t('state.locked.reserved', 'A new mode will be cut here.')} sub={name} /> : null, { place: 'below' });
  return (
    <button type="button" class={`station ${p.selected ? 'is-selected' : ''} ${reserved ? 'is-reserved' : ''}`}
      style={{ left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%` }}
      role="radio" aria-checked={p.selected} aria-disabled={reserved ? 'true' : undefined}
      aria-label={`${name}. ${note ?? ''}`} data-nav=""
      onPointerEnter={(e) => { tip.onPointerEnter(e); sound.play('hover'); }} onPointerLeave={tip.onPointerLeave} onFocus={tip.onFocus} onBlur={tip.onBlur}
      onPointerDown={() => sound.play(reserved ? 'error' : 'tab')}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!reserved) p.onPick(); else sound.play('error'); } }}
      onClick={() => { if (!reserved) p.onPick(); }}>
      <span class="station__disc">
        <ModeMarkGlyph mark={reserved ? 'uncarved' : cv.modeMark(mode)} lanes={cv.laneCount(mode)} ticks={cv.seatsOf(mode)} size="62%" />
      </span>
      <span class={`station__name ${reserved ? 't-caption' : 't-label'}`}>{reserved ? name : mode!.name}</span>
      {p.selected ? <span class="station__tick" aria-hidden="true" /> : null}
    </button>
  );
}

export function ModeDial(p: { value: string | null; onChange: (mode: string) => void }): JSX.Element {
  const { cv, sound } = useApp();
  const slots = cv.c.client.modeSlots;
  const angles = stationAngles(slots.length);
  const idx = Math.max(0, slots.findIndex((s) => s.mode === p.value));
  // forward is clockwise: the gnomon only ever turns clockwise (a "back" choice swings on round the
  // hidden half of the dial) — the angle accumulates instead of taking the short way
  const acc = useRef<number | null>(null);
  const target = angles[idx] ?? 0;
  if (acc.current === null) acc.current = target;
  else if (((acc.current % 360) + 360) % 360 !== ((target % 360) + 360) % 360) {
    let next = target;
    while (next < acc.current) next += 360;
    acc.current = next;
  }
  const gnomon = acc.current;
  const ticks = Array.from({ length: 25 }, (_, i) => -84 + i * 7);
  return (
    <div class="dial" role="radiogroup" aria-label={cv.t('play.mode_dial', 'Mode Dial')} data-arrownav="row">
      <svg class="dial__svg" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" preserveAspectRatio="xMidYMid meet">
        <path d={`M ${CX - R * Math.sin(1.48)} ${CY - R * Math.cos(1.48)} A ${R} ${R} 0 0 1 ${CX + R * Math.sin(1.48)} ${CY - R * Math.cos(1.48)}`} class="dial__arc" />
        {ticks.map((a) => {
          const r = (a * Math.PI) / 180;
          const long = (a + 84) % 21 === 0;
          return <line x1={CX + (R + 14) * Math.sin(r)} y1={CY - (R + 14) * Math.cos(r)} x2={CX + (R + (long ? 30 : 22)) * Math.sin(r)} y2={CY - (R + (long ? 30 : 22)) * Math.cos(r)} class="dial__tick" />;
        })}
        <g class="dial__gnomon" style={{ transform: `rotate(${gnomon}deg)`, transformOrigin: `${CX}px ${CY}px` }}>
          <polygon points={`${CX},${CY} ${CX - 9},${CY - R + 62} ${CX + 9},${CY - R + 62}`} class="dial__shadow" />
          <line x1={CX} y1={CY} x2={CX} y2={CY - R + 62} class="dial__edge" />
        </g>
        <circle cx={CX} cy={CY - 2} r="7" class="dial__pin" />
      </svg>
      {slots.map((s, i) => (
        <Station slot={s} angle={angles[i]} selected={i === idx && !!s.mode && s.status !== 'reserved'}
          onPick={() => { if (s.mode && s.mode !== p.value) { sound.play('toggle'); p.onChange(s.mode); } }} />
      ))}
    </div>
  );
}
