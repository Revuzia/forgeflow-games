// VALE HUD — drawn glyphs for the match. Ability and item icons are the icon lane's SVGs when they
// exist (CatalogView.asset); until then the HUD draws a legitimate placeholder FROM THE RECORD: the
// ability's delivery (projectile, dash, area, zone, shield, heal …) or the item's tags, over the
// fighter's palette or the item's tier plate. Ping markers are the nine shapes of client_hud §5 —
// every one a distinct silhouette, so none depends on colour. Bible: plate = structure, ring = time
// and state, wedge = act / facing; no gears, clock hands, gems or glowing runes.

import type { CSSProperties, JSX } from 'preact';
import type { ItemDefT } from '../../contracts/catalog.ts';
import type { PingKind } from '../../contracts/sim.ts';
import type { AbilityCore } from '../../input/index.ts';

const S = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

type Family = 'bolt' | 'volley' | 'dash' | 'blink' | 'burst' | 'cone' | 'line' | 'zone' | 'shield' | 'heal' | 'buff' | 'stun' | 'slow' | 'summon' | 'mark' | 'self' | 'wedge';

/** the glyph family of an ability, from its effects (the delivery first, then what it does) */
export function abilityFamily(a: AbilityCore | undefined): Family {
  if (!a) return 'wedge';
  const top = a.effects;
  const ops = new Set(top.map((e) => e.op));
  const all = JSON.stringify(a.effects);
  if (ops.has('projectile')) {
    const p = top.find((e) => e.op === 'projectile') as { count?: number; spreadDeg?: number } | undefined;
    return (p?.count ?? 1) > 1 || (p?.spreadDeg ?? 0) > 0 ? 'volley' : 'bolt';
  }
  if (ops.has('dash')) return 'dash';
  if (ops.has('blink')) return 'blink';
  if (ops.has('zone')) return 'zone';
  if (ops.has('area')) {
    const ar = top.find((e) => e.op === 'area') as { shape?: { kind: string } } | undefined;
    return ar?.shape?.kind === 'cone' ? 'cone' : ar?.shape?.kind === 'rect' ? 'line' : 'burst';
  }
  if (ops.has('summon')) return 'summon';
  if (/"op":"shield"/.test(all)) return 'shield';
  if (/"op":"heal"/.test(all) && !/"op":"damage"/.test(all)) return 'heal';
  if (/"status":"(stun|airborne|sleep|taunt|fear)"/.test(all)) return 'stun';
  if (/"status":"(slow|root)"/.test(all)) return 'slow';
  if (ops.has('mark') || ops.has('consumeMark')) return 'mark';
  if (ops.has('buff') || ops.has('form')) return 'buff';
  if (a.targeting.kind === 'self' || a.targeting.kind === 'none') return 'self';
  return 'wedge';
}

const FAMILY_PATHS: Record<Family, JSX.Element> = {
  bolt: <g {...S}><path d="M4 20L16.5 7.5" /><path d="M11 6.5h7v7" /><path d="M4 15.5l4.5 4.5" opacity="0.55" /></g>,
  volley: <g {...S}><path d="M4 19L17 6" /><path d="M13 5.5h4.5V10" /><path d="M4 12.5L12 4.5" opacity="0.6" /><path d="M11.5 19.5l8-8" opacity="0.6" /></g>,
  dash: <g {...S}><path d="M4 7l5 5-5 5" /><path d="M10.5 7l5 5-5 5" /><path d="M17 7l3 5-3 5" opacity="0.6" /></g>,
  blink: <g {...S}><path d="M3.5 12h3M9 12h2.5" stroke-dasharray="1.5 2.5" /><path d="M17 6.5l4 5.5-4 5.5-4-5.5z" /></g>,
  burst: <g {...S}><circle cx="12" cy="12" r="3.6" /><path d="M12 2.5v3.2M12 18.3v3.2M2.5 12h3.2M18.3 12h3.2M5.3 5.3l2.3 2.3M16.4 16.4l2.3 2.3M5.3 18.7l2.3-2.3M16.4 7.6l2.3-2.3" /></g>,
  cone: <g {...S}><path d="M4 12L19 5.5M4 12l15 6.5" /><path d="M19 5.5a14 14 0 0 1 0 13" /><path d="M10 9.5a7 7 0 0 1 0 5" opacity="0.6" /></g>,
  line: <g {...S}><rect x="3.5" y="9" width="17" height="6" rx="1" /><path d="M7 12h10" opacity="0.6" /></g>,
  zone: <g {...S}><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.4 2.2" /><circle cx="12" cy="12" r="4.6" /><circle cx="12" cy="12" r="1.2" fill="currentColor" /></g>,
  shield: <g {...S}><path d="M12 3.5l7 2.6v5.4c0 4.3-3 7.4-7 9-4-1.6-7-4.7-7-9V6.1z" /><path d="M8.5 11.5l7-3.5" opacity="0.6" /></g>,
  heal: <g {...S}><path d="M12 5v14M5 12h14" stroke-width="2.6" /><circle cx="12" cy="12" r="9" opacity="0.4" /></g>,
  buff: <g {...S}><path d="M6 13.5l6-6 6 6" /><path d="M6 19l6-6 6 6" opacity="0.6" /><path d="M12 3.5v2" /></g>,
  stun: <g {...S}><path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" /><circle cx="12" cy="11" r="9" opacity="0.35" stroke-dasharray="2 3" /></g>,
  slow: <g {...S}><path d="M5 18l4-12 3 8 2-5 5 9" /><path d="M3.5 20.5h17" opacity="0.6" /></g>,
  summon: <g {...S}><path d="M12 4.5l4.5 8h-9z" /><path d="M8 16.5h8M6 20h12" /></g>,
  mark: <g {...S}><circle cx="12" cy="12" r="7.5" /><path d="M12 4.5v4M12 15.5v4M4.5 12h4M15.5 12h4" /></g>,
  self: <g {...S}><circle cx="12" cy="12" r="8" /><path d="M12 4l2.2 8L12 14l-2.2-2z" fill="currentColor" stroke="none" /></g>,
  wedge: <g {...S}><path d="M5 19L12 4l7 15-7-4z" /></g>,
};

/** an ability icon: the asset when it exists, else the family glyph over the fighter palette */
export function AbilityGlyph(p: { def: AbilityCore | undefined; src: string | null; palette?: [string, string]; ult?: boolean; spell?: boolean }): JSX.Element {
  const fam = abilityFamily(p.def);
  const [a, b] = p.palette ?? ['#2C333F', '#8F8A80'];
  const bg = p.spell
    ? 'radial-gradient(120% 120% at 30% 20%, #262C37 0%, #171B22 70%)'
    : `radial-gradient(130% 120% at 25% 15%, color-mix(in srgb, ${b} 55%, #11141A) 0%, color-mix(in srgb, ${a} 60%, #0B0D11) 62%, #0B0D11 100%)`;
  return (
    <span class={`hglyph ${p.ult ? 'hglyph--ult' : ''}`} style={{ background: bg }} aria-hidden="true">
      {p.src ? <img src={p.src} alt="" draggable={false} /> : (
        <svg viewBox="0 0 24 24" class="hglyph__svg">{FAMILY_PATHS[fam]}</svg>
      )}
      {p.ult && !p.src ? <span class="hglyph__ultmark" /> : null}
    </span>
  );
}

// ── items ────────────────────────────────────────────────────────────────────────────────────────
type ItemTag = ItemDefT['tags'][number];
const ITEM_PATHS: Partial<Record<ItemTag, JSX.Element>> & { plain: JSX.Element } = {
  attack: <g {...S}><path d="M5 19L17 7" stroke-width="2.2" /><path d="M14 4.5l5.5 5.5" /><path d="M5 15.5l3.5 3.5" /></g>,
  magic: <g {...S}><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="9" opacity="0.45" /><circle cx="10" cy="10" r="1.3" fill="currentColor" /></g>,
  defense: <g {...S}><rect x="5" y="5" width="14" height="14" rx="1.5" /><path d="M5 12h14" opacity="0.6" /></g>,
  speed: <g {...S}><path d="M4 8h9M6 12h11M4 16h9" /><path d="M16 6l4 6-4 6" /></g>,
  sustain: <g {...S}><path d="M12 4c3.5 4.4 5.5 7.6 5.5 10a5.5 5.5 0 0 1-11 0c0-2.4 2-5.6 5.5-10z" /></g>,
  support: <g {...S}><path d="M8 9h8l-1 9H9z" /><path d="M10 9V6.5h4V9" /><path d="M12 12.5v2.5" /></g>,
  crit: <g {...S}><path d="M12 3l2 7 7 2-7 2-2 7-2-7-7-2 7-2z" /></g>,
  onhit: <g {...S}><circle cx="12" cy="12" r="7.5" /><path d="M12 7.5v9M7.5 12h9" opacity="0.6" /></g>,
  haste: <g {...S}><path d="M7 4h10L7 20h10" /><path d="M9 4.5h6M9 19.5h6" opacity="0.6" /></g>,
  vision: <g {...S}><path d="M3 12c2.5-4 5.5-6 9-6s6.5 2 9 6c-2.5 4-5.5 6-9 6s-6.5-2-9-6z" /><circle cx="12" cy="12" r="2.5" /></g>,
  jungle: <g {...S}><path d="M12 20V9M12 13l-4-4M12 11l4-5" /></g>,
  utility: <g {...S}><path d="M12 4l7 8-7 8-7-8z" /></g>,
  plain: <g {...S}><path d="M12 4l7 8-7 8-7-8z" /></g>,
};

/** item tier → hour-ticks (bible: Slate 1 · Verdigris 2 · Gloam 3 · Noonlit 4) */
export function itemHour(tier: ItemDefT['tier'] | undefined): 1 | 2 | 3 | 4 {
  switch (tier) {
    case 'apex': return 4;
    case 'core': return 3;
    case 'basic': case 'boots': return 2;
    default: return 1;
  }
}
export const HOUR_COLOR = ['', 'var(--tier-slate)', 'var(--tier-verdigris)', 'var(--tier-gloam)', 'var(--tier-noonlit)'] as const;

export function ItemGlyph(p: { item: ItemDefT | undefined; src: string | null }): JSX.Element {
  const it = p.item;
  const hour = itemHour(it?.tier);
  const tag = it?.tags.find((t) => ITEM_PATHS[t]) ?? 'plain';
  return (
    <span class={`iglyph iglyph--h${hour}`} style={{ '--hour': HOUR_COLOR[hour] } as CSSProperties} aria-hidden="true">
      {p.src ? <img src={p.src} alt="" draggable={false} /> : <svg viewBox="0 0 24 24" class="iglyph__svg">{ITEM_PATHS[tag] ?? ITEM_PATHS.plain}</svg>}
      <span class="iglyph__ticks">{Array.from({ length: hour }, () => <i />)}</span>
    </span>
  );
}

/** Gleam: a mote of stopped light (a small four-point glint, never a coin) */
export function GleamGlyph(p: { size?: number }): JSX.Element {
  const s = p.size ?? 14;
  return (
    <svg class="gleam" viewBox="0 0 16 16" width={s} height={s} aria-hidden="true">
      <path d="M8 1.5l1.6 4.9L14.5 8l-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6z" fill="currentColor" />
    </svg>
  );
}

// ── pings ────────────────────────────────────────────────────────────────────────────────────────
export function PingGlyph(p: { kind: PingKind; size?: number; class?: string }): JSX.Element {
  const st = { fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  const g: Record<PingKind, JSX.Element> = {
    alert: <g {...st}><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="8.5" opacity="0.7" /></g>,
    danger: <g {...st}><path d="M4 5h16L12 20z" /><path d="M12 8.5v5" stroke-width="2.4" /><circle cx="12" cy="16.2" r="0.6" fill="currentColor" /></g>,
    onMyWay: <g {...st}><path d="M4 18L12 4l8 14-8-4z" /></g>,
    missing: <g {...st}><path d="M17.6 6.4A8 8 0 1 0 20 12" stroke-dasharray="3 2.4" /><path d="M12 9v3.5" /></g>,
    assist: <g {...st}><path d="M3 7l6 5-6 5" /><path d="M21 7l-6 5 6 5" /></g>,
    push: <g {...st}><path d="M4 7l4 5-4 5M10 7l4 5-4 5M16 7l4 5-4 5" /></g>,
    vision: <g {...st}><path d="M9 8h6l-1 8h-4z" /><path d="M10.5 8V6h3v2" /><circle cx="12" cy="12" r="10" stroke-dasharray="2 2.6" opacity="0.7" /></g>,
    objective: <g {...st}><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></g>,
    retreat: <g {...st}><path d="M20 7l-4 5 4 5M14 7l-4 5 4 5M8 7l-4 5 4 5" /></g>,
  };
  const s = p.size ?? 24;
  return <svg class={`pglyph ${p.class ?? ''}`} viewBox="0 0 24 24" width={s} height={s} aria-hidden="true">{g[p.kind]}</svg>;
}

/** side marks for team modes (absolute: Aubade spire ▲, Serenade dome ◠) */
export function SideGlyph(p: { team: number; size?: number }): JSX.Element {
  const s = p.size ?? 14;
  return p.team === 0
    ? <svg viewBox="0 0 16 16" width={s} height={s} aria-hidden="true"><path d="M8 2l5.5 11h-11z" fill="currentColor" /></svg>
    : <svg viewBox="0 0 16 16" width={s} height={s} aria-hidden="true"><path d="M2 12.5a6 6 0 0 1 12 0z" fill="currentColor" /></svg>;
}
