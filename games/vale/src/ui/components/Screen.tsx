// VALE UI — the screen frame on the bible's grid. The UI zone is columns 1–6 (it widens with the UI
// scale); `wide` screens (draft, post-game) take the full width. The head carries the Display title
// (Gloock, never below 28 px); the foot carries the ONE chalk CTA at the bottom-right of the zone, with
// secondary actions and state lines to its left. `stage` fills columns 7–12 (the subject: a splash, a
// preview) when the screen has one; otherwise the 3D scene or the drawn backdrop shows through.

import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export interface ScreenProps {
  title?: ComponentChildren;
  kicker?: ComponentChildren;
  titleSize?: 'm' | 'l';
  /** a line under the title (a fighter's title, a subtitle) */
  sub?: ComponentChildren;
  headSide?: ComponentChildren;
  layout?: 'zone' | 'wide';
  /** left part of the footer (secondary actions, the reason a CTA is disabled) */
  foot?: ComponentChildren;
  /** the chalk CTA (bottom-right of the zone) */
  cta?: ComponentChildren;
  stage?: ComponentChildren;
  label?: string;
  bodyClass?: string;
  children?: ComponentChildren;
}

/** play roles-720: whether a scroller has more content below its bottom edge, as the class 'is-more-b'. Give the
 *  element the returned ref, this class and `sfade` (base.css): its bottom edge fades over three grid units instead of
 *  cutting a row through its labels, and the fade lifts once the last row has scrolled clear. The top edge stays hard
 *  (a sticky bar, such as the skins tab's, sits there). Follows scrolling, the box's own size and its content's (a
 *  direct child added, removed or resized) */
export function useMoreBelow<T extends HTMLElement>(): [RefObject<T | null>, string] {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const e = ref.current;
    if (!e) return;
    let raf = 0;
    const measure = (): void => { raf = 0; setMore(e.scrollTop + e.clientHeight < e.scrollHeight - 1); };
    const later = (): void => { if (!raf) raf = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(later);
    const watch = (): void => { ro.disconnect(); ro.observe(e); for (const c of e.children) ro.observe(c); later(); };
    const mo = new MutationObserver(watch);
    mo.observe(e, { childList: true });
    e.addEventListener('scroll', later, { passive: true });
    watch();
    return () => { e.removeEventListener('scroll', later); mo.disconnect(); ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);
  return [ref, more ? 'is-more-b' : ''];
}

export function Screen(p: ScreenProps): JSX.Element {
  const [body, more] = useMoreBelow<HTMLDivElement>();
  return (
    <>
      <section class={`scr__zone ${p.layout === 'wide' ? 'scr__zone--wide' : ''}`} aria-label={p.label ?? (typeof p.title === 'string' ? p.title : undefined)}>
        {p.title || p.headSide ? (
          <header class="scr__head stg">
            <div class="scr__headmain">
              {p.kicker ? <div class="scr__kicker t-label">{p.kicker}</div> : null}
              {p.title ? <h1 class={`scr__title t-display-${p.titleSize ?? 'm'}`}>{p.title}</h1> : null}
              {p.sub ? <div class="scr__sub">{p.sub}</div> : null}
            </div>
            {p.headSide ? <div class="scr__headside">{p.headSide}</div> : null}
          </header>
        ) : null}
        <div ref={body} class={`scr__body sfade ${more} ${p.bodyClass ?? ''}`}>{p.children}</div>
        {p.foot || p.cta ? (
          <footer class="scr__foot">
            <div class="grow">{p.foot}</div>
            {p.cta}
          </footer>
        ) : null}
      </section>
      {p.stage ? <aside class="scr__stage">{p.stage}</aside> : null}
    </>
  );
}

/** a titled panel section inside a screen body */
export function Section(p: { title?: ComponentChildren; hint?: ComponentChildren; side?: ComponentChildren; class?: string; children?: ComponentChildren; id?: string }): JSX.Element {
  return (
    <section class={`sect stg ${p.class ?? ''}`} id={p.id}>
      {p.title || p.side ? (
        <div class="sect__head">
          {p.title ? <h2 class="t-h2 sect__title">{p.title}</h2> : null}
          {p.hint ? <span class="t-body-s sect__hint">{p.hint}</span> : null}
          {p.side ? <span class="sect__side">{p.side}</span> : null}
        </div>
      ) : null}
      {p.children}
    </section>
  );
}
