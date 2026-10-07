// VALE UI — fighter card: portrait, name, class mass glyph, role. States: hover/focus, selected
// (chalk border + hour-tick), intent (an ally hovers it: dashed relationship rim), locked (dashed
// border + the unlock path, never grey), banned (shadowed with a struck wedge), taken (who took it).

import type { JSX } from 'preact';
import { useApp } from '../app_ctx.ts';
import type { FighterDefT } from '../catalog_view.ts';
import { ClassGlyph, classShapeOf, Icon } from './Glyphs.tsx';
import { Portrait } from './Portrait.tsx';
import { AbilityTip, TipText, useTip } from './Tooltip.tsx';
import type { UiCueKind } from '../audio_port.ts';

export function ClassMark(p: { classId: string; size?: number; withName?: boolean }): JSX.Element | null {
  const { cv } = useApp();
  const c = cv.cls(p.classId);
  const shape = classShapeOf(c?.shape, c?.name);
  if (!c) return null;
  return (
    <span class="classmark" title={c.name}>
      {shape ? <ClassGlyph shape={shape} size={p.size ?? 14} /> : <span class="classmark__init">{c.name.slice(0, 1)}</span>}
      {p.withName ? <span class="classmark__name">{c.name}</span> : null}
    </span>
  );
}

export interface FighterCardProps {
  fighter: FighterDefT;
  skin?: string;
  size?: 's' | 'm' | 'l';
  selected?: boolean;
  /** an ally (or you) is hovering it */
  intent?: 'self' | 'ally' | 'enemy' | null;
  /** not available: the reason/unlock path; `lockedKind` picks the treatment */
  locked?: string | null;
  lockedKind?: 'locked' | 'banned' | 'taken';
  owned?: boolean;
  showRole?: boolean;
  onPress?: () => void;
  onHover?: () => void;
  cue?: UiCueKind;
  tip?: boolean;
}

export function FighterCard(p: FighterCardProps): JSX.Element {
  const { cv, sound } = useApp();
  const f = p.fighter;
  const role = cv.role(f.role);
  const inert = !!p.locked;
  const tip = useTip(p.tip === false ? null : p.locked ? () => <TipText text={p.locked!} sub={f.name} /> : () => (
    <div class="tipx">
      <div class="tipx__head"><span class="t-h2">{f.name}</span></div>
      <div class="t-caption tipx__kind">{[cv.cls(f.class)?.name, role?.name].filter(Boolean).join(' · ')}</div>
      <p class="t-body-s tipx__desc">{f.job}</p>
    </div>
  ), { place: 'right' });
  const kind = p.locked ? (p.lockedKind ?? 'locked') : null;
  return (
    <button type="button"
      class={`fcard fcard--${p.size ?? 'm'} ${p.selected ? 'is-selected' : ''} ${p.intent ? `is-intent is-intent--${p.intent}` : ''} ${kind ? `is-${kind}` : ''}`}
      aria-pressed={p.selected ?? false} aria-disabled={inert ? 'true' : undefined}
      aria-label={`${f.name}${role ? `, ${role.name}` : ''}${p.locked ? `. ${p.locked}` : ''}`}
      data-nav=""
      onPointerDown={() => (inert ? sound.play('error', 200) : sound.play(p.cue ?? 'click'))}
      onPointerEnter={(e) => { tip.onPointerEnter(e); if (!inert) { sound.play('hover_fighter'); p.onHover?.(); } }}
      onPointerLeave={tip.onPointerLeave}
      onFocus={(e) => { tip.onFocus(e); if (!inert) p.onHover?.(); }}
      onBlur={tip.onBlur}
      onClick={() => { if (!inert) p.onPress?.(); }}>
      <Portrait fighter={f} skin={p.skin} size="fill" class="fcard__portrait" />
      {kind === 'banned' ? <span class="fcard__ban" aria-hidden="true"><Icon name="close" /></span> : null}
      {kind === 'locked' ? <span class="fcard__lock" aria-hidden="true"><Icon name="lock" /></span> : null}
      <span class="fcard__meta">
        <span class="fcard__name">{f.name}</span>
        {p.showRole !== false ? (
          <span class="fcard__sub">
            <ClassMark classId={f.class} size={12} />
            {role ? <span class="fcard__role">{role.name}</span> : null}
          </span>
        ) : null}
        {kind === 'taken' && p.locked ? <span class="fcard__taken">{p.locked}</span> : null}
      </span>
      {p.selected ? <span class="fcard__tick" aria-hidden="true" /> : null}
    </button>
  );
}

export { AbilityTip };
