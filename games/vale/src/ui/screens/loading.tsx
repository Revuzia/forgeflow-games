// VALE UI — Loading (client_hud §3.7): the map name and the mode's flavour line, one tip at a time from
// client.tips (random start, then in order, every 8 s), a thin progress bar, and a player card per seat
// (portrait, name, role or FRAY seat glyph) with a tick once that seat is ready. Local bots are ready at
// once; you are ready when the session reports progress 1 and the renderer (if attached) has loaded the
// match. Then Session.matchReady() starts the clock. The shadow-line wipe starts and ends the screen.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SeatSetup } from '../../contracts/sim.ts';
import { useApp, useEsc } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { Portrait } from '../components/Portrait.tsx';
import { roman, SeatMark, seatOf, SideMark } from '../components/Seat.tsx';
import { ErrorState, Skeleton } from '../components/States.tsx';

/** long enough to read one tip, never a wait for its own sake */
const MIN_SHOW_MS = 2400;

export function LoadingScreen(): JSX.Element {
  const { cv, state, session, router } = useApp();
  const ld = state.loading.value;
  const setup = ld?.setup ?? state.lastSetup.value;
  const queue = cv.queue(setup?.queue);
  const mode = cv.mode(setup?.mode);
  const map = cv.map(setup?.map);
  const tips = cv.c.client.tips;
  const [tipI, setTipI] = useState(() => (tips.length ? Math.floor(Math.random() * tips.length) : 0));
  const [assets, setAssets] = useState(state.renderer?.preload ? 0 : 1);
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(performance.now());
  const readied = useRef(false);
  useEsc(() => true);   // the match flow owns the screen

  useEffect(() => {
    if (tips.length < 2) return;
    const t = setInterval(() => setTipI((i) => (i + 1) % tips.length), 8000);
    return () => clearInterval(t);
  }, []);
  // renderer preload (optional, RENDER lane): its progress joins the session's
  useEffect(() => {
    if (!setup || !state.renderer?.preload) return;
    let live = true;
    state.renderer.preload(setup, (p) => { if (live) setAssets(p); }).then(() => { if (live) setAssets(1); }, (e: unknown) => { if (live) setFailed(String(e)); });
    return () => { live = false; };
  }, [setup?.matchId]);
  const sessionP = ld?.progress ?? 0;
  const progress = Math.min(sessionP, 1) * 0.5 + Math.min(assets, 1) * 0.5;
  const ready = sessionP >= 1 && assets >= 1 && !failed;
  useEffect(() => {
    if (!ready || readied.current) return;
    const wait = Math.max(0, MIN_SHOW_MS - (performance.now() - started.current));
    const t = setTimeout(() => { readied.current = true; session.matchReady(); }, wait);
    return () => clearTimeout(t);
  }, [ready]);

  if (!setup) {
    return (
      <div class="loading">
        <div class="loading__head"><Skeleton w="40%" h="72px" /><Skeleton w="60%" h="20px" /></div>
      </div>
    );
  }
  const ffa = cv.isFfa(mode);
  const flavour = cv.t(queue?.kind === 'practice' ? 'loading.flavour.practice' : `loading.flavour.${setup.mode}`, mode?.tagline ?? '');
  const you = setup.seats.find((s) => s.controller === 'human');
  const teams = [...new Set(setup.seats.map((s) => s.team))];
  const myTeam = you?.team ?? 0;
  const ordered = ffa ? [setup.seats] : [setup.seats.filter((s) => s.team === myTeam), ...teams.filter((t) => t !== myTeam).map((t) => setup.seats.filter((s) => s.team === t))];
  return (
    <div class="loading" role="status" aria-busy={!ready}>
      <header class="loading__head stg">
        <span class="t-label muted">{mode?.name}{queue ? ` · ${queue.name}` : ''}</span>
        <h1 class="t-display-l">{map?.name ?? mode?.name}</h1>
        <p class="t-body-l loading__flavour">{flavour}</p>
      </header>
      <div class="loading__teams">
        {ordered.map((seats, ti) => (
          <section class={`lteam ${ffa ? 'lteam--ffa' : ti === 0 ? 'lteam--ally' : 'lteam--enemy'}`} aria-label={ffa ? cv.t('hourboard.title', 'Hour Board') : ti === 0 ? cv.t('team.yours', 'Your team') : cv.t('team.theirs', 'The other team')}>
            {!ffa ? <h2 class="lteam__head t-label"><SideMark team={seats[0]?.team ?? 0} withName />{ti === 0 ? cv.t('team.yours', 'Your team') : cv.t('team.theirs', 'The other team')}</h2> : null}
            <div class="lteam__cards">
              {seats.map((s, i) => <PlayerCard s={s} ffa={ffa} you={s === you} ready={s.controller === 'bot' || ready} rel={s === you ? 'self' : ffa ? 'enemy' : ti === 0 ? 'ally' : 'enemy'} i={i} />)}
            </div>
          </section>
        ))}
      </div>
      <footer class="loading__foot">
        {failed ? (
          <ErrorState text={cv.t('state.error.match', 'The match could not start. Try again.')} onRetry={() => { setFailed(null); setAssets(0); }} />
        ) : (
          <>
            <div class="loading__tip">
              {tips.length ? <span class="t-label muted">{cv.t('loading.tip_n', 'Tip {n} of {m}', { n: tipI + 1, m: tips.length })}</span> : null}
              <p class="t-body" key={tipI}>{tips[tipI] ?? ''}</p>
            </div>
            <div class="loading__progress">
              <span class="t-caption muted">{ready ? cv.t('loading.status_start', 'The match starts in a moment.') : cv.t('loading.status_assets', 'Loading the map and fighters')}</span>
              <div class="bar-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} aria-label={cv.t('a11y.progress', '{n} percent', { n: Math.round(progress * 100) })}>
                <span class="bar-line__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span class="num t-caption">{cv.t('loading.progress', '{n}%', { n: Math.round(progress * 100) })}</span>
            </div>
          </>
        )}
        {failed ? <Button variant="quiet" onPress={() => { session.cancelQueue(); router.reset('play', {}, 'back'); }}>{cv.t('btn.return_home', 'Return home')}</Button> : null}
      </footer>
    </div>
  );
}

function PlayerCard(p: { s: SeatSetup; ffa: boolean; you: boolean; ready: boolean; rel: 'self' | 'ally' | 'enemy'; i: number }): JSX.Element {
  const { cv } = useApp();
  const f = cv.fighter(p.s.fighter);
  const role = cv.role(p.s.role);
  const seat = seatOf(p.s.colorIndex);
  return (
    <article class={`pcard pcard--${p.rel} stg ${p.ready ? 'is-ready' : ''}`} aria-label={`${p.s.name}, ${f?.name ?? ''}${p.ready ? `. ${cv.t('loading.status_ready', 'Ready')}` : ''}`}>
      <Portrait fighter={f} skin={p.s.skin} size="fill" class="pcard__art" kind="splash" position="60% 25%" />
      <div class="pcard__meta">
        <span class="pcard__fighter t-label">{f?.name}</span>
        <span class="pcard__name t-body-s">{p.you ? cv.t('common.you', 'You') : p.s.name}{p.s.controller === 'bot' ? <span class="chip chip--bot">{cv.t('party.bot', 'Bot')}</span> : null}</span>
        <span class="pcard__role t-caption">
          {p.ffa ? <><SeatMark seat={seat} you={p.you} size={14} showNumeral={false} />{cv.t('fray.seat.label', 'Seat {roman} · {colour}', { roman: roman(seat), colour: cv.t(`fray.seat.${seat}`, '') })}</>
            : role ? <><span class="roledot" style={{ background: role.color }} />{role.name}</> : null}
        </span>
      </div>
      <span class="pcard__tick" aria-hidden="true">{p.ready ? <Icon name="check" /> : null}</span>
    </article>
  );
}
