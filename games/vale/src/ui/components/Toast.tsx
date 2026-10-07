// VALE UI — toasts (≤ 60 characters, no exclamation marks). Top-right under the bar, entering from the
// right; at most three; errors carry the HARM rule.

import type { JSX } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { animateIn } from '../motion.ts';
import type { Toast } from '../state.ts';
import { Icon } from './Glyphs.tsx';

function ToastView(p: { t: Toast }): JSX.Element {
  const { state } = useApp();
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { animateIn(el.current, { from: 'right', d: 'base' }); }, []);
  const icon = p.t.tone === 'ok' ? 'check' : p.t.tone === 'warn' ? 'warn' : p.t.tone === 'error' ? 'danger' : null;
  return (
    <div ref={el} class={`toast plate plate--raised toast--${p.t.tone}`} role={p.t.tone === 'error' ? 'alert' : 'status'}>
      {icon ? <Icon name={icon} class="toast__icon" /> : null}
      <span class="t-body-s toast__text">{p.t.text}</span>
      {p.t.action ? <button type="button" class="toast__act t-label" onClick={() => { p.t.action!.run(); state.dismissToast(p.t.id); }}>{p.t.action.label}</button> : null}
    </div>
  );
}

export function ToastStack(): JSX.Element {
  const { state } = useApp();
  return <div class="toasts" aria-live="polite">{state.toasts.value.map((t) => <ToastView key={t.id} t={t} />)}</div>;
}
