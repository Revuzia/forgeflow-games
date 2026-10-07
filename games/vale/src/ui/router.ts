// VALE UI — router: a stack of { screen, params } with a transition direction. Screens live in the
// registry (screens/index.ts) keyed by screen id; nav entries come from catalog.client.nav.
// Forward = clockwise = the new screen enters from the right; back enters from the left. The
// shadow-line wipe is reserved for client ↔ match (draft → loading, match → post-game).

import { signal } from '@preact/signals';

export interface Route { screen: string; params: Record<string, string>; key: number }
export type Transition = 'forward' | 'back' | 'fade' | 'wipe' | 'none';

let keySeq = 1;
const mk = (screen: string, params: Record<string, string> = {}): Route => ({ screen, params, key: keySeq++ });

export class Router {
  readonly route = signal<Route>(mk('home'));
  readonly transition = signal<Transition>('none');
  private stack: Route[] = [];
  private readonly home: string;
  /** screens may veto leaving (unsaved changes, draft dodge) */
  guard: ((to: string) => boolean) | null = null;

  constructor(home = 'home') {
    this.home = home;
    this.route.value = mk(home);
    this.stack = [this.route.value];
  }

  get depth(): number { return this.stack.length; }
  canGoBack(): boolean { return this.stack.length > 1; }

  /** push a screen (forward). `root: true` = a top-level nav jump: the stack becomes [home, screen]. */
  go(screen: string, params: Record<string, string> = {}, o: { root?: boolean; replace?: boolean; transition?: Transition } = {}): void {
    if (this.guard && !this.guard(screen)) return;
    const cur = this.route.value;
    if (cur.screen === screen && JSON.stringify(cur.params) === JSON.stringify(params)) return;
    const r = mk(screen, params);
    if (o.root) this.stack = screen === this.home ? [r] : [this.stack[0]?.screen === this.home ? this.stack[0] : mk(this.home), r];
    else if (o.replace) this.stack[this.stack.length - 1] = r;
    else this.stack.push(r);
    this.transition.value = o.transition ?? (o.root && screen === this.home ? 'back' : 'forward');
    this.route.value = r;
  }

  /** replace the whole stack (match flow: draft, loading, match, post-game own the screen) */
  reset(screen: string, params: Record<string, string> = {}, transition: Transition = 'fade'): void {
    const r = mk(screen, params);
    this.stack = screen === this.home ? [r] : [mk(this.home), r];
    this.transition.value = transition;
    this.route.value = r;
  }

  back(): boolean {
    if (this.stack.length <= 1) return false;
    const to = this.stack[this.stack.length - 2];
    if (this.guard && !this.guard(to.screen)) return false;
    this.stack.pop();
    this.transition.value = 'back';
    this.route.value = { ...to, key: keySeq++ };
    this.stack[this.stack.length - 1] = this.route.value;
    return true;
  }

  /** update the params of the current route without a transition (tabs, selections worth keeping) */
  setParams(params: Record<string, string>): void {
    const r = { ...this.route.value, params: { ...this.route.value.params, ...params } };
    this.stack[this.stack.length - 1] = r;
    this.transition.value = 'none';
    this.route.value = r;
  }
}
