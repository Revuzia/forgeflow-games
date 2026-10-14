// VALE UI — the app shell (CONTRACT §10). `mount(root, opts)` renders the client over the canvas:
//   top bar (Back top-left + Esc, the VALE mark, nav from catalog.client.nav, wallet, profile chip),
//   the screen host (routes from screens/index.ts; forward enters from the right = clockwise, back from
//   the left, the 30° shadow-line wipe for client ↔ match only), modals, tooltips, toasts, and the
//   frame loop that pumps the live MatchClient (and draws the renderer, when one is attached).
// Scale: --k = uiScale (0.8–1.5) × viewport factor; colourblind palettes via <html data-cvd>; reduced
// motion from the setting OR the OS preference. Music beds follow the route (AudioPort.music, optional).

import { render, type ComponentType, type JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { effect, signal } from '@preact/signals';
import type { CatalogT } from '../contracts/catalog.ts';
import type { MatchClient, Session } from '../contracts/session.ts';
import { AppContext, handleEsc, Overlay, useApp, type AppCtx } from './app_ctx.ts';
import { musicId, recordingPort, UiSound, type AudioPort } from './audio_port.ts';
import { CatalogView } from './catalog_view.ts';
import { loadFonts } from './fonts.ts';
import { animateIn, animateOut, reducedMotion } from './motion.ts';
import { Router, type Route, type Transition } from './router.ts';
import { AppState, type RendererPort } from './state.ts';
import { TOKENS } from './tokens.ts';
import { SCREENS, type ScreenDef } from './screens/index.ts';
import { BackButton } from './components/Button.tsx';
import { Currency } from './components/Currency.tsx';
import { Icon } from './components/Glyphs.tsx';
import { ModalHost } from './components/Modal.tsx';
import { NewDot } from './components/Plate.tsx';
import { ToastStack } from './components/Toast.tsx';
import { TooltipLayer } from './components/Tooltip.tsx';
import { arrowNav } from './components/arrownav.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';

export interface MountOptions {
  catalog: CatalogT;
  session: Session;
  audio?: AudioPort | null;
  /** the 3D renderer (CONTRACT §9) when one is attached; the UI draws its own backdrop otherwise */
  renderer?: RendererPort | null;
  /** catalog AssetRef → URL (LoadedCatalog.assetUrl) */
  assetUrl?: (ref: string) => string;
  /** pump the live MatchClient from the UI's frame loop (default true; false when boot owns the loop) */
  pumpMatch?: boolean;
  /** dev build (?dev=1): exposes window.__vale for the harness */
  dev?: boolean;
}

export interface MountedApp { state: AppState; router: Router; unmount(): void }

/** mount the client into `root` (CONTRACT §3.5 step 3) */
export function mount(root: HTMLElement, o: MountOptions): MountedApp {
  const cv = new CatalogView(o.catalog, o.assetUrl);
  const router = new Router('home');
  const port = o.dev ? recordingPort(o.audio ?? null) : o.audio ?? null;
  const sound = new UiSound(port);
  const overlay = new Overlay();
  const state = new AppState({ session: o.session, cv, router, sound, renderer: o.renderer ?? null });
  const ctx: AppCtx = { cv, session: o.session, state, router, sound, overlay, hasScene: !!o.renderer };
  const stopLoop = startFrameLoop(state, o);
  bindRenderer(state, router, o.renderer ?? null);
  if (o.dev) (window as unknown as { __vale?: unknown }).__vale = { ...ctx, audioLog: (port as { log?: unknown }).log, screens: Object.keys(SCREENS) };
  root.textContent = '';
  void loadFonts().then(() => render(<AppContext.Provider value={ctx}><App /></AppContext.Provider>, root));
  return {
    state, router,
    unmount: () => { stopLoop(); state.dispose(); render(null, root); },
  };
}

/** the boot skeleton while the catalog loads: the shell at its final size with a shadow sweep */
export function mountLoading(root: HTMLElement): void {
  render(
    <div class="app" role="status" aria-busy="true" aria-label="Loading">
      <div class="backdrop" aria-hidden="true" />
      <header class="bar"><span class="bar__brand">VALE</span><span class="skel" style={{ width: '420px', height: '20px' }} /></header>
      <div class="scr"><section class="scr__zone">
        <span class="skel" style={{ width: '70%', height: '76px', marginBottom: '16px' }} />
        <span class="skel" style={{ width: '90%', height: '20px', marginBottom: '32px' }} />
        <span class="skel" style={{ width: '100%', height: '220px', marginBottom: '16px' }} />
        <span class="skel" style={{ width: '100%', height: '160px' }} />
      </section></div>
    </div>, root);
}

/** a boot failure (catalog could not load): the designed error state, plain English, Reload */
export function mountBootError(root: HTMLElement, message: string): void {
  void loadFonts().then(() => render(
    <div class="app booterr">
      <div class="backdrop" aria-hidden="true" />
      <div class="booterr__plate plate pad-l" role="alert">
        <span class="bar__brand">VALE</span>
        <div class="errstate"><Icon name="danger" class="errstate__glyph" /><p class="t-body errstate__text">Couldn't load the game data. Reload the page.</p></div>
        <p class="t-caption quiet booterr__detail">{message}</p>
        <button type="button" class="btn btn--chalk btn--m" onClick={() => location.reload()}><span class="btn__label">Reload</span></button>
      </div>
    </div>, root));
}

// ── renderer: the menu world follows the route; settings and size follow the client ───────────────
function bindRenderer(state: AppState, router: Router, r: RendererPort | null): void {
  if (!r) return;
  try { r.setScene?.('menu'); } catch (e) { console.error('[vale] renderer menu', e); }
  addEventListener('resize', () => { try { r.resize?.(); } catch { /* next frame retries */ } });
  effect(() => {
    const s = state.settings.value;
    try { r.setQuality?.(s.video); r.setSettings?.(s); } catch (e) { console.error('[vale] renderer settings', e); }
  });
  effect(() => {
    const route = router.route.value;
    if (state.match.value) return;
    const p = route.params;
    // the shop previews its selected offer, or (like the screen) the first available one
    const cv = state.cv;
    const offer = route.screen === 'shop' ? (cv.offer(p.sku) ?? cv.c.store.offers.find((o) => cv.offerAvailable(o) && cv.skin(o.ref))) : undefined;
    const fighter = p.fighter ?? (offer ? cv.skin(offer.ref)?.fighter : undefined);
    const skin = offer ? offer.ref : p.skin ?? (fighter ? state.profile.peek().equipped[fighter] : undefined);
    try { r.setMenuView?.({ screen: route.screen, ...(fighter ? { fighter } : {}), ...(skin ? { skin } : {}), ...(p.mode ? { mode: p.mode } : {}) }); } catch (e) { console.error('[vale] renderer menu view', e); }
  });
}

// ── frame loop: pump the live match (LocalMatchHost needs real elapsed time) and draw ──────────────
function startFrameLoop(state: AppState, o: MountOptions): () => void {
  let raf = 0, last = performance.now(), stopped = false;
  const pump = o.pumpMatch !== false;
  const tick = (now: number): void => {
    if (stopped) return;
    const dt = Math.min(0.25, Math.max(0, (now - last) / 1000));
    last = now;
    const m: MatchClient | null = state.match.value;
    if (pump && m) { try { m.pump(dt); } catch (e) { console.error('[vale] match pump', e); } }
    if (o.renderer?.render) { try { o.renderer.render(dt); } catch (e) { console.error('[vale] render', e); } }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

// ── the app ────────────────────────────────────────────────────────────────────────────────────
function useRootStyle(): void {
  const { state } = useApp();
  useEffect(() => {
    const html = document.documentElement;
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = (): void => {
      const s = state.settings.value;
      const [lo, hi] = TOKENS.type.uiScale;
      const ui = Math.min(hi, Math.max(lo, s.access.uiScale));
      const vk = Math.min(innerWidth / 1920, innerHeight / 1080);
      html.style.setProperty('--vk', vk.toFixed(4));
      html.style.setProperty('--k', (ui * Math.min(1.25, Math.max(0.8, vk))).toFixed(4));
      if (s.access.colorblind === 'off') html.removeAttribute('data-cvd'); else html.setAttribute('data-cvd', s.access.colorblind);
      const rm = s.access.reduceMotion || mq.matches;
      reducedMotion.value = rm;
      html.classList.toggle('reduce-motion', rm);
    };
    const stop = effect(apply);
    addEventListener('resize', apply);
    mq.addEventListener('change', apply);
    return () => { stop(); removeEventListener('resize', apply); mq.removeEventListener('change', apply); };
  }, []);
}

function App(): JSX.Element {
  const { state, router, sound, overlay, hasScene } = useApp();
  useRootStyle();
  const route = router.route.value;
  const def = SCREENS[route.screen] ?? SCREENS.home;

  // music follows the route (menu bed · draft bed · the map's match bed · post-game)
  useEffect(() => {
    const kind = def.music;
    if (kind === 'match') {
      const map = state.cv.map(state.match.value?.setup.map ?? state.lastSetup.value?.map);
      sound.music(map?.art.music ?? null);
    } else sound.music(kind === 'none' ? null : musicId(kind ?? 'menu'));
  }, [def.music, route.key]);

  // Esc: tooltip → top modal (unless it is not dismissable) → the screen's claim → Back
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        if (overlay.tip.value) overlay.tip.value = null;
        const top = overlay.top;
        if (top) { if (top.dismissable !== false) { e.preventDefault(); sound.play('back'); overlay.close(top.id); } return; }
        if (handleEsc()) { e.preventDefault(); return; }
        if (def.chrome === 'nav' || def.chrome === undefined) {
          if (router.canGoBack()) { e.preventDefault(); sound.play('back'); router.back(); }
          else if (route.screen !== 'home') { e.preventDefault(); sound.play('back'); router.go('home', {}, { root: true }); }
        }
        return;
      }
      if (!overlay.top) arrowNav(e);
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [route.key, def]);

  const chrome = def.chrome ?? 'nav';
  return (
    <div class={`app ${hasScene ? 'has-scene' : ''} ${chrome === 'flow' ? 'is-flow' : ''} ${chrome === 'match' ? 'is-match' : ''}`}>
      <a href="#main" class="skip t-label" onClick={(e) => { e.preventDefault(); document.querySelector<HTMLElement>('#main [data-autofocus], #main button, #main [tabindex="0"]')?.focus(); }}>
        {state.cv.t('a11y.skip_to_content', 'Skip to content')}
      </a>
      {hasScene ? null : <Backdrop />}
      <main id="main" class="stage"><ScreenHost /></main>
      {chrome !== 'match' ? <TopBar def={def} route={route} /> : null}
      <ToastStack />
      <ModalHost />
      <TooltipLayer />
      <WipeLayer />
    </div>
  );
}

/** the drawn backdrop (no renderer attached): long light, horizon, the stopped dial in columns 7–12 */
function Backdrop(): JSX.Element {
  const ticks = Array.from({ length: 24 }, (_, i) => i);
  return (
    <div class="backdrop" aria-hidden="true">
      <div class="backdrop__horizon" />
      <div class="backdrop__dial">
        <svg viewBox="-100 -100 200 200" fill="none" stroke="currentColor">
          <circle r="96" stroke-width="0.6" />
          <circle r="78" stroke-width="0.4" stroke-dasharray="0.6 3.4" />
          {ticks.map((i) => {
            const a = (i / 24) * Math.PI * 2;
            const long = i % 2 === 0;
            return <line x1={Math.sin(a) * (long ? 84 : 88)} y1={-Math.cos(a) * (long ? 84 : 88)} x2={Math.sin(a) * 94} y2={-Math.cos(a) * 94} stroke-width={long ? 0.8 : 0.5} />;
          })}
          <circle r="2.2" fill="currentColor" stroke="none" />
        </svg>
        <svg class="backdrop__gnomon" viewBox="-100 -100 200 200" fill="none">
          <polygon points="0,0 -3.2,-92 3.2,-92" fill="rgba(11,13,17,0.85)" />
          <line x1="0" y1="0" x2="0" y2="-92" stroke="rgba(237,230,214,0.18)" stroke-width="0.5" />
        </svg>
      </div>
    </div>
  );
}

function TopBar(p: { def: ScreenDef; route: Route }): JSX.Element {
  const { cv, router, state, sound } = useApp();
  const profile = state.profile.value;
  const cur = cv.earnedCurrency();
  const nav = cv.c.client.nav.filter((n) => SCREENS[n.screen]);
  // the match flow owns the client: Settings opened from the in-match menu shows no nav either
  const flow = p.def.chrome === 'flow' || !!state.match.value || !!state.draft.value;
  const seen = state.prefs.value.seenScreens;
  const navRef = useRef<HTMLElement>(null);
  const goNav = (screen: string, params: Record<string, string> = {}): void => {
    if (p.route.screen === screen && JSON.stringify(p.route.params) === JSON.stringify(params)) return;
    sound.play('confirm');
    if (!seen.includes(screen)) state.setPrefs({ seenScreens: [...seen, screen] });
    router.go(screen, params, { root: true });
  };
  const q = state.lastRequest.value ? cv.queue(state.lastRequest.value.queue) : state.draft.value ? cv.queue(state.draft.value.queue) : null;
  const mode = cv.mode(q?.mode ?? state.draft.value?.mode ?? state.lastSetup.value?.mode);
  return (
    <header class="bar" role="banner">
      {p.def.chrome !== 'flow' && router.canGoBack() ? <BackButton label={cv.t('nav.back', 'Back')} onPress={() => router.back()} /> : null}
      <span class="bar__brand" aria-label={cv.t('app.name', 'VALE')}>{cv.t('app.name', 'VALE')}</span>
      {flow ? (
        <div class="bar__flow t-label">{mode ? <span>{mode.name}</span> : null}{q ? <span class="quiet">· {q.name}</span> : null}</div>
      ) : (
        <nav ref={navRef} class="bar__nav" aria-label={cv.t('nav.aria', 'Main navigation')} data-arrownav="row">
          {nav.map((n) => {
            const current = p.route.screen === n.screen || (n.screen === 'collection' && p.route.screen === 'loadout');
            return (
              <button type="button" class={`nav__item t-label ${current ? 'is-current' : ''}`} aria-current={current ? 'page' : undefined} data-nav=""
                onPointerEnter={() => sound.play('hover')} onClick={() => goNav(n.screen)}>
                {n.label}
                {SCREENS[n.screen]?.isNew && !seen.includes(n.screen) ? <NewDot /> : null}
              </button>
            );
          })}
        </nav>
      )}
      <span class="bar__spacer" />
      {!flow && cur ? (
        <div class="bar__wallet" title={cur.desc}>
          <Currency id={cur.id} amount={profile.wallet[cur.id] ?? 0} size="m" />
        </div>
      ) : null}
      {!flow ? (
        <button type="button" class="bar__me t-body-s" onPointerEnter={() => sound.play('hover')} onClick={() => goNav('profile')}
          aria-label={`${profile.identity.displayName}, ${cv.t('common.level', 'Level {n}', { n: profile.level })}`}>
          <Icon name="user" size={18} />
          <span>{profile.identity.displayName}</span>
          <span class="chip chip--line num">{cv.t('common.level_short', 'Lv {n}', { n: profile.level })}</span>
        </button>
      ) : null}
    </header>
  );
}

// ── screen host: enter/exit motion by transition ───────────────────────────────────────────────
interface Live { route: Route; leaving: boolean; transition: Transition }

function ScreenHost(): JSX.Element {
  const { router } = useApp();
  const route = router.route.value;
  const [live, setLive] = useState<Live[]>([{ route, leaving: false, transition: 'none' }]);
  useLayoutEffect(() => {
    setLive((cur) => {
      const top = cur.find((l) => !l.leaving);
      if (top && top.route === route) return cur;
      if (top && top.route.key === route.key) return cur.map((l) => (l === top ? { ...l, route } : l));
      // same screen, new params without a transition (tabs): update in place
      if (top && top.route.screen === route.screen && router.transition.value === 'none') return cur.map((l) => (l === top ? { ...l, route } : l));
      const t = router.transition.value;
      return [...cur.filter((l) => !l.leaving).map((l) => ({ ...l, leaving: true, transition: t })), { route, leaving: false, transition: t }];
    });
  }, [route]);
  return (
    <>
      {live.map((l) => (
        <ScreenFrame key={l.route.key} live={l} onGone={() => setLive((cur) => cur.filter((x) => x.route.key !== l.route.key))} />
      ))}
    </>
  );
}

const WIPE_SWAP_MS = Math.round(TOKENS.motion.signature.ms / 2);

function ScreenFrame(p: { live: Live; onGone: () => void }): JSX.Element {
  const el = useRef<HTMLDivElement>(null);
  const def = SCREENS[p.live.route.screen] ?? SCREENS.home;
  const wipe = p.live.transition === 'wipe' && !reducedMotion.value;
  const [shown, setShown] = useState(!wipe || p.live.leaving);
  // a wipe swaps screens while the band covers the viewport
  useEffect(() => {
    if (shown) return;
    wipeSignal.value++;
    const t = setTimeout(() => setShown(true), WIPE_SWAP_MS);
    return () => clearTimeout(t);
  }, []);
  useLayoutEffect(() => {
    if (p.live.leaving || !shown || !el.current) return;
    const t = p.live.transition;
    if (t === 'forward' || t === 'back') animateIn(el.current, { from: t === 'forward' ? 'right' : 'left', dist: 'panel', d: 'panel' });
    else if (t === 'fade') animateIn(el.current, { from: 'none', d: 'base' });
    const items = [...el.current.querySelectorAll('.stg')];
    items.forEach((it, i) => animateIn(it, { from: 'below', dist: 'small', d: 'panel', delay: 60 + Math.min(i, TOKENS.motion.stagger.capItems) * TOKENS.motion.stagger.perItemMs }));
    const first = el.current.querySelector<HTMLElement>('[data-autofocus]');
    if (first && (document.activeElement === document.body || !document.activeElement || !document.contains(document.activeElement))) first.focus({ preventScroll: true });
  }, [shown]);
  useEffect(() => {
    if (!p.live.leaving) return;
    const t = p.live.transition;
    if (t === 'wipe' && !reducedMotion.value) { const h = setTimeout(p.onGone, WIPE_SWAP_MS); return () => clearTimeout(h); }
    if (t === 'none') { p.onGone(); return; }
    let done = false;
    const from = t === 'forward' ? 'left' : t === 'back' ? 'right' : 'none';
    void animateOut(el.current, { from, dist: 'panel', d: 'panel' }).then(() => { if (!done) { done = true; p.onGone(); } });
    return () => { done = true; };
  }, [p.live.leaving]);
  if (!shown) return <div class="scr" />;
  const C: ComponentType<{ params: Record<string, string> }> = def.component;
  return (
    <div ref={el} class={`scr scr--${def.id} ${p.live.leaving ? 'is-leaving' : ''}`} inert={p.live.leaving ? true : undefined} aria-hidden={p.live.leaving ? 'true' : undefined}>
      <C params={p.live.route.params} />
    </div>
  );
}

// ── the shadow-line wipe ──────────────────────────────────────────────────────────────────────
const wipeSignal = signal(0);

function WipeLayer(): JSX.Element | null {
  const n = wipeSignal.value;
  const band = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!n) return;
    setActive(true);
  }, [n]);
  useLayoutEffect(() => {
    if (!active || !band.current) return;
    const a = band.current.animate(
      [{ transform: 'translateX(0) skewX(-30deg)' }, { transform: 'translateX(133.4%) skewX(-30deg)' }],
      { duration: TOKENS.motion.signature.ms, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
    );
    a.finished.then(() => setActive(false), () => setActive(false));
    return () => a.cancel();
  }, [active, n]);
  if (!active) return null;
  return <div class="wipe" aria-hidden="true"><div ref={band} class="wipe__band" /></div>;
}

