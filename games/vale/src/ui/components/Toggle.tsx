// VALE UI — toggle (role=switch). A 100 ms state change; on = chalk knob on a lit track.

import type { JSX } from 'preact';
import { useApp } from '../app_ctx.ts';

export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label: string; id?: string; disabled?: string; showState?: boolean }): JSX.Element {
  const { sound } = useApp();
  const flip = (): void => { if (p.disabled) { sound.play('error', 200); return; } p.onChange(!p.checked); };
  return (
    <button type="button" role="switch" id={p.id} aria-checked={p.checked} aria-label={p.label} aria-disabled={p.disabled ? 'true' : undefined}
      title={p.disabled} class={`toggle ${p.checked ? 'is-on' : ''}`}
      onPointerDown={() => sound.play('toggle')} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') sound.play('toggle'); }}
      onClick={flip}>
      <span class="toggle__track"><span class="toggle__knob" /></span>
      {p.showState !== false ? <span class="toggle__state t-label">{p.checked ? 'On' : 'Off'}</span> : null}
    </button>
  );
}
