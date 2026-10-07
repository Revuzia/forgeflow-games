// VALE UI — keybind capture. Enter/click arms it ("Press a key"); the next key (KeyboardEvent.code,
// modifiers included) or mouse button 3–5 is captured; Esc cancels. The parent resolves conflicts
// (it knows every bind) and passes `conflict` to show the ▲ warning chip.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { keyLabel } from '../keys.ts';
import { Icon } from './Glyphs.tsx';

export function KeybindCapture(p: { code: string; onChange: (code: string) => void; label: string; conflict?: string; isDefault?: boolean }): JSX.Element {
  const { sound } = useApp();
  const [armed, setArmed] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!armed) return;
    const key = (e: KeyboardEvent): void => {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.code === 'Escape') { setArmed(false); sound.play('back'); return; }
      setArmed(false);
      sound.play('confirm');
      p.onChange(e.code);
    };
    const mouse = (e: PointerEvent): void => {
      if (e.button >= 3 && e.button <= 4) { e.preventDefault(); setArmed(false); sound.play('confirm'); p.onChange(`Mouse${e.button}`); }
      else if (!btn.current?.contains(e.target as Node)) setArmed(false);
    };
    addEventListener('keydown', key, true);
    addEventListener('pointerdown', mouse, true);
    return () => { removeEventListener('keydown', key, true); removeEventListener('pointerdown', mouse, true); };
  }, [armed]);

  return (
    <span class="kbind">
      <button ref={btn} type="button" class={`kbind__btn ${armed ? 'is-armed' : ''} ${p.conflict ? 'is-conflict' : ''}`}
        aria-label={`${p.label}: ${armed ? 'press a key, Esc to cancel' : keyLabel(p.code)}`}
        onPointerDown={() => sound.play('click')} onClick={() => setArmed(!armed)}>
        {armed ? <span class="kbind__wait t-caption">Press a key</span> : <span class="kbind__key num">{keyLabel(p.code)}</span>}
      </button>
      {p.conflict ? <span class="kbind__warn t-caption"><Icon name="warn" class="kbind__warnicon" />{p.conflict}</span> : null}
    </span>
  );
}
