// VALE UI — Practice setup (client_hud §3.12): the four switches (infinite Gleam, no cooldowns,
// training targets 0–20, starting level up to the mode's max) and an optional fighter chosen now
// (QueueRequest.preset; without one the session runs a solo pick). Practice earns nothing and says so.
// The queue is the catalog's practice-kind queue; its mode and map come from the record.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { FighterGrid } from '../components/FighterGrid.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { Slider } from '../components/Slider.tsx';
import { EmptyState } from '../components/States.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { Portrait, StageArt } from '../components/Portrait.tsx';
import { ClassMark } from '../components/FighterCard.tsx';

export function PracticeScreen(): JSX.Element {
  const { cv, router, state } = useApp();
  const q = cv.queuesOfKind('practice')[0];
  const mode = cv.mode(q?.mode);
  const rules = q ? cv.rulesOf(q) : undefined;
  const [gold, setGold] = useState(true);
  const [noCd, setNoCd] = useState(false);
  const [dummies, setDummies] = useState(3);
  const [level, setLevel] = useState(rules?.startLevel ?? 1);
  const [fighter, setFighter] = useState<string | undefined>(undefined);
  if (!q || !rules) return <Screen title={cv.t('practice.title', 'Practice')}><EmptyState text={cv.t('state.error.generic', 'Something went wrong. Try again.')} action={{ label: cv.t('common.back', 'Back'), run: () => router.back() }} /></Screen>;
  const f = cv.fighter(fighter);
  const start = (): void => {
    state.queueFor({
      queue: q.id,
      practice: { infiniteGold: gold, noCooldowns: noCd, dummies, startLevel: level },
      ...(f ? { preset: { fighter: f.id, ...(state.profile.value.equipped[f.id] ? { skin: state.profile.value.equipped[f.id] } : {}) } } : {}),
    });
  };
  return (
    <Screen kicker={`${mode?.name ?? ''} · ${cv.map(mode?.map)?.name ?? ''}`} title={cv.t('practice.title', 'Practice')}
      foot={<span class="t-body-s muted">{cv.t('practice.no_rewards', 'No rewards are given in practice.')}</span>}
      cta={<Button variant="chalk" size="l" wedge onPress={start} data-autofocus="">{cv.t('btn.start_practice', 'Start practice')}</Button>}
      stage={f ? <div class="stagecard"><StageArt fighter={f} skin={state.profile.value.equipped[f.id]} />
        <div class="stagecard__cap plate"><span class="t-h1">{f.name}</span><span class="t-caption muted"><ClassMark classId={f.class} withName /></span></div></div> : undefined}>
      <p class="t-body-l muted stg">{cv.t('practice.hint', 'Try any fighter alone on the full map.')}</p>
      <div class="srows">
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.infinite_gold', 'Infinite Gleam')}</span><span class="t-caption muted">{cv.t('practice.infinite_gold_desc', '')}</span></div>
          <div class="srow2__ctl"><Toggle label={cv.t('practice.infinite_gold', 'Infinite Gleam')} checked={gold} onChange={setGold} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.no_cooldowns', 'No cooldowns')}</span><span class="t-caption muted">{cv.t('practice.no_cooldowns_desc', '')}</span></div>
          <div class="srow2__ctl"><Toggle label={cv.t('practice.no_cooldowns', 'No cooldowns')} checked={noCd} onChange={setNoCd} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.dummies', 'Training targets')}</span><span class="t-caption muted">{cv.t('practice.dummies_desc', '')}</span></div>
          <div class="srow2__ctl"><Slider label={cv.t('practice.dummies', 'Training targets')} value={dummies} min={0} max={20} step={1} onChange={setDummies} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.start_level', 'Starting level')}</span></div>
          <div class="srow2__ctl"><Slider label={cv.t('practice.start_level', 'Starting level')} value={level} min={1} max={rules.maxLevel} step={1} onChange={setLevel} /></div></div>
      </div>
      <Section title={cv.t('play.preset.fighter', 'Fighter')} hint={f ? f.name : cv.t('practice.fighter_hint', 'Optional. Leave it empty and you pick on the next screen.')}>
        <FighterGrid label={cv.t('play.preset.pick_fighter', 'Pick a fighter')} size="s" cols={6} compactFilters
          card={(x) => ({ selected: x.id === fighter, skin: state.profile.value.equipped[x.id], onPress: () => setFighter(x.id === fighter ? undefined : x.id) })} />
      </Section>
    </Screen>
  );
}
