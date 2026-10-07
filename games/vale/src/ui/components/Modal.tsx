// VALE UI — modals. A scrim (ink 80%, no blur) and a plate that enters from 0.98 scale with `dawn` and
// leaves with `dusk` at 0.7×. Focus is trapped inside and restored on close; Esc closes unless the
// modal is not dismissable (the ready check). `confirmDialog` is the ConfirmDialog (one chalk action).

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useApp, type ModalSpec, type Overlay } from '../app_ctx.ts';
import { animateIn, animateOut } from '../motion.ts';
import { Button } from './Button.tsx';
import { Icon } from './Glyphs.tsx';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"]), [role="slider"]';

function ModalView(p: { m: ModalSpec; closing: boolean; onGone: () => void; top: boolean }): JSX.Element {
  const { overlay } = useApp();
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    animateIn(scrim.current, { from: 'none', d: 'base' });
    animateIn(panel.current, { from: 'scale', d: 'base' });
    const first = panel.current?.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!p.closing) return;
    Promise.all([animateOut(panel.current, { from: 'scale', d: 'base' }), animateOut(scrim.current, { from: 'none', d: 'base' })]).then(p.onGone);
  }, [p.closing]);
  const trap = (e: KeyboardEvent): void => {
    if (e.key !== 'Tab' || !panel.current) return;
    const els = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); els[els.length - 1].focus(); }
    else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
  };
  const close = (): void => overlay.close(p.m.id);
  return (
    <div class={`modal-layer ${p.m.tone === 'urgent' ? 'modal-layer--urgent' : ''}`} aria-hidden={p.top ? undefined : 'true'}>
      <div ref={scrim} class="modal-scrim" onClick={() => { if (p.m.dismissable !== false) close(); }} />
      <div ref={panel} class={`modal plate plate--raised modal--${p.m.size ?? 'm'}`} role="dialog" aria-modal="true" aria-label={p.m.title} tabIndex={-1} onKeyDown={trap}>
        {p.m.title ? (
          <header class="modal__head">
            <h2 class="t-display-m modal__title">{p.m.title}</h2>
            {p.m.dismissable !== false ? <Button variant="icon" icon="close" label="Close" cue="back" onPress={close} class="modal__x" /> : null}
          </header>
        ) : null}
        <div class="modal__body">{p.m.render(close)}</div>
      </div>
    </div>
  );
}

export function ModalHost(): JSX.Element {
  const { overlay } = useApp();
  const live = overlay.modals.value;
  const [gone, setGone] = useState<ModalSpec[]>([]);
  const prev = useRef<ModalSpec[]>([]);
  useEffect(() => {
    const removed = prev.current.filter((m) => !live.includes(m));
    if (removed.length) setGone((g) => [...g, ...removed]);
    prev.current = live;
  }, [live]);
  const all = [...live.map((m) => ({ m, closing: false })), ...gone.map((m) => ({ m, closing: true }))];
  return (
    <>
      {all.map(({ m, closing }) => (
        <ModalView key={m.id} m={m} closing={closing} top={m === live[live.length - 1]} onGone={() => setGone((g) => g.filter((x) => x !== m))} />
      ))}
    </>
  );
}

export function ConfirmBody(p: { body?: ComponentChildren; confirm: string; cancel: string; tone: 'normal' | 'danger'; onConfirm: () => void; onCancel: () => void }): JSX.Element {
  return (
    <div class="confirm">
      {p.body ? <div class="confirm__body t-body">{p.body}</div> : null}
      <div class="confirm__actions">
        <Button variant="quiet" cue="back" onPress={p.onCancel}>{p.cancel}</Button>
        <Button variant="chalk" wedge onPress={p.onConfirm} data-autofocus="">{p.confirm}</Button>
      </div>
    </div>
  );
}

/** ConfirmDialog: resolves true when the player confirms */
export function confirmDialog(overlay: Overlay, o: { title: string; body?: ComponentChildren; confirm: string; cancel?: string; tone?: 'normal' | 'danger' }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    overlay.open({
      title: o.title, size: 's',
      onClose: () => { if (!done) { done = true; resolve(false); } },
      render: (close) => (
        <ConfirmBody body={o.body} confirm={o.confirm} cancel={o.cancel ?? 'Cancel'} tone={o.tone ?? 'normal'}
          onConfirm={() => { if (!done) { done = true; resolve(true); } close(); }}
          onCancel={() => { if (!done) { done = true; resolve(false); } close(); }} />
      ),
    });
  });
}

export function InfoIcon(): JSX.Element { return <Icon name="info" />; }
