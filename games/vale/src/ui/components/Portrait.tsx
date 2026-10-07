// VALE UI — catalog images with designed fallbacks. A missing or failed asset never shows a broken
// image: it falls back to the fighter's initial (the dial-tongue gives every launch fighter its own
// initial) on its palette, or to a drawn glyph. Images fade in at 160 ms once decoded.

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import type { FighterDefT } from '../catalog_view.ts';

const failed = new Set<string>();

export function AssetImg(p: { src: string | null; alt: string; class?: string; style?: JSX.CSSProperties; fallback?: ComponentChildren; fit?: 'cover' | 'contain'; position?: string }): JSX.Element {
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>(p.src && !failed.has(p.src) ? 'loading' : 'fail');
  useEffect(() => { setState(p.src && !failed.has(p.src) ? 'loading' : 'fail'); }, [p.src]);
  if (state === 'fail' || !p.src) return <>{p.fallback ?? null}</>;
  return (
    <img src={p.src} alt={p.alt} class={`aimg ${state === 'ok' ? 'is-ok' : ''} ${p.class ?? ''}`} draggable={false} decoding="async"
      style={{ objectFit: p.fit ?? 'cover', objectPosition: p.position, ...p.style }}
      onLoad={() => setState('ok')} onError={() => { failed.add(p.src!); setState('fail'); }} />
  );
}

/** the fighter's (or skin's) portrait; `crop` shifts the focal point */
export function Portrait(p: { fighter: FighterDefT | undefined; skin?: string; class?: string; size?: 'xs' | 's' | 'm' | 'l' | 'fill'; kind?: 'portrait' | 'splash'; position?: string }): JSX.Element {
  const { cv } = useApp();
  const f = p.fighter;
  const s = cv.skin(p.skin) ?? (f ? cv.baseSkin(f.id) : undefined);
  const ref = p.kind === 'splash' ? (s?.splash ?? f?.art.splash) : (s?.portrait ?? f?.art.portrait);
  const primary = f?.palette.primary ?? '#2C333F';
  const secondary = f?.palette.secondary ?? '#171B22';
  const fallback = (
    <span class="portrait__fallback" style={{ '--pal-a': primary, '--pal-b': secondary } as JSX.CSSProperties} aria-hidden="true">
      <span class="portrait__initial">{(f?.name ?? '?').slice(0, 1)}</span>
    </span>
  );
  return (
    <span class={`portrait portrait--${p.size ?? 'm'} ${p.class ?? ''}`} style={{ '--pal-a': primary } as JSX.CSSProperties}>
      <AssetImg src={cv.asset(ref)} alt={f ? `${f.name}${s && s.tier !== 'base' ? ` · ${s.name}` : ''}` : ''} fallback={fallback} position={p.position ?? (p.kind === 'splash' ? '70% 30%' : '50% 20%')} />
    </span>
  );
}
