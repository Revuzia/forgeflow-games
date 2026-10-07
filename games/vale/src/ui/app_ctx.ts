// VALE UI — app context (catalog view, session, state, router, sound, overlays) shared by every
// screen and component through one Preact context.

import { createContext, type ComponentChildren, type VNode } from 'preact';
import { useContext } from 'preact/hooks';
import { signal } from '@preact/signals';
import type { Session } from '../contracts/session.ts';
import type { CatalogView } from './catalog_view.ts';
import type { AppState } from './state.ts';
import type { Router } from './router.ts';
import type { UiSound } from './audio_port.ts';

export interface ModalSpec {
  id: number;
  title?: string;
  size?: 's' | 'm' | 'l';
  /** false: Esc/scrim do not close it (the ready check) */
  dismissable?: boolean;
  tone?: 'normal' | 'urgent';
  render: (close: () => void) => ComponentChildren;
  onClose?: () => void;
  /** element to restore focus to */
  returnFocus?: HTMLElement | null;
}
export interface TipSpec { key: string; rect: DOMRect; content: () => VNode | ComponentChildren; place?: 'right' | 'left' | 'above' | 'below'; wide?: boolean }

export class Overlay {
  readonly modals = signal<ModalSpec[]>([]);
  readonly tip = signal<TipSpec | null>(null);
  private seq = 1;

  open(spec: Omit<ModalSpec, 'id'>): number {
    const id = this.seq++;
    const returnFocus = spec.returnFocus ?? (document.activeElement as HTMLElement | null);
    this.tip.value = null;
    this.modals.value = [...this.modals.value, { ...spec, id, returnFocus }];
    return id;
  }
  close(id?: number): void {
    const list = this.modals.value;
    const m = id === undefined ? list[list.length - 1] : list.find((x) => x.id === id);
    if (!m) return;
    this.modals.value = list.filter((x) => x !== m);
    m.onClose?.();
    const rf = m.returnFocus;
    if (rf && document.contains(rf)) setTimeout(() => rf.focus({ preventScroll: true }), 0);
  }
  get top(): ModalSpec | undefined { const l = this.modals.value; return l[l.length - 1]; }

}

export interface AppCtx {
  cv: CatalogView;
  session: Session;
  state: AppState;
  router: Router;
  sound: UiSound;
  overlay: Overlay;
  /** true when a renderer draws the 3D menu scene behind the UI */
  hasScene: boolean;
}

export const AppContext = createContext<AppCtx>(null as unknown as AppCtx);
export const useApp = (): AppCtx => useContext(AppContext);
