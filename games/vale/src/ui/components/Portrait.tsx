// VALE UI — catalog images with designed fallbacks. A missing or failed asset never shows a broken
// image and never shows fake art: it shows the PLACEHOLDER FRAME, a legitimate "art missing / loading"
// state built from data — the fighter's palette (primary → secondary), the 30° shadow line, and the
// fighter's class mass glyph (Plinth block, Breaker wedge, …). Images fade in at 160 ms once decoded.
// Known-missing refs (CatalogView.asset → null) are never requested.

import type { ComponentChildren, CSSProperties, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import type { FighterDefT, ModeMark } from '../catalog_view.ts';
import { ClassGlyph, classShapeOf, Icon, ModeMarkGlyph, Wedge } from './Glyphs.tsx';
import { UncarvedDial } from './States.tsx';

const failed = new Set<string>();

export function AssetImg(p: { src: string | null; alt: string; class?: string; style?: CSSProperties; fallback?: ComponentChildren; fit?: 'cover' | 'contain'; position?: string }): JSX.Element {
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>(p.src && !failed.has(p.src) ? 'loading' : 'fail');
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => { setState(p.src && !failed.has(p.src) ? 'loading' : 'fail'); }, [p.src]);
  // a cached image can finish before its load event is seen: settle from `complete` after every render
  useEffect(() => {
    const i = ref.current;
    if (state !== 'loading' || !i || !i.complete) return;
    if (i.naturalWidth > 0) setState('ok');
    else { failed.add(p.src!); setState('fail'); }
  });
  if (state === 'fail' || !p.src) return <>{p.fallback ?? null}</>;
  return (
    <>
      {state === 'loading' ? <span class="skel aimg__skel" aria-hidden="true" /> : null}
      <img ref={ref} src={p.src} alt={p.alt} class={`aimg ${state === 'ok' ? 'is-ok' : ''} ${p.class ?? ''}`} draggable={false} decoding="async"
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

/** the fighter's (or skin's) portrait or splash, or (kind 'chip', hud HUD-2) the fighter's face chip: the head-and-
 *  shoulders icon on its ink ground that reads apart from every other fighter's at 26-48 px (art.icon, the same art the
 *  minimap draws), falling back to the skin's portrait. HUD faces (ally frames, target plate, scoreboard, recap, banners,
 *  kill feed) use the chip; the chip is the fighter's identity, so a skin keeps its fighter's chip */
export function Portrait(p: { fighter: FighterDefT | undefined; skin?: string; class?: string; size?: 'xs' | 's' | 'm' | 'l' | 'fill'; kind?: 'portrait' | 'splash' | 'chip'; position?: string; round?: boolean; style?: CSSProperties }): JSX.Element {
  const { cv } = useApp();
  const f = p.fighter;
  const s = cv.skin(p.skin) ?? (f ? cv.baseSkin(f.id) : undefined);
  const portrait = s?.portrait ?? f?.art.portrait;
  const chip = p.kind === 'chip' ? cv.asset(f?.art.icon) : null;
  const src = chip ?? cv.asset(p.kind === 'splash' ? (s?.splash ?? f?.art.splash) : portrait);
  const style = { '--pal-a': f?.palette.primary ?? '#2C333F', '--pal-b': f?.palette.secondary ?? '#8F8A80', ...p.style } as CSSProperties;
  return (
    <span class={`portrait portrait--${p.size ?? 'm'} ${p.round ? 'portrait--round' : ''} ${chip ? 'portrait--chip' : ''} ${p.class ?? ''}`} style={style}>
      <AssetImg src={src} alt={f ? `${f.name}${s && s.tier !== 'base' ? ` · ${s.name}` : ''}` : ''}
        fallback={<PortraitFrame fighter={f} splash={p.kind === 'splash'} />}
        position={p.position ?? (p.kind === 'splash' ? '70% 30%' : chip ? '50% 50%' : '50% 20%')} />
    </span>
  );
}

// ── skin focus (closing CL-1): crop a fighter's skin tiles on what its skins change ─────────────────────────────
// A 3:4 tile over a square portrait cuts a quarter of its width. The crop centres on the columns where the fighter's
// paid skins differ from its base portrait (48² samples, CIE76 ΔE over 8 counts, summed over every paid skin), and
// the base tile takes the same crop, so the tiles of one fighter compare like for like. Computed once per fighter in
// the browser from the shipped portraits, so it follows the art whenever a skin is re-rendered; any failure (a
// missing image, a canvas that cannot be read) keeps the default crop.
const FOCUS_N = 48;
const focusMemo = new Map<string, Promise<string | null>>();
const lab = (d: Uint8ClampedArray, i: number): [number, number, number] => {
  const l = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const r = l(d[i]), g = l(d[i + 1]), b = l(d[i + 2]);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
async function pixels(src: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = FOCUS_N;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d context');
  g.drawImage(img, 0, 0, FOCUS_N, FOCUS_N);
  return g.getImageData(0, 0, FOCUS_N, FOCUS_N).data;
}
/** the tile crop (object-position) for a fighter's skin tiles, or null for the default */
export function skinFocus(cv: ReturnType<typeof useApp>['cv'], f: FighterDefT, tileAspect = 0.75): Promise<string | null> {
  const key = `${f.id}:${tileAspect}`;
  let p = focusMemo.get(key);
  if (p) return p;
  p = (async () => {
    const base = cv.asset(cv.baseSkin(f.id)?.portrait ?? f.art.portrait);
    const paid = cv.skinsOf(f.id).filter((s) => s.tier !== 'base').map((s) => cv.asset(s.portrait)).filter((x): x is string => !!x && x !== base);
    if (!base || !paid.length) return null;
    const b = await pixels(base);
    const col = new Float64Array(FOCUS_N);
    for (const src of paid) {
      const d = await pixels(src);
      for (let i = 0; i < FOCUS_N * FOCUS_N; i++) {
        const [l1, a1, b1] = lab(b, i * 4), [l2, a2, b2] = lab(d, i * 4);
        col[i % FOCUS_N] += Math.max(0, Math.hypot(l1 - l2, a1 - a2, b1 - b2) - 8);
      }
    }
    let w = 0, m = 0;
    col.forEach((v, x) => { w += v; m += v * (x + 0.5); });
    if (w < FOCUS_N * 4) return null;                    // nothing reads as changed: keep the default crop
    const cx = m / w / FOCUS_N;                          // the change's centre, 0..1 across the portrait
    const k = Math.min(1, Math.max(0, (cx - tileAspect / 2) / (1 - tileAspect)));
    // 70 % of the way to the change: the face (the fighter's identity, centred in every portrait) stays in the tile
    return `${Math.round((0.5 + (k - 0.5) * 0.7) * 100)}% 20%`;
  })().catch(() => null);
  focusMemo.set(key, p);
  return p;
}
/** the object-position for a fighter's skin tiles (undefined until known, or when the default crop stands) */
export function useSkinFocus(f: FighterDefT | undefined): string | undefined {
  const { cv } = useApp();
  const [pos, setPos] = useState<string | null>(null);
  useEffect(() => {
    if (!f) return;
    let live = true;
    void skinFocus(cv, f).then((v) => { if (live) setPos(v); });
    return () => { live = false; };
  }, [f?.id]);
  return pos ?? undefined;
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
