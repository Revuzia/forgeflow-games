// VALE UI — Shop (client_hud §3.10). Shelves from store.shelves in order (hero · row · grid layouts),
// offer cards (splash, skin, fighter, tier hour-ticks, price, the gloam New badge), the selected offer
// previewed in columns 7–12. Buy: ConfirmDialog ("Buy X for 2,250 Candles?" + the balance left) →
// Session.purchase → "X is yours. Equip it?". Not enough Candles: the button stays enabled and the
// modal says how many are missing and how to earn them (Play a match), nothing is charged. Owned
// offers show Owned / Equipped. Empty shelf: "Nothing on this shelf yet." Candles only: no premium
// currency, no real-money copy anywhere.

import type { JSX } from 'preact';
import type { SkinDefT } from '../../contracts/catalog.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Currency } from '../components/Currency.tsx';
import { ownsSkin } from '../components/LoadoutPanel.tsx';
import { confirmDialog } from '../components/Modal.tsx';
import { HourTicks } from '../components/Plate.tsx';
import { Portrait, StageArt } from '../components/Portrait.tsx';
import { Screen } from '../components/Screen.tsx';
import { EmptyState } from '../components/States.tsx';
import type { OfferT, ShelfT } from '../catalog_view.ts';
import { fmtInt } from '../format.ts';

const TIER_TICKS: Record<SkinDefT['tier'], number> = { base: 1, standard: 2, deluxe: 3, legend: 4 };

export function ShopScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state, session, overlay, sound } = useApp();
  const profile = state.profile.value;
  const store = cv.c.store;
  const cur = cv.earnedCurrency();
  const balance = (id: string): number => profile.wallet[id] ?? 0;
  const offers = store.offers.filter((o) => cv.offerAvailable(o) && cv.skin(o.ref));
  const sel = cv.offer(p.params.sku) ?? offers[0];
  const selSkin = cv.skin(sel?.ref);
  const selFighter = cv.fighter(selSkin?.fighter);
  const owned = (o: OfferT): boolean => ownsSkin(profile.owned, o.ref);
  const equipped = (o: OfferT): boolean => { const s = cv.skin(o.ref); return !!s && profile.equipped[s.fighter] === s.id; };
  const priceText = (o: OfferT): string => cv.t('shop.price', '{n} {currency}', { n: fmtInt(o.price.amount), currency: cv.currency(o.price.currency)?.name ?? '' });

  const equip = (o: OfferT): void => {
    const s = cv.skin(o.ref);
    if (!s) return;
    const r = session.equipSkin(s.fighter, s.id);
    if (r.ok) { sound.play('equip'); state.toast(cv.t('toast.skin_equipped', '{skin} equipped.', { skin: s.name }), 'ok'); }
    else state.toast(cv.t(`error.equip.${r.reason ?? 'not_owned'}`, 'You do not own {skin} yet.', { skin: s.name }), 'error');
  };
  const insufficient = (o: OfferT): void => {
    const c = cv.currency(o.price.currency);
    const missing = o.price.amount - balance(o.price.currency);
    sound.play('error');
    overlay.open({
      title: cv.t('shop.insufficient.title', 'Not enough {currency}', { currency: c?.name ?? '' }), size: 's',
      render: (close) => (
        <div class="confirm">
          <div class="confirm__body">
            <p class="t-body">{cv.t('shop.insufficient.body', 'You need {missing} more {currency} for {skin}.', { missing: fmtInt(missing), currency: c?.name ?? '', skin: cv.skin(o.ref)?.name ?? '' })}</p>
            <p class="t-body-s muted">{cv.t('shop.insufficient.hint', 'Candles come from playing matches.')}</p>
            <div class="row"><span class="t-caption muted">{cv.t('shop.balance', 'Your Candles')}</span><Currency id={o.price.currency} amount={balance(o.price.currency)} /></div>
          </div>
          <div class="confirm__actions">
            <Button variant="quiet" cue="back" onPress={close}>{cv.t('common.close', 'Close')}</Button>
            <Button variant="chalk" wedge data-autofocus="" onPress={() => { close(); router.go('play', {}, { root: true }); }}>{cv.t('shop.insufficient.cta', 'Play a match')}</Button>
          </div>
        </div>
      ),
    });
  };
  const buy = async (o: OfferT): Promise<void> => {
    const s = cv.skin(o.ref);
    if (!s) return;
    if (balance(o.price.currency) < o.price.amount) { insufficient(o); return; }
    const c = cv.currency(o.price.currency);
    const ok = await confirmDialog(overlay, {
      title: cv.t('shop.confirm.title', 'Confirm purchase'),
      body: <>
        <p class="t-body">{cv.t('shop.confirm.body', 'Buy {skin} for {price}?', { skin: s.name, price: priceText(o) })}</p>
        <p class="t-body-s muted">{cv.t('shop.confirm.balance_after', 'You will have {n} {currency} left.', { n: fmtInt(balance(o.price.currency) - o.price.amount), currency: c?.name ?? '' })}</p>
        <p class="t-caption quiet">{cv.t('shop.cosmetic_only', 'Cosmetic only. Skins never change stats.')}</p>
      </>,
      confirm: cv.t('shop.confirm.buy', 'Buy'), cancel: cv.t('shop.confirm.cancel', 'Cancel'),
    });
    if (!ok) return;
    const r = session.purchase(o.sku);
    if (!r.ok) {
      if (r.reason === 'funds') { insufficient(o); return; }
      state.toast(r.reason === 'owned' ? cv.t('error.purchase.owned', 'You already own {skin}.', { skin: s.name })
        : r.reason === 'unavailable' ? cv.t('shop.unavailable', '{skin} is not for sale right now.', { skin: s.name }) : cv.t('shop.error', 'The purchase did not go through. You were not charged.'), 'error');
      return;
    }
    sound.play('purchase');
    overlay.open({
      title: cv.t('shop.bought_title', 'Purchase complete'), size: 's',
      render: (close) => (
        <div class="confirm">
          <div class="confirm__body bought">
            <Portrait fighter={cv.fighter(s.fighter)} skin={s.id} size="l" />
            <p class="t-body">{cv.t('shop.bought', '{skin} is yours. Equip it?', { skin: s.name })}</p>
          </div>
          <div class="confirm__actions">
            <Button variant="quiet" cue="back" onPress={close}>{cv.t('shop.not_now', 'Not now')}</Button>
            <Button variant="chalk" wedge cue={null} data-autofocus="" onPress={() => { equip(o); close(); }}>{cv.t('shop.equip_now', 'Equip now')}</Button>
          </div>
        </div>
      ),
    });
  };

  let cta: JSX.Element | null = null;
  if (sel && selSkin) {
    if (owned(sel)) cta = <Button variant="chalk" size="l" wedge cue={null} disabled={equipped(sel)} reason={cv.t('shop.equipped', 'Equipped')} onPress={() => equip(sel)}>{equipped(sel) ? cv.t('shop.equipped', 'Equipped') : cv.t('shop.equip', 'Equip')}</Button>;
    else cta = <Button variant="chalk" size="l" wedge cue="click" onPress={() => void buy(sel)}>{cv.t('shop.buy_for', 'Buy for {price}', { price: priceText(sel) })}</Button>;
  }
  return (
    <Screen title={cv.t('shop.title', 'Shop')}
      headSide={cur ? <div class="shop__balance"><span class="t-caption muted">{cv.t('shop.balance', 'Your Candles')}</span><Currency id={cur.id} amount={balance(cur.id)} size="l" /></div> : null}
      foot={<span class="t-body-s muted">{cv.t('shop.earn_hint', 'Candles are earned by playing matches.')} {cv.t('shop.sub', 'Skins change how a fighter looks, never how they play.')}</span>}
      cta={cta}
      stage={sel && selSkin ? (
        <div class="stagecard">
          <StageArt fighter={selFighter} skin={selSkin.id} />
          <div class="stagecard__cap plate">
            <span class="row row--s"><HourTicks n={TIER_TICKS[selSkin.tier]} label={cv.t(`shop.tier.${selSkin.tier}`, selSkin.tier)} /><span class="t-label muted">{cv.t(`shop.tier.${selSkin.tier}`, selSkin.tier)}</span></span>
            <span class="t-h1">{selSkin.name}</span>
            <span class="t-body-s muted">{cv.t('shop.for_fighter', 'For {fighter}', { fighter: selFighter?.name ?? '' })}</span>
            {selSkin.desc ? <p class="t-body-s">{selSkin.desc}</p> : null}
            <span class="row row--s">{owned(sel) ? <span class="chip chip--ok">{equipped(sel) ? cv.t('shop.equipped', 'Equipped') : cv.t('shop.owned', 'Owned')}</span> : <Currency id={sel.price.currency} amount={sel.price.amount} tick={false} />}</span>
          </div>
        </div>
      ) : undefined}>
      {offers.length === 0 ? <EmptyState text={cv.t('state.empty.shop', 'The shop has nothing to show right now.')} /> : (
        <div class="shop">
          {store.shelves.map((sh) => <Shelf shelf={sh} selected={sel?.sku} owned={owned} equipped={equipped} onPick={(o) => router.setParams({ sku: o.sku })} />)}
        </div>
      )}
    </Screen>
  );
}

function Shelf(p: { shelf: ShelfT; selected?: string; owned: (o: OfferT) => boolean; equipped: (o: OfferT) => boolean; onPick: (o: OfferT) => void }): JSX.Element {
  const { cv } = useApp();
  const offers = p.shelf.skus.map((s) => cv.offer(s)).filter((o): o is OfferT => !!o && cv.offerAvailable(o) && !!cv.skin(o.ref));
  return (
    <section class={`shelf shelf--${p.shelf.layout} stg`} aria-label={p.shelf.name}>
      <h2 class="t-h2 shelf__title">{p.shelf.name}<span class="t-caption muted num">{offers.length}</span></h2>
      {offers.length === 0 ? <EmptyState compact text={cv.t('state.empty.shelf', 'Nothing on this shelf yet.')} /> : (
        <div class="shelf__cards" data-arrownav="grid">
          {offers.map((o, i) => <OfferCard o={o} hero={p.shelf.layout === 'hero' && i === 0} selected={p.selected === o.sku} owned={p.owned(o)} equipped={p.equipped(o)} onPick={() => p.onPick(o)} />)}
        </div>
      )}
    </section>
  );
}

function OfferCard(p: { o: OfferT; hero: boolean; selected: boolean; owned: boolean; equipped: boolean; onPick: () => void }): JSX.Element {
  const { cv, sound } = useApp();
  const s = cv.skin(p.o.ref)!;
  const f = cv.fighter(s.fighter);
  return (
    <button type="button" class={`offer plate ${p.hero ? 'offer--hero' : ''} ${p.selected ? 'is-selected' : ''} ${p.owned ? 'is-owned' : ''}`} data-nav=""
      aria-pressed={p.selected} aria-label={`${s.name}, ${f?.name ?? ''}. ${p.owned ? cv.t('shop.owned', 'Owned') : `${fmtInt(p.o.price.amount)} ${cv.currency(p.o.price.currency)?.name ?? ''}`}`}
      onPointerEnter={() => sound.play('hover')} onPointerDown={() => sound.play('click')} onClick={p.onPick}>
      <Portrait fighter={f} skin={s.id} kind="splash" size="fill" class="offer__art" />
      {p.o.badge ? <span class="offer__badge chip chip--gloam"><span class="newdot" />{cv.t(`shop.badge.${p.o.badge}`, p.o.badge)}</span> : null}
      {p.selected ? <span class="tick" aria-hidden="true" /> : null}
      <span class="offer__meta">
        <span class="offer__name t-body-s">{s.name}</span>
        <span class="offer__sub t-caption"><HourTicks n={TIER_TICKS[s.tier]} />{f?.name}</span>
        <span class="offer__price">{p.owned ? <span class="chip chip--ok">{p.equipped ? cv.t('shop.equipped', 'Equipped') : cv.t('shop.owned', 'Owned')}</span> : <Currency id={p.o.price.currency} amount={p.o.price.amount} size="s" tick={false} />}</span>
      </span>
    </button>
  );
}
