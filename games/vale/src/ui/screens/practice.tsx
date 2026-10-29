// VALE UI — Practice setup (client_hud §3.12): the map (W4 g3: any two-team mode whose end is the core, each on its own
// map; QueueRequest.practice.mode), the switches (infinite Gleam, no cooldowns, Wicks and structures at the start,
// training targets 0–20, starting level up to the mode's max), an optional sparring fighter on the other team played by
// a bot of the chosen difficulty (practice.sparring), and an optional fighter chosen now (QueueRequest.preset; without
// one the session runs a solo pick). Practice earns nothing and says so. The queue is the catalog's practice-kind queue.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { FighterGrid } from '../components/FighterGrid.tsx';
import { Screen, Section } from '../components/Screen.tsx';
import { Slider } from '../components/Slider.tsx';
import { EmptyState } from '../components/States.tsx';
import { Toggle } from '../components/Toggle.tsx';
import { Segmented, Select, type Option } from '../components/Select.tsx';
import { Portrait, StageArt } from '../components/Portrait.tsx';
import { ClassMark } from '../components/FighterCard.tsx';

export function PracticeScreen(): JSX.Element {
  const { cv, router, state } = useApp();
  const q = cv.queuesOfKind('practice')[0];
  const home = cv.mode(q?.mode);
  // the maps you may practise on: the queue's own mode first, then every other two-team mode that ends at the core
  const modes = [home, ...cv.c.modes.filter((m) => m.id !== home?.id && m.teams === 2 && m.rules.end.kind === 'core')].filter((m) => !!m);
  const [modeId, setModeId] = useState(home?.id ?? '');
  const mode = cv.mode(modeId) ?? home;
  const rules = q ? (mode && mode.id !== home?.id ? mode.rules : cv.rulesOf(q)) : undefined;
  const [gold, setGold] = useState(true);
  const [noCd, setNoCd] = useState(false);
  const [waves, setWaves] = useState(true);
  const [structures, setStructures] = useState(true);
  const [dummies, setDummies] = useState(3);
  const [level, setLevel] = useState(rules?.startLevel ?? 1);
  const [fighter, setFighter] = useState<string | undefined>(undefined);
  const [spar, setSpar] = useState<string>('');
  const [sparDiff, setSparDiff] = useState<'novice' | 'adept' | 'veteran'>('adept');
  if (!q || !rules) return <Screen title={cv.t('practice.title', 'Practice')}><EmptyState text={cv.t('state.error.generic', 'Something went wrong. Try again.')} action={{ label: cv.t('common.back', 'Back'), run: () => router.back() }} /></Screen>;
  const f = cv.fighter(fighter);
  const sparOpts: Option<string>[] = [{ value: '', label: cv.t('practice.sparring_none', 'None') },
    ...[...cv.playable()].sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ value: x.id, label: x.name }))];
  const diffOpts: Option<'novice' | 'adept' | 'veteran'>[] = (['novice', 'adept', 'veteran'] as const).map((d) => ({ value: d, label: cv.t(`custom.difficulty_${d}`, d) }));
  const start = (): void => {
    state.queueFor({
      queue: q.id,
      practice: {
        infiniteGold: gold, noCooldowns: noCd, dummies, startLevel: Math.min(level, rules.maxLevel), waves, structures,
        ...(mode && mode.id !== home?.id ? { mode: mode.id } : {}),
        ...(spar ? { sparring: { fighter: spar, difficulty: sparDiff } } : {}),
      },
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
        {modes.length > 1 ? (
          <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.mode', 'Map')}</span><span class="t-caption muted">{cv.t('practice.mode_desc', 'Practice on any map that ends at a core.')}</span></div>
            <div class="srow2__ctl"><Segmented label={cv.t('practice.mode', 'Map')} value={mode?.id ?? ''} options={modes.map((m) => ({ value: m.id, label: m.name }))} onChange={setModeId} /></div></div>
        ) : null}
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.infinite_gold', 'Infinite Gleam')}</span><span class="t-caption muted">{cv.t('practice.infinite_gold_desc', '')}</span></div>
          <div class="srow2__ctl"><Toggle label={cv.t('practice.infinite_gold', 'Infinite Gleam')} checked={gold} onChange={setGold} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.no_cooldowns', 'No cooldowns')}</span><span class="t-caption muted">{cv.t('practice.no_cooldowns_desc', '')}</span></div>
          <div class="srow2__ctl"><Toggle label={cv.t('practice.no_cooldowns', 'No cooldowns')} checked={noCd} onChange={setNoCd} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.waves', 'Wicks')}</span><span class="t-caption muted">{cv.t('practice.waves_desc', '')}</span></div>
          <div class="srow2__ctl"><Toggle label={cv.t('practice.waves', 'Wicks')} checked={waves} onChange={setWaves} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.structures', 'Structures')}</span><span class="t-caption muted">{cv.t('practice.structures_desc', '')}</span></div>
          <div class="srow2__ctl"><Toggle label={cv.t('practice.structures', 'Structures')} checked={structures} onChange={setStructures} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.dummies', 'Training targets')}</span><span class="t-caption muted">{cv.t('practice.dummies_desc', '')}</span></div>
          <div class="srow2__ctl"><Slider label={cv.t('practice.dummies', 'Training targets')} value={dummies} min={0} max={20} step={1} onChange={setDummies} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.start_level', 'Starting level')}</span></div>
          <div class="srow2__ctl"><Slider label={cv.t('practice.start_level', 'Starting level')} value={Math.min(level, rules.maxLevel)} min={1} max={rules.maxLevel} step={1} onChange={setLevel} /></div></div>
        <div class="srow2 stg"><div class="srow2__text"><span class="t-body">{cv.t('practice.sparring', 'Sparring partner')}</span><span class="t-caption muted">{cv.t('practice.sparring_desc', '')}</span></div>
          <div class="srow2__ctl srow2__ctl--pair">
            <Select label={cv.t('practice.sparring', 'Sparring partner')} value={spar} options={sparOpts} onChange={setSpar} />
            {spar ? <Select label={cv.t('custom.difficulty', 'Bot difficulty')} value={sparDiff} options={diffOpts} onChange={setSparDiff} /> : null}
          </div></div>
      </div>
      <Section title={cv.t('play.preset.fighter', 'Fighter')} hint={f ? f.name : cv.t('practice.fighter_hint', 'Optional. Leave it empty and you pick on the next screen.')}>
        <FighterGrid label={cv.t('play.preset.pick_fighter', 'Pick a fighter')} size="s" cols={6} compactFilters
          card={(x) => ({ selected: x.id === fighter, skin: state.profile.value.equipped[x.id], onPress: () => setFighter(x.id === fighter ? undefined : x.id) })} />
      </Section>
    </Screen>
  );
}
