// VALE UI — the setup layer (client_hud §3.6): skin strip, Hour spells, boons by path. One panel for
// the draft's finalize phase and the standalone `loadout` screen. Rules are shown as text, never hidden:
// "Boons must come from one path." · "Not available in FRAY." · "Fill every slot to lock in." Spells and
// boons outside the mode's pool (rules.itemPool vs SetupDef pools) are dashed with the reason (locked,
// never grey). Spell slots carry the player's spell keys.
// Skin cards (client F8): the name gets two lines (never cut), and ownership is ONE chip with the tier's hour-ticks
// inside — Equipped, Owned, or the price with the currency glyph; the long "In the shop for …" line is the tooltip's.
// `tabs` (the draft's finalize, client F9): Hour spells and boons sit behind two tabs that count their filled slots,
// so the whole panel fits at 1280 x 720.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { SkinDefT } from '../../contracts/catalog.ts';
import type { LoadoutChoice } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import type { BoonT, FighterDefT, SpellT } from '../catalog_view.ts';
import { fmtInt } from '../format.ts';
import { keyShort } from '../keys.ts';
import { Icon } from './Glyphs.tsx';
import { Currency } from './Currency.tsx';
import { HourTicks } from './Plate.tsx';
import { Portrait, SetupIcon } from './Portrait.tsx';
import { AbilityTip, TipText, useTip } from './Tooltip.tsx';

const TIER_TICKS: Record<SkinDefT['tier'], number> = { base: 1, standard: 2, deluxe: 3, legend: 4 };

export function ownsSkin(owned: readonly { kind: string; ref: string }[], skin: string): boolean { return owned.some((o) => o.kind === 'skin' && o.ref === skin); }

export function SkinStrip(p: { fighter: FighterDefT; value: string | undefined; onPick: (s: SkinDefT) => void; onShop?: (sku: string) => void; draftOnly?: boolean; size?: 's' | 'm';
  /** 'cells': the cards alone, for a parent grid (the collection's Skins tab) */
  as?: 'strip' | 'cells' }): JSX.Element {
  const { cv, state, sound } = useApp();
  const profile = state.profile.value;
  const skins = cv.skinsOf(p.fighter.id);
  const equipped = profile.equipped[p.fighter.id] ?? cv.baseSkin(p.fighter.id)?.id;
  if (!skins.length) return <p class="t-body-s muted">{cv.t('collection.empty_skins', 'No skins for {fighter} yet.', { fighter: p.fighter.name })}</p>;
  const cards = (
      skins.map((s) => {
        const owned = ownsSkin(profile.owned, s.id) || s.tier === 'base';
        const offer = cv.offerForSkin(s.id);
        const cur = offer ? cv.currency(offer.price.currency) : undefined;
        const price = offer ? `${fmtInt(offer.price.amount)} ${cur?.name ?? ''}`.trim() : '';
        const sel = p.value === s.id;
        const lockLine = owned ? null : offer ? cv.t('collection.skin.locked', 'In the shop for {price}', { price }) : cv.t('state.locked.skin', 'Buy {skin} in the shop to use it.', { skin: s.name });
        const state2 = s.id === equipped ? cv.t('collection.skin.equipped', 'Equipped') : owned ? cv.t('collection.skin.owned', 'Owned') : lockLine;
        const chip = owned ? <span class="t-caption">{state2}</span>
          : offer ? <Currency id={offer.price.currency} amount={offer.price.amount} size="s" tick={false} />
            : <span class="t-caption">{cv.t('collection.skin.not_for_sale', 'Not for sale')}</span>;
        return (
          <SkinCard skin={s} fighter={p.fighter} selected={sel} owned={owned} stateLine={state2 ?? ''} lockLine={lockLine} chip={chip} equipped={s.id === equipped}
            onPress={() => {
              if (owned) { if (!sel) { sound.play('toggle'); p.onPick(s); } }
              else if (offer && p.onShop && !p.draftOnly) p.onShop(offer.sku);
              else sound.play('error');
            }} />
        );
      })
  );
  if (p.as === 'cells') return <>{cards}</>;
  return (
    <div class={`skins skins--${p.size ?? 'm'}`} role="radiogroup" aria-label={cv.t('loadout.skin', 'Skin')} data-arrownav="row">
      {cards}
    </div>
  );
}

function SkinCard(p: { skin: SkinDefT; fighter: FighterDefT; selected: boolean; owned: boolean; equipped?: boolean; stateLine: string; lockLine: string | null; chip: JSX.Element; onPress: () => void }): JSX.Element {
  const { cv, sound } = useApp();
  const tip = useTip(() => <TipText text={p.skin.name} sub={p.lockLine ?? cv.t('loadout.skin_hint', 'Skins change how a fighter looks, never how they play.')} />, { place: 'above' });
  return (
    <button type="button" role="radio" aria-checked={p.selected} data-nav="" class={`skin ${p.selected ? 'is-selected' : ''} ${p.owned ? '' : 'is-locked'}`}
      aria-label={`${p.skin.name}. ${p.stateLine}`}
      onPointerEnter={(e) => { tip.onPointerEnter(e); sound.play('hover'); }} onPointerLeave={tip.onPointerLeave} onFocus={tip.onFocus} onBlur={tip.onBlur}
      onPointerDown={() => { if (!p.owned) sound.play('click'); }} onClick={p.onPress}>
      <Portrait fighter={p.fighter} skin={p.skin.id} size="fill" class="skin__art" />
      {p.selected ? <span class="tick" aria-hidden="true" /> : null}
      {!p.owned ? <Icon name="lock" class="skin__lock" /> : null}
      <span class="skin__meta">
        <span class="skin__name t-body-s">{p.skin.tier === 'base' ? cv.t('collection.skin.default', 'Base skin') : p.skin.name}</span>
        <span class={`skin__chip ${p.equipped ? 'is-equipped' : p.owned ? 'is-owned' : 'is-shop'}`}><HourTicks n={TIER_TICKS[p.skin.tier]} label={cv.t(`shop.tier.${p.skin.tier}`, p.skin.tier)} />{p.chip}</span>
      </span>
    </button>
  );
}

export interface LoadoutPanelProps {
  fighter: FighterDefT;
  skin?: string;
  loadout: LoadoutChoice;
  pool?: string;
  modeName?: string;
  onSkin?: (s: SkinDefT) => void;
  onLoadout: (l: LoadoutChoice) => void;
  onShop?: (sku: string) => void;
  /** draft finalize: only owned skins, no shop links */
  draft?: boolean;
  hideSkins?: boolean;
  readOnly?: string;
  /** Hour spells and boons behind two tabs (the draft's finalize) */
  tabs?: boolean;
}

export function LoadoutPanel(p: LoadoutPanelProps): JSX.Element {
  const { cv, state, sound } = useApp();
  const set = cv.c.setup;
  const nSpells = cv.spellSlots();
  const nBoons = cv.boonSlots(p.pool);
  const binds = state.settings.value.controls.binds;
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<'spells' | 'boons'>('spells');
  const firstPath = p.loadout.boons.length ? cv.boon(p.loadout.boons[0])?.path : undefined;
  const [path, setPath] = useState<string>(firstPath ?? set.paths[0]?.id ?? '');
  const modeName = p.modeName ?? '';
  const notHere = (pools: readonly string[]): string | null => (cv.inPool(pools, p.pool) ? null : cv.t('loadout.not_here', 'Not available in {mode}.', { mode: modeName }));

  const pickSpell = (s: SpellT): void => {
    if (p.readOnly) { sound.play('error'); return; }
    if (notHere(s.pools)) { sound.play('error'); return; }
    const spells = Array.from({ length: nSpells }, (_, i) => p.loadout.spells[i] ?? '');
    const other = spells.indexOf(s.id);
    if (other >= 0 && other !== active) spells[other] = spells[active];
    spells[active] = s.id;
    sound.play('toggle');
    p.onLoadout({ ...p.loadout, spells: spells.filter(Boolean) });
    const nextEmpty = spells.findIndex((x) => !x);
    setActive(nextEmpty >= 0 ? nextEmpty : active);
  };
  const pickBoon = (b: BoonT): void => {
    if (p.readOnly) { sound.play('error'); return; }
    if (notHere(b.pools)) { sound.play('error'); return; }
    let boons = p.loadout.boons.filter((id) => cv.boon(id)?.path === b.path);
    if (boons.includes(b.id)) boons = boons.filter((x) => x !== b.id);
    else { boons = [...boons, b.id]; if (boons.length > nBoons) boons = boons.slice(boons.length - nBoons); }
    sound.play('toggle');
    p.onLoadout({ ...p.loadout, boons });
  };
  const full = p.loadout.spells.length >= nSpells && p.loadout.boons.length >= nBoons;
  const mixed = new Set(p.loadout.boons.map((id) => cv.boon(id)?.path)).size > 1;
  const spellKey = (i: number): string => keyShort(binds[`spell${i + 1}`]);
  const res = cv.resource(p.fighter.resource);

  return (
    <div class="loadout">
      {!p.hideSkins ? (
        <section class="loadout__sect stg">
          <div class="sect__head"><h3 class="t-h2">{cv.t('loadout.skin', 'Skin')}</h3><span class="t-body-s sect__hint">{cv.t('loadout.skin_hint', 'Skins change how a fighter looks, never how they play.')}</span></div>
          <SkinStrip fighter={p.fighter} value={p.skin} onPick={(s) => p.onSkin?.(s)} onShop={p.onShop} draftOnly={p.draft} size="s" />
        </section>
      ) : null}

      {p.tabs && nBoons > 0 ? (
        <div class="tabs tabs--s loadout__tabs" role="tablist" aria-label={cv.t('loadout.title', 'Loadout')}>
          {(['spells', 'boons'] as const).map((t) => {
            const have = t === 'spells' ? p.loadout.spells.length : p.loadout.boons.length;
            const need = t === 'spells' ? nSpells : nBoons;
            return (
              <button type="button" role="tab" aria-selected={tab === t} class={`tab ${tab === t ? 'is-selected' : ''}`} tabIndex={tab === t ? 0 : -1}
                onPointerDown={() => sound.play('tab')} onClick={() => setTab(t)}
                onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setTab(t === 'spells' ? 'boons' : 'spells'); } }}>
                <span class="t-label">{t === 'spells' ? cv.t('loadout.spells', 'Hour spells') : cv.t('loadout.boons', 'Boons')}</span>
                <span class={`tab__badge num ${have >= need ? '' : 'reason--warn'}`}>{have}/{need}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {!p.tabs || nBoons === 0 || tab === 'spells' ? (
      <section class="loadout__sect stg">
        <div class="sect__head">
          {p.tabs && nBoons > 0 ? null : <h3 class="t-h2">{cv.t('loadout.spells', 'Hour spells')}</h3>}
          <span class="t-body-s sect__hint">{nBoons === 0 ? cv.t('loadout.spells_hint_fray', 'Pick {n}. FRAY has no boons.', { n: nSpells }) : cv.t('loadout.spells_hint', 'Pick {n}. Cast them with the spell keys.', { n: nSpells })}</span>
        </div>
        <div class="slots" role="radiogroup" aria-label={cv.t('loadout.spells', 'Hour spells')}>
          {Array.from({ length: nSpells }, (_, i) => {
            const sp = cv.spell(p.loadout.spells[i]);
            return (
              <button type="button" role="radio" aria-checked={active === i} class={`slot ${active === i ? 'is-active' : ''} ${sp ? '' : 'is-empty'}`}
                onPointerDown={() => sound.play('tab')} onClick={() => setActive(i)}
                aria-label={`${cv.t('loadout.slot_n', 'Slot {n}', { n: i + 1 })}: ${sp?.name ?? cv.t('loadout.slot_empty', 'Empty')}`}>
                <SetupIcon icon={sp?.icon} kind="spell" keyLabel={spellKey(i)} size="s" />
                <span class="slot__text"><span class="t-caption muted">{cv.t('loadout.slot_n', 'Slot {n}', { n: i + 1 })}</span><span class="t-body-s">{sp?.name ?? cv.t('loadout.slot_empty', 'Empty')}</span></span>
              </button>
            );
          })}
        </div>
        <div class="picks" data-arrownav="grid">
          {set.spells.map((s) => {
            const slotIdx = p.loadout.spells.indexOf(s.id);
            return <SetupTile record={s} kind="spell" selected={slotIdx >= 0} badge={slotIdx >= 0 ? spellKey(slotIdx) : undefined} reason={notHere(s.pools)} onPress={() => pickSpell(s)} />;
          })}
        </div>
      </section>
      ) : null}

      {nBoons > 0 && (!p.tabs || tab === 'boons') ? (
        <section class="loadout__sect stg">
          <div class="sect__head">
            {p.tabs ? null : <h3 class="t-h2">{cv.t('loadout.boons', 'Boons')}</h3>}
            <span class={`t-body-s sect__hint ${mixed ? 'reason--warn' : ''}`}>{mixed ? cv.t('loadout.path_mixed', 'Pick both boons from the same path.') : cv.t('loadout.path_one', 'Boons must come from one path.')}</span>
          </div>
          <div class="paths" role="tablist" aria-label={cv.t('loadout.path', 'Path')}>
            {set.paths.map((pt) => {
              const n = p.loadout.boons.filter((id) => cv.boon(id)?.path === pt.id).length;
              return (
                <button type="button" role="tab" aria-selected={path === pt.id} class={`pathtab ${path === pt.id ? 'is-selected' : ''}`} style={{ '--path': pt.color }}
                  onPointerDown={() => sound.play('tab')} onClick={() => setPath(pt.id)} title={pt.desc}>
                  <span class="pathtab__dot" /><span class="t-label">{pt.name}</span>{n ? <span class="num tab__badge">{n}/{nBoons}</span> : null}
                </button>
              );
            })}
          </div>
          <p class="t-body-s muted paths__desc">{cv.path(path)?.desc}</p>
          <div class="picks" data-arrownav="grid">
            {set.boons.filter((b) => b.path === path).map((b) => (
              <SetupTile record={b} kind="boon" pathColor={cv.path(b.path)?.color} selected={p.loadout.boons.includes(b.id)} reason={notHere(b.pools)} onPress={() => pickBoon(b)} />
            ))}
          </div>
        </section>
      ) : null}

      <p class={`t-body-s loadout__rule ${full ? 'muted' : 'reason--warn'}`} role="status">
        {p.readOnly ?? (full ? cv.t('loadout.summary', '{spell1} and {spell2}', { spell1: cv.spell(p.loadout.spells[0])?.name ?? '', spell2: cv.spell(p.loadout.spells[1])?.name ?? '' }) + (res ? ` · ${res.name}` : '') : cv.t('loadout.needs_full', 'Fill every slot to lock in.'))}
      </p>
    </div>
  );
}

function SetupTile(p: { record: SpellT | BoonT; kind: 'spell' | 'boon'; selected: boolean; badge?: string; reason: string | null; pathColor?: string; onPress: () => void }): JSX.Element {
  const { cv, sound } = useApp();
  const r = p.record;
  const tip = useTip(() => (
    <>
      <AbilityTip record={r as unknown as Parameters<typeof AbilityTip>[0]['record']} kind={p.kind === 'spell' ? cv.t('loadout.spells', 'Hour spells') : cv.path((r as BoonT).path)?.name} cv={cv} />
      {p.reason ? <p class="t-caption reason--warn" style={{ marginTop: '6px' }}>{p.reason}</p> : null}
    </>
  ), { place: 'right', wide: true });
  return (
    <button type="button" class={`stile ${p.selected ? 'is-selected' : ''} ${p.reason ? 'is-locked' : ''}`} aria-pressed={p.selected} data-nav=""
      aria-label={`${r.name}${p.reason ? `. ${p.reason}` : ''}`} aria-disabled={p.reason ? 'true' : undefined}
      onPointerEnter={(e) => { tip.onPointerEnter(e); sound.play('hover'); }} onPointerLeave={tip.onPointerLeave} onFocus={tip.onFocus} onBlur={tip.onBlur}
      onClick={p.onPress}>
      <SetupIcon icon={r.icon} kind={p.kind} size="s" pathColor={p.pathColor} keyLabel={p.badge} />
      <span class="stile__name t-body-s">{r.name}</span>
      {p.selected ? <span class="tick" aria-hidden="true" /> : null}
      {p.reason ? <Icon name="lock" class="stile__lock" /> : null}
    </button>
  );
}
