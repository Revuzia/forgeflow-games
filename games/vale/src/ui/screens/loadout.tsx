// VALE UI — Loadout (client_hud §3.6, route `loadout`, param `fighter?`): the setup layer for one
// fighter outside a match — skin (equip via Session.equipSkin), Hour spells, boons by path — saved
// per fighter with Session.saveLoadout. "Use last loadout" restores Profile.loadouts[fighter]. Without
// a fighter param the screen asks for one first (the grid). Unsaved changes are kept until you leave.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { LoadoutChoice } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { ClassMark } from '../components/FighterCard.tsx';
import { FighterGrid } from '../components/FighterGrid.tsx';
import { LoadoutPanel } from '../components/LoadoutPanel.tsx';
import { Portrait, StageArt } from '../components/Portrait.tsx';
import { Screen } from '../components/Screen.tsx';

export function LoadoutScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, router, state, session } = useApp();
  const f = cv.fighter(p.params.fighter);
  if (!f) {
    return (
      <Screen title={cv.t('loadout.title', 'Loadout')} kicker={cv.t('play.preset.pick_fighter', 'Pick a fighter')}>
        <FighterGrid label={cv.t('play.preset.pick_fighter', 'Pick a fighter')} size="s" cols={5}
          card={(x) => ({ skin: state.profile.value.equipped[x.id], onPress: () => router.go('loadout', { fighter: x.id }) })} />
      </Screen>
    );
  }
  return <LoadoutFor fighter={f.id} key={f.id} />;
}

function LoadoutFor(p: { fighter: string }): JSX.Element {
  const { cv, router, state, session, sound } = useApp();
  const f = cv.fighter(p.fighter)!;
  const profile = state.profile.value;
  const saved = profile.loadouts[f.id];
  const defaults: LoadoutChoice = { spells: cv.c.setup.defaults.spells.slice(0, cv.spellSlots()), boons: cv.c.setup.defaults.boons.slice(0, cv.c.setup.boonSlots) };
  const [draft, setDraft] = useState<LoadoutChoice>(saved ?? defaults);
  const equipped = profile.equipped[f.id] ?? cv.baseSkin(f.id)?.id;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved ?? defaults);
  const full = draft.spells.length >= cv.spellSlots() && draft.boons.length >= cv.boonSlots();
  const save = (): void => {
    session.saveLoadout(f.id, draft);
    state.toast(cv.t('toast.loadout_saved', 'Loadout saved.'), 'ok');
  };
  const reason = !full ? cv.t('loadout.needs_full', 'Fill every slot to lock in.') : !dirty ? cv.t('settings.changes_saved', 'Changes are saved as you make them.') : null;
  return (
    <Screen kicker={cv.t('loadout.title', 'Loadout')} title={f.name}
      headSide={<Portrait fighter={f} skin={equipped} size="m" />}
      foot={<div class="row">
        <Button variant="quiet" size="s" disabled={!saved} reason={cv.t('profile.history.empty', 'No matches yet. Play one and it will be kept here.')} onPress={() => saved && setDraft(saved)}>{cv.t('btn.use_last', 'Use last loadout')}</Button>
        <Button variant="quiet" size="s" onPress={() => { setDraft(defaults); sound.play('toggle'); }}>{cv.t('loadout.reset_default', 'Use the default')}</Button>
      </div>}
      cta={<Button variant="chalk" size="l" wedge disabled={!!reason} reason={reason ?? undefined} onPress={save}>{cv.t('common.save', 'Save')}</Button>}
      stage={<div class="stagecard"><StageArt fighter={f} skin={equipped} />
        <div class="stagecard__cap plate"><span class="t-label muted"><ClassMark classId={f.class} withName /></span><span class="t-body-s">{f.job}</span></div></div>}>
      <LoadoutPanel fighter={f} skin={equipped} loadout={draft} pool={undefined} modeName=""
        onSkin={(s) => {
          const r = session.equipSkin(f.id, s.id);
          if (r.ok) { sound.play('equip'); state.toast(cv.t('toast.skin_equipped', '{skin} equipped.', { skin: s.name }), 'ok'); }
          else state.toast(cv.t(`error.equip.${r.reason ?? 'not_owned'}`, 'You do not own {skin} yet.', { skin: s.name }), 'error');
        }}
        onShop={(sku) => router.go('shop', { sku })}
        onLoadout={setDraft} />
    </Screen>
  );
}
