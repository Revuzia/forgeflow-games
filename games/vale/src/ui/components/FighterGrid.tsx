// VALE UI — the fighter grid with class / role / origin filters and search (draft, collection, the
// quick-queue preset, practice, custom seats). Arrow keys move between cards (data-arrownav); the
// filter state can be lifted (collection keeps it in the route). Empty: one drawing, one sentence,
// one action (clear the filters).

import type { JSX } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import type { FighterDefT } from '../catalog_view.ts';
import { FighterCard, type FighterCardProps } from './FighterCard.tsx';
import { ClassGlyph, classShapeOf, Icon } from './Glyphs.tsx';
import { Select, type Option } from './Select.tsx';
import { EmptyState } from './States.tsx';

export interface GridFilter { cls: string; role: string; origin: string; q: string }
export const NO_FILTER: GridFilter = { cls: '', role: '', origin: '', q: '' };

export function FilterBar(p: { value: GridFilter; onChange: (f: GridFilter) => void; origin?: boolean; compact?: boolean }): JSX.Element {
  const { cv, sound } = useApp();
  const f = p.value;
  const all = cv.t('common.all', 'All');
  const roleOpts: Option<string>[] = [{ value: '', label: cv.t('draft.filter.by_role', 'Role') + ': ' + all }, ...cv.rolesOrdered().map((r) => ({ value: r.id, label: r.name, adorn: <span class="roledot" style={{ background: r.color }} /> }))];
  const origins = [...new Set(cv.fighters().map((x) => cv.originOf(x)).filter((x): x is string => !!x))];
  const originOpts: Option<string>[] = [{ value: '', label: cv.t('collection.filter.by_origin', 'Origin') + ': ' + all }, ...origins.map((o) => ({ value: o, label: cv.t(`collection.origin.${o}`, o) }))];
  return (
    <div class={`filters ${p.compact ? 'filters--compact' : ''}`}>
      <div class="filters__classes" role="radiogroup" aria-label={cv.t('draft.filter.by_class', 'Class')}>
        <button type="button" role="radio" aria-checked={!f.cls} class={`fchip ${!f.cls ? 'is-selected' : ''}`} onPointerDown={() => sound.play('tab')}
          onClick={() => p.onChange({ ...f, cls: '' })}><span class="t-label">{all}</span></button>
        {cv.c.classes.map((c) => {
          const shape = classShapeOf(c.shape, c.name);
          const sel = f.cls === c.id;
          return (
            <button type="button" role="radio" aria-checked={sel} class={`fchip ${sel ? 'is-selected' : ''}`} title={c.name} aria-label={c.name}
              onPointerDown={() => sound.play('tab')} onClick={() => p.onChange({ ...f, cls: sel ? '' : c.id })}>
              {shape ? <ClassGlyph shape={shape} size={16} /> : null}
              {p.compact ? null : <span class="t-label">{c.name}</span>}
            </button>
          );
        })}
      </div>
      <div class="filters__more">
        <Select label={cv.t('draft.filter.by_role', 'Role')} value={f.role} options={roleOpts} onChange={(v) => p.onChange({ ...f, role: v })} class="filters__select" />
        {p.origin ? <Select label={cv.t('collection.filter.by_origin', 'Origin')} value={f.origin} options={originOpts} onChange={(v) => p.onChange({ ...f, origin: v })} class="filters__select" /> : null}
        <label class="search">
          <Icon name="search" class="search__icon" />
          <input type="search" class="search__input t-body-s" placeholder={cv.t('draft.filter.search', 'Search fighters')} aria-label={cv.t('draft.filter.search', 'Search fighters')}
            value={f.q} onInput={(e) => p.onChange({ ...f, q: (e.currentTarget as HTMLInputElement).value })}
            onKeyDown={(e) => { if (e.key === 'Escape' && f.q) { e.preventDefault(); e.stopPropagation(); p.onChange({ ...f, q: '' }); } }} />
        </label>
      </div>
    </div>
  );
}

export function filterFighters(list: readonly FighterDefT[], f: GridFilter, originOf: (x: FighterDefT) => string | undefined): FighterDefT[] {
  const q = f.q.trim().toLowerCase();
  return list.filter((x) => (!f.cls || x.class === f.cls)
    && (!f.role || x.role === f.role || x.secondaryRole === f.role)
    && (!f.origin || originOf(x) === f.origin)
    && (!q || x.name.toLowerCase().includes(q) || x.title.toLowerCase().includes(q)));
}

export interface FighterGridProps {
  fighters?: readonly FighterDefT[];
  filter?: GridFilter;
  onFilter?: (f: GridFilter) => void;
  origin?: boolean;
  compactFilters?: boolean;
  card: (f: FighterDefT) => Omit<FighterCardProps, 'fighter'>;
  size?: 's' | 'm';
  cols?: number;
  label: string;
  class?: string;
}

export function FighterGrid(p: FighterGridProps): JSX.Element {
  const { cv } = useApp();
  const [own, setOwn] = useState<GridFilter>(NO_FILTER);
  const f = p.filter ?? own;
  const set = p.onFilter ?? setOwn;
  const list = useMemo(() => filterFighters(p.fighters ?? cv.fighters(), f, (x) => cv.originOf(x)), [p.fighters, f.cls, f.role, f.origin, f.q]);
  return (
    <div class={`fgrid ${p.class ?? ''}`}>
      <FilterBar value={f} onChange={set} origin={p.origin} compact={p.compactFilters} />
      {list.length ? (
        <div class={`fgrid__cards fgrid__cards--${p.size ?? 'm'}`} style={p.cols ? { gridTemplateColumns: `repeat(${p.cols}, minmax(0, 1fr))` } : undefined}
          role="list" aria-label={p.label} data-arrownav="grid">
          {list.map((x) => <div role="listitem" class="fgrid__cell"><FighterCard fighter={x} size={p.size === 's' ? 's' : 'm'} {...p.card(x)} /></div>)}
        </div>
      ) : (
        <EmptyState compact text={f.q ? cv.t('state.empty.search', 'Nothing matches "{q}".', { q: f.q }) : cv.t('state.empty.collection_fighters', 'No fighters match this filter.')}
          action={{ label: cv.t('common.reset', 'Reset'), run: () => set(NO_FILTER) }} />
      )}
    </div>
  );
}
