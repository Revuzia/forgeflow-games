// VALE UI — rank emblem. Ranks climb the sun: the tier's colour (L* 45 → 100) and the sun's height on
// the horizon arc both rise with the tier; hour-ticks under the arc count it; the top tier gets a
// prismatic rim. The catalog emblem art is used when it loads; this drawing is the designed fallback
// and the provisional state (a dashed, unlit ring).

import type { JSX } from 'preact';
import type { RankTierT } from '../../contracts/catalog.ts';
import { useApp } from '../app_ctx.ts';
import { AssetImg } from './Portrait.tsx';

export function RankEmblem(p: { tier?: RankTierT; size?: number; provisional?: boolean; label?: string; class?: string; art?: boolean }): JSX.Element {
  const { cv } = useApp();
  const size = `calc(${p.size ?? 64}px * var(--k))`;
  const n = Math.max(1, cv.c.ranks.length);
  const idx = p.tier ? Math.max(0, cv.rankIndex(p.tier)) : -1;
  const color = p.tier?.color ?? 'var(--text-3)';
  const top = idx === n - 1 && n > 1;
  const h = idx < 0 ? 0 : (idx + 1) / n;            // sun height share
  const sunY = 70 - h * 42;
  const label = p.label ?? (p.provisional ? 'Provisional' : p.tier?.name ?? 'Unranked');
  const drawn = (
    <svg viewBox="0 0 100 100" class="rank__svg" aria-hidden="true">
      <defs>
        <linearGradient id="prism-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#9FD4FF" /><stop offset="0.35" stop-color="#C9B8FF" /><stop offset="0.7" stop-color="#FFD9A8" /><stop offset="1" stop-color="#B9F2D5" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="46" fill="var(--ink-1)" stroke={p.provisional || idx < 0 ? 'var(--line-2)' : top ? 'url(#prism-rim)' : color}
        stroke-width={top ? 4 : 2.5} stroke-dasharray={p.provisional ? '4 5' : undefined} />
      <path d="M14 70 A36 36 0 0 1 86 70" fill="none" stroke="var(--line-2)" stroke-width="1.5" />
      <line x1="10" y1="70" x2="90" y2="70" stroke={p.provisional || idx < 0 ? 'var(--line-2)' : color} stroke-width="2" />
      {idx >= 0 && !p.provisional ? <circle cx="50" cy={sunY} r={9 + h * 5} fill={color} /> : null}
      {idx >= 0 && !p.provisional ? Array.from({ length: Math.min(4, Math.ceil(((idx + 1) / n) * 4)) }, (_, i) => (
        <rect x={50 - 9 + i * 5.5 - (Math.min(4, Math.ceil(((idx + 1) / n) * 4)) - 1) * 2.75 + 6.25} y="78" width="2" height="7" fill={color} />
      )) : <text x="50" y="58" text-anchor="middle" font-size="22" fill="var(--text-3)" font-family="var(--font-numeric)">?</text>}
    </svg>
  );
  return (
    <span class={`rank ${p.class ?? ''}`} style={{ width: size, height: size }} role="img" aria-label={label}>
      {p.art && p.tier && !p.provisional ? <AssetImg src={cv.asset(p.tier.emblem)} alt="" fallback={drawn} fit="contain" /> : drawn}
    </span>
  );
}
