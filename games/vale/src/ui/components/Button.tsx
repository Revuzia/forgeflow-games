// VALE UI — buttons. Variants: `chalk` (THE primary CTA: one per screen, bottom-right of the UI zone;
// chalk plate, ink text, a 30° shadow line sweeps it on hover), `secondary` (ink plate), `quiet`
// (text), `icon` (square). States per bible: hover = keyboard focus (+ 2 px chalk ring, 2 px ink gap),
// pressed 1 px down with sound on POINTERDOWN, selected keeps a chalk hour-tick, disabled always says
// why (aria-disabled, stays focusable, tooltip), locked = dashed border + unlock path, never grey.

import type { ComponentChildren, JSX, Ref } from 'preact';
import { useApp } from '../app_ctx.ts';
import type { UiCueKind } from '../audio_port.ts';
import { Icon, Wedge, type IconName } from './Glyphs.tsx';
import { TipText, useTip } from './Tooltip.tsx';

export interface ButtonProps {
  variant?: 'chalk' | 'secondary' | 'quiet' | 'icon';
  size?: 's' | 'm' | 'l';
  /** disabled: `reason` is mandatory and shown on hover/focus */
  disabled?: boolean;
  reason?: string;
  /** locked: the unlock path ("Reach level 20") */
  locked?: string;
  selected?: boolean;
  onPress?: (e: Event) => void;
  /** sound on pointerdown; default 'click' ('confirm' for chalk); null = silent */
  cue?: UiCueKind | null;
  icon?: IconName;
  iconAfter?: IconName;
  wedge?: boolean;
  label?: string;
  tip?: string;
  class?: string;
  id?: string;
  autoFocus?: boolean;
  nav?: boolean;
  type?: 'button' | 'submit';
  innerRef?: Ref<HTMLButtonElement>;
  children?: ComponentChildren;
  [k: `data-${string}`]: string | number | boolean | undefined;
}

export function Button(p: ButtonProps): JSX.Element {
  const { sound } = useApp();
  const v = p.variant ?? 'secondary';
  const inert = !!p.disabled || !!p.locked;
  const tipText = p.disabled ? p.reason ?? 'Not available right now.' : p.locked ? null : p.tip ?? (v === 'icon' ? p.label ?? null : null);
  const tip = useTip(tipText ? () => <TipText text={tipText} /> : p.locked ? () => <TipText text={p.locked!} /> : null);
  const cue: UiCueKind | null = p.cue === undefined ? (v === 'chalk' ? 'confirm' : 'click') : p.cue;
  const fire = (e: Event): void => {
    if (inert) { e.preventDefault(); return; }
    p.onPress?.(e);
  };
  const press = (): void => {
    if (inert) { sound.play('error', 200); return; }
    if (cue) sound.play(cue);
  };
  const dataProps: Record<string, unknown> = {};
  for (const k of Object.keys(p)) if (k.startsWith('data-')) dataProps[k] = (p as Record<string, unknown>)[k];
  return (
    <button
      ref={p.innerRef}
      id={p.id}
      type={p.type ?? 'button'}
      class={`btn btn--${v} btn--${p.size ?? 'm'} ${p.selected ? 'is-selected' : ''} ${p.disabled ? 'is-disabled' : ''} ${p.locked ? 'is-locked' : ''} ${p.class ?? ''}`}
      aria-disabled={inert ? 'true' : undefined}
      aria-pressed={p.selected === undefined ? undefined : p.selected}
      aria-label={p.label}
      autoFocus={p.autoFocus}
      data-nav={p.nav ? '' : undefined}
      {...dataProps}
      onPointerDown={(e) => { if (e.button === 0) press(); }}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) press(); }}
      onClick={fire}
      onPointerEnter={(e) => { tip.onPointerEnter(e); if (!inert) sound.play('hover'); }}
      onPointerLeave={tip.onPointerLeave}
      onFocus={tip.onFocus}
      onBlur={tip.onBlur}
    >
      {p.locked ? <Icon name="lock" class="btn__lock" /> : p.icon ? <Icon name={p.icon} class="btn__icon" /> : null}
      {v !== 'icon' && (p.children !== undefined || p.locked) ? (
        <span class="btn__label">
          {p.children}
          {p.locked && v !== 'quiet' ? <span class="btn__path">{p.locked}</span> : null}
        </span>
      ) : null}
      {p.iconAfter ? <Icon name={p.iconAfter} class="btn__icon" /> : null}
      {p.wedge ? <Wedge class="btn__wedge" /> : null}
    </button>
  );
}

/** Back, top-left of the UI zone (Esc does the same) */
export function BackButton(p: { onPress: () => void; label?: string }): JSX.Element {
  const { sound } = useApp();
  return (
    <button type="button" class="back" onPointerDown={() => sound.play('back')} onKeyDown={(e) => { if (e.key === 'Enter') sound.play('back'); }}
      onClick={p.onPress} aria-label={p.label ?? 'Back'} data-back="">
      <Icon name="back" class="back__icon" />
      <span class="back__label t-label">{p.label ?? 'Back'}</span>
      <span class="keycap keycap--quiet">Esc</span>
    </button>
  );
}
