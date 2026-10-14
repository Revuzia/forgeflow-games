// VALE UI — catalog images with designed fallbacks. A missing or failed asset never shows a broken
// image and never shows fake art: it shows the PLACEHOLDER FRAME, a legitimate "art missing / loading"
// state built from data — the fighter's palette (primary → secondary), the 30° shadow line, and the
// fighter's class mass glyph (Plinth block, Breaker wedge, …). Images fade in at 160 ms once decoded.
// Known-missing refs (CatalogView.asset → null) are never requested.

import type { ComponentChildren, CSSProperties, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import type { FighterDefT, ModeMark } from '../catalog_view.ts';
import { ClassGlyph, classShapeOf, Icon, ModeMarkGlyph, Wedge } from './Glyphs.tsx';
import { UncarvedDial } from './States.tsx';

const failed = new Set<string>();

export function AssetImg(p: { src: string | null; alt: string; class?: string; style?: CSSProperties; fallback?: ComponentChildren; fit?: 'cover' | 'contain'; position?: string }): JSX.Element {
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>(p.src && !failed.has(p.src) ? 'loading' : 'fail');
  useEffect(() => { setState(p.src && !failed.has(p.src) ? 'loading' : 'fail'); }, [p.src]);
  if (state === 'fail' || !p.src) return <>{p.fallback ?? null}</>;
  return (
    <>
      {state === 'loading' ? <span class="skel aimg__skel" aria-hidden="true" /> : null}
      <img src={p.src} alt={p.alt} class={`aimg ${state === 'ok' ? 'is-ok' : ''} ${p.class ?? ''}`} draggable={false} decoding="async"
        style={{ objectFit: p.fit ?? 'cover', objectPosition: p.position, ...p.style }}
        onLoad={() => setState('ok')} onError={() => { failed.add(p.src!); setState('fail'); }} />
    </>
  );
}

/** the placeholder frame for a fighter (palette + class mass glyph) */
export function PortraitFrame(p: { fighter: FighterDefT | undefined; splash?: boolean; note?: string }): JSX.Element {
  const { cv } = useApp();
  const f = p.fighter;
  const c = cv.cls(f?.class);
  const shape = classShapeOf(c?.shape, c?.name);
  const style = { '--pal-a': f?.palette.primary ?? '#2C333F', '--pal-b': f?.palette.secondary ?? '#8F8A80' } as CSSProperties;
  return (
    <span class={`pframe ${p.splash ? 'pframe--splash' : ''}`} style={style} aria-hidden="true">
      <span class="pframe__glyph">{shape ? <ClassGlyph shape={shape} size="100%" /> : <Wedge size="100%" />}</span>
      {p.splash ? <span class="pframe__ticks" /> : null}
      {p.note ? <span class="pframe__note t-caption">{p.note}</span> : null}
    </span>
  );
}

/** the fighter's (or skin's) portrait or splash */
export function Portrait(p: { fighter: FighterDefT | undefined; skin?: string; class?: string; size?: 'xs' | 's' | 'm' | 'l' | 'fill'; kind?: 'portrait' | 'splash'; position?: string; round?: boolean; style?: CSSProperties }): JSX.Element {
  const { cv } = useApp();
  const f = p.fighter;
  const s = cv.skin(p.skin) ?? (f ? cv.baseSkin(f.id) : undefined);
  const ref = p.kind === 'splash' ? (s?.splash ?? f?.art.splash) : (s?.portrait ?? f?.art.portrait);
  const style = { '--pal-a': f?.palette.primary ?? '#2C333F', '--pal-b': f?.palette.secondary ?? '#8F8A80', ...p.style } as CSSProperties;
  return (
    <span class={`portrait portrait--${p.size ?? 'm'} ${p.round ? 'portrait--round' : ''} ${p.class ?? ''}`} style={style}>
      <AssetImg src={cv.asset(ref)} alt={f ? `${f.name}${s && s.tier !== 'base' ? ` · ${s.name}` : ''}` : ''}
        fallback={<PortraitFrame fighter={f} splash={p.kind === 'splash'} />}
        position={p.position ?? (p.kind === 'splash' ? '70% 30%' : '50% 20%')} />
    </span>
  );
}

/** generic catalog art (home tiles, feature card, mode cards) with a drawn fallback */
export function ArtFrame(p: { src: string | undefined; mark?: ModeMark | null; class?: string; alt?: string; lanes?: number; children?: ComponentChildren }): JSX.Element {
  const { cv } = useApp();
  const fb = (
    <span class="artframe__fb" aria-hidden="true">
      {p.mark ? <ModeMarkGlyph mark={p.mark} lanes={p.lanes} size="100%" class="artframe__mark" /> : <UncarvedDial size={96} />}
    </span>
  );
  return (
    <span class={`artframe ${p.class ?? ''}`}>
      <AssetImg src={cv.asset(p.src)} alt={p.alt ?? ''} fallback={fb} />
      {p.children}
    </span>
  );
}

/** ability / spell / boon icon with a drawn fallback (the icon lane's SVGs are pending) */
export function SetupIcon(p: { icon: string | undefined; kind: 'spell' | 'boon' | 'ability' | 'passive'; size?: 's' | 'm' | 'l'; keyLabel?: string; pathColor?: string; palette?: string; name?: string }): JSX.Element {
  const { cv } = useApp();
  const fb = p.kind === 'boon'
    ? <svg class="sicon__fb" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.6" /><circle cx="12" cy="12" r="2.6" fill="currentColor" /></svg>
    : p.kind === 'passive'
      ? <svg class="sicon__fb" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
      : p.kind === 'spell'
        ? <Wedge class="sicon__fb" />
        : <span class="sicon__fb" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-heading)', fontWeight: 700, fontSize: 'max(12px, calc(15px * var(--k)))', color: 'var(--text-1)' }}>{(p.name ?? '?').slice(0, 1)}</span>;
  const style = { '--path': p.pathColor, '--pal-a': p.palette } as CSSProperties;
  return (
    <span class={`sicon sicon--${p.size ?? 'm'} sicon--${p.kind}`} style={style}>
      <AssetImg src={cv.asset(p.icon)} alt="" fallback={fb} fit="contain" />
      {p.keyLabel ? <span class="sicon__key">{p.keyLabel}</span> : null}
    </span>
  );
}

export { Icon };

/** the stage subject (columns 7-12): over the live menu scene the stage is open and the 3D showcase
 *  fighter on its plinth is the subject; without a scene, the painted splash (or its designed frame) */
export function StageArt(p: { fighter: FighterDefT | undefined; skin?: string; class?: string }): JSX.Element | null {
  const { hasScene } = useApp();
  if (hasScene) return null;
  return <Portrait fighter={p.fighter} skin={p.skin} kind="splash" size="fill" class={p.class ?? 'stagecard__art'} />;
}
