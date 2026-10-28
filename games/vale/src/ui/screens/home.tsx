// VALE UI — Home (client_hud §3.1): the headline over the live Rim, the progress band (client F7), the feature card
// (its CTA is the screen's chalk CTA), four tiles from catalog.client.home. A tile whose target queue is above your
// level is LOCKED (dashed border + the unlock path, never grey). A tile keeps the gloam "new" dot until you open it
// once.
//
// The progress band reads only data the client already has: your level ring with the XP to the next level and the
// next unlock a level brings (a queue's unlockLevel); the first-win candle, lit while today's bonus is still to be
// had (session/grants.ts firstWinAvailable, the rule the grant pays by) or snuffed with the time to the UTC reset;
// your last match with one-click Play again (the session's last request, else the last history entry's queue).
// The feature rotates per content version: the authored feature, then each other live mode's own card and words.

import type { JSX } from 'preact';
import type { ModeDefT, QueueDefT } from '../../contracts/catalog.ts';
import type { QueueRequest } from '../../contracts/session.ts';
import { firstWinAvailable, firstWinBonus, msToUtcReset, xpToNext } from '../../session/grants.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { NewDot } from '../components/Plate.tsx';
import { ArtFrame, Portrait } from '../components/Portrait.tsx';
import { Screen } from '../components/Screen.tsx';
import { fmtClock, fmtInt, fmtUntil, fmtWait } from '../format.ts';

interface Feature { art: string; title: string; body: string; mode: ModeDefT | undefined; card: boolean; cta: { label: string; screen: string; params: Record<string, string> } }

/** FNV-1a of the content version: the same feature for everyone on one version, a new one on the next */
function versionIndex(v: string, n: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return n > 0 ? h % n : 0;
}

export function HomeScreen(): JSX.Element {
  const { cv, router, state, sound } = useApp();
  const home = cv.c.client.home;
  const profile = state.profile.value;
  const seen = state.prefs.value.seenScreens;
  const authored = home.feature;
  const aMode = cv.mode(authored.cta.params.mode);
  const features: Feature[] = [
    { art: authored.art, title: authored.title, body: authored.body, mode: aMode, card: false, cta: authored.cta },
    ...cv.c.client.modeSlots.filter((s) => s.status === 'live' && s.mode && s.mode !== aMode?.id).map((s) => cv.mode(s.mode)).filter((m): m is ModeDefT => !!m)
      .map((m) => ({ art: m.card.art, title: m.tagline, body: m.desc, mode: m, card: true,
        cta: { label: cv.t('home.feature.play', 'Play {mode}', { mode: m.name }), screen: 'play', params: { mode: m.id } } })),
  ];
  const feature = features[versionIndex(cv.version, features.length)] ?? features[0];
  const fMode = feature.mode;
  const open = (screen: string, params: Record<string, string>, tileId?: string): void => {
    if (tileId && !seen.includes(`tile:${tileId}`)) state.setPrefs({ seenScreens: [...seen, `tile:${tileId}`] });
    router.go(screen, params);
  };
  return (
    <Screen
      label={home.headline}
      cta={<Button variant="chalk" size="l" wedge data-autofocus="" onPress={() => open(feature.cta.screen, feature.cta.params)}>{feature.cta.label}</Button>}
      foot={<span class="t-body-s muted">{cv.t('app.local_note', 'Your profile is saved in this browser only.')}</span>}>
      <div class="home">
        <div class="home__hero stg">
          <h1 class="t-display-l home__headline">{home.headline}</h1>
          <p class="t-body-l home__sub">{home.sub}</p>
        </div>
        <ProgressBand />
        <article class="home__feature plate stg" data-feature={versionIndex(cv.version, features.length)}>
          <ArtFrame src={feature.art} mark={fMode ? cv.modeMark(fMode) : null} lanes={cv.laneCount(fMode)} class={`home__featureart ${feature.card ? 'home__featureart--card' : ''}`} />
          <div class="home__featuretext">
            {fMode ? <span class="t-label home__featuremode">{fMode.name}</span> : null}
            <h2 class="t-h1">{feature.title}</h2>
            <p class="t-body muted">{feature.body}</p>
          </div>
        </article>
        <div class="home__tiles" data-arrownav="grid">
          {home.tiles.map((tile) => {
            const q = cv.queue(tile.params.queue);
            const lockLevel = q && q.unlockLevel > profile.level ? q.unlockLevel : 0;
            const lockText = lockLevel ? cv.t('state.locked.queue', 'Reach level {level} to play {queue}.', { level: lockLevel, queue: q!.name }) : null;
            const tMode = cv.mode(tile.params.mode ?? q?.mode);
            const isNew = !seen.includes(`tile:${tile.id}`);
            return (
              <button type="button" class={`tile plate stg ${lockText ? 'is-locked' : ''}`} data-nav=""
                aria-label={`${tile.title}. ${tile.body}${lockText ? ` ${lockText}` : ''}`}
                onPointerEnter={() => sound.play('hover')} onPointerDown={() => sound.play(lockText ? 'error' : 'click')}
                onClick={() => open(tile.screen, tile.params, tile.id)}>
                <ArtFrame src={tile.art} mark={tMode ? cv.modeMark(tMode) : null} lanes={cv.laneCount(tMode)} class="tile__art" />
                <span class="tile__text">
                  <span class="tile__title t-label">{tile.title}{isNew ? <NewDot label={cv.t('common.new', 'New')} /> : null}</span>
                  <span class="tile__body t-body-s">{tile.body}</span>
                  {lockText ? <span class="tile__lock t-caption"><Icon name="lock" size={14} />{lockText}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </Screen>
  );
}

// ── the progress band (client F7) ────────────────────────────────────────────────────────────────
function ProgressBand(): JSX.Element {
  const { cv } = useApp();
  return (
    <section class="hband plate stg" aria-label={cv.t('home.band.label', 'Your progress')}>
      <LevelCell />
      <FirstWinCell />
      <LastMatchCell />
    </section>
  );
}

/** the queue a Play again (or the first-win line) is about: your last match's, else the feature mode's first open
 *  matchmade queue */
function againQueue(cv: ReturnType<typeof useApp>['cv'], lastQueue: string | undefined, level: number): QueueDefT | undefined {
  const last = cv.queue(lastQueue);
  if (last) return last;
  const mode = cv.c.client.home.feature.cta.params.mode;
  const qs = (mode ? cv.queuesOf(mode) : []).filter((q) => q.kind !== 'practice' && q.kind !== 'custom');
  return qs.find((q) => q.kind === 'coop' && q.unlockLevel <= level) ?? qs.find((q) => q.unlockLevel <= level) ?? qs[0];
}

function LevelCell(): JSX.Element {
  const { cv } = useApp();
  const { state } = useApp();
  const p = state.profile.value;
  const need = xpToNext(p.level);
  const frac = Math.max(0, Math.min(1, p.xp / need));
  // the next thing a level brings: the lowest queue unlock above your level
  const next = cv.c.queues.filter((q) => q.unlockLevel > p.level).sort((a, b) => a.unlockLevel - b.unlockLevel)[0];
  const R = 20, C = 2 * Math.PI * R;
  return (
    <div class="hband__cell hband__level">
      <span class="lvring" role="img" aria-label={cv.t('home.level.ring', 'Level {level}, {xp} of {next} XP', { level: p.level, xp: fmtInt(p.xp), next: fmtInt(need) })}>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r={R} class="lvring__track" />
          {frac > 0 ? <circle cx="24" cy="24" r={R} class="lvring__fill" style={{ strokeDasharray: `${C * frac} ${C}` }} transform="rotate(-90 24 24)" /> : null}
        </svg>
        <span class="lvring__n num">{p.level}</span>
      </span>
      <span class="hband__text">
        <span class="t-label hband__k">{cv.t('home.level.title', 'Level {level}', { level: p.level })}</span>
        <span class="t-body-s hband__v"><span class="num">{fmtInt(need - p.xp)}</span> {cv.t('home.level.to_next', 'XP to level {level}', { level: p.level + 1 })}</span>
        <span class="t-caption muted hband__s">{next ? cv.t('home.level.unlock', 'Level {level} opens {queue}', { level: next.unlockLevel, queue: next.name }) : cv.t('home.level.no_unlock', 'Every match adds XP.')}</span>
      </span>
    </div>
  );
}

function FirstWinCell(): JSX.Element {
  const { cv, state } = useApp();
  void state.now.value;                       // re-render on the UI clock: the reset countdown moves
  const p = state.profile.value;
  const wall = Date.now();
  const lit = firstWinAvailable(p, wall);
  const q = againQueue(cv, p.history[0]?.queue, p.level);
  const bonus = q ? firstWinBonus(q) : { currency: 0, xp: 0 };
  const cur = cv.earnedCurrency();
  const reward = [bonus.currency && cur ? `+${fmtInt(bonus.currency)} ${cur.name}` : '', bonus.xp ? `+${fmtInt(bonus.xp)} XP` : ''].filter(Boolean).join(', ');
  return (
    <div class={`hband__cell hband__win ${lit ? 'is-lit' : 'is-spent'}`}>
      <svg class="fwcandle" viewBox="0 0 32 40" aria-hidden="true">
        <rect x="11" y="18" width="10" height="18" rx="1.5" class="fwcandle__body" />
        <path d="M16 18v-3" class="fwcandle__wick" />
        {lit
          ? <path d="M16 4c3.2 3.6 4.6 6.2 4.6 8.2a4.6 4.6 0 0 1-9.2 0c0-2 1.4-4.6 4.6-8.2z" class="fwcandle__flame" />
          : <path d="M16 14c-2-2 2-3.5 0-5.5s2-3.5 0-5" class="fwcandle__smoke" />}
        <path d="M7 37h18" class="fwcandle__foot" />
      </svg>
      <span class="hband__text">
        <span class="t-label hband__k">{cv.t('grant.first_win', 'First win of the day')}</span>
        {lit
          ? <span class="t-body-s hband__v">{reward ? cv.t('home.firstwin.ready', 'Ready: {reward}', { reward }) : cv.t('home.firstwin.ready_plain', 'Ready today')}</span>
          : <span class="t-body-s hband__v">{cv.t('home.firstwin.spent', 'Taken today')}</span>}
        <span class="t-caption muted hband__s">{lit ? cv.t('home.firstwin.ready_sub', 'Win any matchmade game today.') : cv.t('home.firstwin.back_in', 'Back in {t}', { t: fmtUntil(msToUtcReset(wall) / 1000) })}</span>
      </span>
    </div>
  );
}

function LastMatchCell(): JSX.Element {
  const { cv, router, state } = useApp();
  const p = state.profile.value;
  const prefs = state.prefs.value;
  const last = p.history[0];
  if (!last) {
    return (
      <div class="hband__cell hband__last is-empty">
        <span class="hband__text">
          <span class="t-label hband__k">{cv.t('home.last.title', 'Last match')}</span>
          <span class="t-body-s hband__v">{cv.t('home.last.none', 'No matches yet.')}</span>
        </span>
        <Button size="s" class="hband__go" onPress={() => router.go('play', {})}>{cv.t('home.last.first', 'Find a match')}</Button>
      </div>
    );
  }
  const mode = cv.mode(last.mode);
  const q = cv.queue(last.queue);
  const f = cv.fighter(last.fighter);
  const ffa = cv.isFfa(mode);
  const res = ffa ? cv.t('profile.history.placed', '{ord} of {total}', { ord: cv.ordinal(last.placement), total: cv.seatsOf(mode) })
    : last.won ? cv.t('profile.history.won', 'Victory') : cv.t('profile.history.lost', 'Defeat');
  // the request a Play again sends: this session's last one, else rebuilt from the last match
  const req = ((): QueueRequest | null => {
    if (state.lastRequest.value) return state.lastRequest.value;
    if (!q) return null;
    const pick = cv.pickOf(q);
    const r: QueueRequest = { queue: q.id };
    const [r1, r2] = prefs.roles ?? [];
    if (mode?.roles && pick !== 'role_preset' && r1) r.roles = r2 && r2 !== r1 ? [r1, r2] : [r1];
    if (pick === 'role_preset' && f) r.preset = { fighter: f.id, ...(f.role ? { role: f.role } : {}), ...(p.equipped[f.id] ? { skin: p.equipped[f.id] } : {}) };
    return r;
  })();
  const rq = cv.queue(req?.queue);
  const lock = state.lockoutLeft.value;
  const reason = !rq ? cv.t('play.choose_queue', 'Choose how to play')
    : rq.unlockLevel > p.level ? cv.t('state.locked.queue', 'Reach level {level} to play {queue}.', { level: rq.unlockLevel, queue: rq.name })
      : lock > 0 ? cv.t('queue.lockout_banner', 'You can queue again in {t}.', { t: fmtWait(lock) })
        : state.party.value.length > rq.partyMax ? cv.t('play.party_size', 'Party of up to {n}', { n: rq.partyMax }) : null;
  const again = (): void => {
    if (!req || !rq || reason) return;
    // custom lobbies and practice are set up on their own screens; matchmade queues go straight to the search
    if (rq.kind === 'custom' || rq.kind === 'practice') { router.go('play', { mode: rq.mode, queue: rq.id }); return; }
    state.queueFor(req);
  };
  return (
    <div class={`hband__cell hband__last ${ffa ? 'is-place' : last.won ? 'is-win' : 'is-loss'}`}>
      <Portrait fighter={f} skin={last.skin} size="xs" class="hband__face" />
      <span class="hband__text" title={q ? `${mode?.name ?? ''} · ${q.name}` : undefined}>
        <span class="t-label hband__k">{cv.t('home.last.title', 'Last match')}</span>
        <span class="t-body-s hband__v"><span class="hband__res">{res}</span> · {f?.name ?? last.fighter}</span>
        <span class="t-caption muted hband__s">{mode?.name} · <span class="num">{last.kills}/{last.deaths}/{last.assists}</span> · <span class="num">{fmtClock(last.duration)}</span></span>
      </span>
      <Button size="s" class="hband__go" disabled={!!reason} reason={reason ?? undefined} cue="confirm" onPress={again}>{cv.t('btn.play_again', 'Play again')}</Button>
    </div>
  );
}
