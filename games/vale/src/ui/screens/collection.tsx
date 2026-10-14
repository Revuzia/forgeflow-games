// VALE UI — Collection (client_hud §3.9). Fighters: the grid with class / role / origin filters and
// search (kept in the route, so Back returns to the same filter); a fighter's detail shows class, role,
// job, difficulty, resource, the kit with rich tooltips ({placeholders} resolved from the Scaling
// values, format.ts), lore and the skin strip with ownership states. The splash of the previewed skin
// is the subject in columns 7–12. EQUIP goes through Session.equipSkin. Skins: every skin by fighter,
// owned / equipped / in the shop. Empty: "You do not own any extra skins yet." + Browse the shop.

import type { JSX } from 'preact';
import type { SkinDefT } from '../../contracts/catalog.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { ClassMark } from '../components/FighterCard.tsx';
import { FighterGrid, type GridFilter } from '../components/FighterGrid.tsx';
import { HourTicks } from '../components/Plate.tsx';
import { ownsSkin, SkinStrip } from '../components/LoadoutPanel.tsx';
import { Portrait, SetupIcon, StageArt } from '../components/Portrait.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { EmptyState } from '../components/States.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { AbilityTip, RichDesc, useTip } from '../components/Tooltip.tsx';
import type { FighterDefT } from '../catalog_view.ts';
import { keyShort } from '../keys.ts';

export function CollectionScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state } = useApp();
  const tab = p.params.tab === 'skins' ? 'skins' : 'fighters';
  const f = cv.fighter(p.params.fighter);
  if (f && tab === 'fighters') return <FighterDetail f={f} preview={p.params.skin} />;
  const filter: GridFilter = { cls: p.params.cls ?? '', role: p.params.role ?? '', origin: p.params.origin ?? '', q: p.params.q ?? '' };
  const profile = state.profile.value;
  const extraOwned = profile.owned.filter((o) => o.kind === 'skin' && cv.skin(o.ref)?.tier !== 'base').length;
  const total = cv.c.skins.filter((s) => s.tier !== 'base').length;
  return (
    <Screen title={cv.t('collection.title', 'Collection')} layout={tab === 'skins' ? 'wide' : undefined}
      headSide={<span class="t-body-s muted">{cv.t('collection.free_note', 'Every fighter is free to play.')}</span>}
      foot={<span class="t-body-s muted">{cv.t('collection.skins_owned', '{n} of {m} skins owned', { n: extraOwned, m: total })}</span>}>
      <Tabs label={cv.t('collection.title', 'Collection')} value={tab} onChange={(id) => router.setParams({ tab: id })} items={[
        { id: 'fighters', label: cv.t('collection.tab.fighters', 'Fighters'), badge: cv.fighters().length },
        { id: 'skins', label: cv.t('collection.tab.skins', 'Skins'), badge: `${extraOwned}/${total}` },
      ]} />
      <div class="tabpanel">
        {tab === 'fighters' ? (
          <FighterGrid label={cv.t('collection.tab.fighters', 'Fighters')} origin filter={filter} size="s" cols={5}
            onFilter={(nf) => router.setParams({ cls: nf.cls, role: nf.role, origin: nf.origin, q: nf.q })}
            card={(x) => ({ skin: profile.equipped[x.id], onPress: () => router.go('collection', { tab: 'fighters', fighter: x.id }) })} />
        ) : <SkinsTab ownedOnly={p.params.owned === '1'} />}
      </div>
    </Screen>
  );
}

function SkinsTab(p: { ownedOnly: boolean }): JSX.Element {
  const { cv, router, state, session, sound } = useApp();
  const profile = state.profile.value;
  const equip = (f: FighterDefT, s: SkinDefT): void => {
    const r = session.equipSkin(f.id, s.id);
    if (r.ok) { sound.play('equip'); state.toast(cv.t('collection.skin.equipped_toast', '{skin} equipped.', { skin: s.name }), 'ok'); }
    else state.toast(cv.t(`error.equip.${r.reason ?? 'not_owned'}`, 'You do not own {skin} yet.', { skin: s.name }), 'error');
  };
  const fighters = cv.fighters().filter((f) => !p.ownedOnly || cv.skinsOf(f.id).some((s) => s.tier !== 'base' && ownsSkin(profile.owned, s.id)));
  return (
    <div class="skinstab">
      <div class="row skinstab__bar">
        <span class="t-label">{cv.t('collection.filter.owned', 'Owned')}</span>
        <Toggle label={cv.t('collection.filter.owned', 'Owned')} checked={p.ownedOnly} onChange={(v) => router.setParams({ owned: v ? '1' : '' })} />
      </div>
      {fighters.length === 0 ? (
        <EmptyState text={cv.t('state.empty.owned', 'You do not own any extra skins yet.')} action={{ label: cv.t('btn.browse_shop', 'Browse the shop'), run: () => router.go('shop', {}, { root: true }) }} />
      ) : fighters.map((f) => (
        <Section title={f.name} hint={f.title} side={<Button variant="quiet" size="s" iconAfter="arrow" onPress={() => router.go('collection', { tab: 'fighters', fighter: f.id })}>{cv.t('btn.details', 'Details')}</Button>}>
          <SkinStrip fighter={f} value={profile.equipped[f.id] ?? cv.baseSkin(f.id)?.id} onPick={(s) => equip(f, s)} onShop={(sku) => router.go('shop', { sku })} />
        </Section>
      ))}
    </div>
  );
}

const SLOTS = ['passive', 'a1', 'a2', 'a3', 'ult'] as const;

function FighterDetail(p: { f: FighterDefT; preview?: string }): JSX.Element {
  const { cv, router, state, session, sound } = useApp();
  const f = p.f;
  const profile = state.profile.value;
  const equipped = profile.equipped[f.id] ?? cv.baseSkin(f.id)?.id;
  const shown = cv.skin(p.preview)?.fighter === f.id ? p.preview! : equipped;
  const skin = cv.skin(shown);
  const owned = !!skin && (skin.tier === 'base' || ownsSkin(profile.owned, skin.id));
  const offer = skin ? cv.offerForSkin(skin.id) : undefined;
  const role = cv.role(f.role), role2 = cv.role(f.secondaryRole), res = cv.resource(f.resource), cls = cv.cls(f.class);
  const origin = cv.originOf(f);
  const binds = state.settings.value.controls.binds;
  const equip = (): void => {
    if (!skin) return;
    const r = session.equipSkin(f.id, skin.id);
    if (r.ok) { sound.play('equip'); state.toast(cv.t('collection.skin.equipped_toast', '{skin} equipped.', { skin: skin.name }), 'ok'); }
    else state.toast(cv.t(`error.equip.${r.reason ?? 'not_owned'}`, 'You do not own {skin} yet.', { skin: skin.name }), 'error');
  };
  const cta = !owned && offer
    ? <Button variant="chalk" size="l" wedge onPress={() => router.go('shop', { sku: offer.sku })}>{cv.t('btn.open_shop', 'Open shop')}</Button>
    : <Button variant="chalk" size="l" wedge disabled={shown === equipped} reason={cv.t('collection.skin.equipped', 'Equipped')} cue={null} onPress={equip}>
      {shown === equipped ? cv.t('btn.equipped', 'Equipped') : cv.t('btn.equip', 'Equip')}
    </Button>;
  return (
    <Screen kicker={[cls?.name, role?.name].filter(Boolean).join(' · ')} title={f.name}
      headSide={<span class="t-body-s muted">{f.title}</span>}
      foot={<div class="row">
        <Button variant="secondary" size="s" onPress={() => router.go('play', { fighter: f.id })}>{cv.t('collection.play_as', 'Play as {fighter}', { fighter: f.name })}</Button>
        <Button variant="quiet" size="s" iconAfter="arrow" onPress={() => router.go('loadout', { fighter: f.id })}>{cv.t('loadout.title', 'Loadout')}</Button>
      </div>}
      cta={cta}
      stage={
        <div class="stagecard">
          <StageArt fighter={f} skin={shown} />
          <div class="stagecard__cap plate">
            <span class="t-label">{skin?.tier === 'base' ? cv.t('collection.skin.default', 'Base skin') : skin?.name}</span>
            <span class="t-caption muted">{owned ? (shown === equipped ? cv.t('collection.skin.equipped', 'Equipped') : cv.t('collection.skin.owned', 'Owned')) : offer ? cv.t('collection.skin.locked', 'In the shop for {price}', { price: `${offer.price.amount.toLocaleString('en-US')} ${cv.currency(offer.price.currency)?.name ?? ''}` }) : ''}</span>
          </div>
        </div>
      }>
      <div class="detail">
        <div class="detail__facts stg">
          <span class="fact"><span class="t-caption muted">{cv.t('collection.detail.class', 'Class')}</span><span class="t-body-s"><ClassMark classId={f.class} withName /></span></span>
          <span class="fact"><span class="t-caption muted">{cv.t('collection.detail.role', 'Role')}</span><span class="t-body-s">{role ? <><span class="roledot" style={{ background: role.color }} />{role.name}</> : null}{role2 ? <span class="muted"> · {role2.name}</span> : null}</span></span>
          <span class="fact"><span class="t-caption muted">{cv.t('collection.detail.difficulty', 'Difficulty')}</span><span class="t-body-s"><HourTicks n={f.difficulty} label={cv.t(`difficulty.${f.difficulty}`, '')} /> {cv.t(`difficulty.${f.difficulty}`, String(f.difficulty))}</span></span>
          {res ? <span class="fact"><span class="t-caption muted">{cv.t('collection.detail.resource', 'Resource')}</span><span class="t-body-s" title={res.desc}><span class="roledot" style={{ background: res.model === 'none' ? 'transparent' : res.color }} />{res.name}</span></span> : null}
          {origin ? <span class="fact"><span class="t-caption muted">{cv.t('collection.detail.origin', 'Origin')}</span><span class="t-body-s">{cv.t(`collection.origin.${origin}`, origin)}</span></span> : null}
        </div>
        <p class="t-body-l detail__job stg">{f.job}</p>
        <Section title={cv.t('collection.detail.abilities', 'Abilities')}>
          <ul class="kit">
            {SLOTS.map((slot) => {
              const ab = f.kit[slot];
              return <KitRow f={f} slot={slot} record={ab} keyLabel={slot === 'passive' ? undefined : keyShort(binds[slot])} resourceName={res?.name} />;
            })}
          </ul>
        </Section>
        <Section title={cv.t('collection.detail.skins', 'Skins')}>
          <SkinStrip fighter={f} value={shown} onPick={(s) => router.setParams({ skin: s.id })} onShop={(sku) => router.go('shop', { sku })} size="s" />
        </Section>
        <Section title={cv.t('collection.detail.lore', 'Lore')}>
          <p class="t-body detail__lore">{f.lore}</p>
        </Section>
      </div>
    </Screen>
  );
}

function KitRow(p: { f: FighterDefT; slot: string; record: FighterDefT['kit']['a1'] | FighterDefT['kit']['passive']; keyLabel?: string; resourceName?: string }): JSX.Element {
  const { cv, sound } = useApp();
  const r = p.record;
  const slotLabel = p.slot === 'passive' ? cv.t('collection.detail.passive', 'Passive') : cv.t(`settings.controls.action.${p.slot}`, p.slot);
  const tip = useTip(() => <AbilityTip record={r as Parameters<typeof AbilityTip>[0]['record']} slotLabel={slotLabel} keyLabel={p.keyLabel} resourceName={p.resourceName} cv={cv} />, { place: 'right', wide: true });
  return (
    <li class="kit__row" tabIndex={0} data-nav=""
      onPointerEnter={(e) => { tip.onPointerEnter(e); sound.play('hover'); }} onPointerLeave={tip.onPointerLeave} onFocus={tip.onFocus} onBlur={tip.onBlur}>
      <SetupIcon icon={r.icon} kind={p.slot === 'passive' ? 'passive' : 'ability'} keyLabel={p.keyLabel} name={r.name} palette={p.f.palette.primary} />
      <div class="kit__text">
        <div class="kit__head"><span class="t-h2">{r.name}</span><span class="t-caption muted">{slotLabel}</span></div>
        <p class="t-body-s kit__desc"><RichDesc record={r} desc={r.desc} /></p>
      </div>
    </li>
  );
}
