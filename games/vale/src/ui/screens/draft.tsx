// VALE UI — Draft (client_hud §3.4, §3.5, §10). One screen, four layouts chosen from the DraftState
// and the queue's pick protocol (never from ids):
//   team draft  bans along the top (yours visible to you, theirs hidden until the reveal), your seats
//               left, theirs right, the fighter grid with class / role filters + search in the middle,
//               the phase title and the timer ring top-centre; Ban / Lock in. Blind (Co-op) uses it too.
//   the Lot     BRIDGE random_bench: your draw (splash, class, job), the team's Lot with Swap, the
//               team's seats, Draw again with the draws left; a lot-drawing motion, never a "shuffle".
//   fray pick   simultaneous pick, nine seat chips along the top (colour + glyph), yours in Noonwhite
//               with your seat colour; first lock keeps a fighter.
//   finalize    skin + spells + boons (LoadoutPanel) and trades with locked teammates.
// Timers are rings (linear sweep, HARM in the last 5 s). Esc / Back opens the dodge confirm.
// The showcase (client F5): under the team draft's grid your hovered or locked fighter stands large — the painted plate,
// name, title, class, role and kit — crossfading as you hover. Locking in strikes noon (VALE's own beat: the gnomon on
// the plate's dial swings clockwise to 12, the ring closes, the plate comes up to full light) and the fighter's call
// plays (UiSound.lockCall: `f_<fighter>_call`, the lockin role when a fighter has none). A timeout lock gets the beat too.
// Fit (client F9): the draft grid's cards are compact (class and role as marks on the portrait), finalize puts battle
// spells and boons behind tabs, and the seat's Bot chip rides the role line.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { FighterDefT } from '../catalog_view.ts';
import type { DraftSeat, DraftState } from '../../contracts/session.ts';
import { useApp, useEsc } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { ClassMark, RoleIcon } from '../components/FighterCard.tsx';
import { FighterGrid, NO_FILTER, type GridFilter } from '../components/FighterGrid.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { LoadoutPanel } from '../components/LoadoutPanel.tsx';
import { confirmDialog } from '../components/Modal.tsx';
import { Portrait, SetupIcon } from '../components/Portrait.tsx';
import { AbilityTip, useTip } from '../components/Tooltip.tsx';
import { keyShort } from '../keys.ts';
import { reducedMotion } from '../motion.ts';
import { Ring } from '../components/Ring.tsx';
import { Screen } from '../components/Screen.tsx';
import { roman, SeatMark, seatOf, SideMark } from '../components/Seat.tsx';
import { EmptyState, Skeleton } from '../components/States.tsx';
import { fmtWait } from '../format.ts';
import { animateIn } from '../motion.ts';

type View = 'team' | 'lot' | 'ffa' | 'finalize';

function viewOf(d: DraftState, ffa: boolean): View {
  if (d.phase === 'finalize' || d.phase === 'trade' || d.phase === 'done') return 'finalize';
  if (d.phase === 'bench') return 'lot';
  return ffa ? 'ffa' : 'team';
}

export function DraftScreen(): JSX.Element {
  const { cv, state, session, overlay, router } = useApp();
  // when the draft ends the state clears before this screen has finished leaving: keep drawing the last
  // board through the exit (it never flashes into the loading skeleton)
  const last = useRef(state.draft.value);
  if (state.draft.value) last.current = state.draft.value;
  const d = state.draft.value ?? last.current;
  const queue = cv.queue(d?.queue);
  const mode = cv.mode(d?.mode);
  const free = queue?.kind === 'practice' || queue?.kind === 'custom';

  const leave = (): void => {
    if (free) { session.cancelQueue(); return; }
    const next = Math.min(60, state.lastLockoutS ? state.lastLockoutS * 2 : 5);
    void confirmDialog(overlay, {
      title: cv.t('draft.leave.title', 'Leave the draft?'),
      body: cv.t('draft.leave.body', 'Leaving a draft locks you out of the queue for {t}, and the others will be left a seat short.', { t: fmtWait(next) }),
      confirm: cv.t('draft.leave.confirm', 'Leave draft'), cancel: cv.t('draft.leave.stay', 'Stay in the draft'), tone: 'danger',
    }).then((yes) => { if (yes) session.cancelQueue(); });
  };
  useEsc(() => { leave(); return true; });

  if (!d || !queue) {
    return (
      <Screen layout="wide" title={cv.t('draft.title', 'Draft')} foot={<span class="t-body-s muted">{cv.t('state.loading', 'Loading…')}</span>}>
        <div class="draft__skel" role="status" aria-busy="true">
          {Array.from({ length: 12 }, () => <Skeleton h="160px" />)}
        </div>
        {!d && state.loading.value === null ? <p class="t-body muted"><Button variant="quiet" onPress={() => router.reset('play', {}, 'back')}>{cv.t('common.back', 'Back')}</Button></p> : null}
      </Screen>
    );
  }
  const ffa = cv.isFfa(mode);
  const view = viewOf(d, ffa);
  return (
    <>
      {view === 'team' ? <TeamDraft d={d} onLeave={leave} /> : null}
      {view === 'lot' ? <LotView d={d} onLeave={leave} /> : null}
      {view === 'ffa' ? <FrayPick d={d} onLeave={leave} /> : null}
      {view === 'finalize' ? <Finalize d={d} ffa={ffa} onLeave={leave} /> : null}
    </>
  );
}

// ── shared pieces ──────────────────────────────────────────────────────────────────────────────
function PhaseHead(p: { d: DraftState; title: string; prompt?: string; sub?: string }): JSX.Element {
  return (
    <div class="phase">
      <Ring size={88} stroke={4} timer={{ left: p.d.timer, max: p.d.timerMax }} showSeconds tone="chalk" label={`${Math.ceil(p.d.timer)} s`} />
      <div class="phase__text">
        <h1 class="t-display-m phase__title" aria-live="polite">{p.title}</h1>
        {p.prompt ? <p class="t-body phase__prompt">{p.prompt}</p> : null}
        {p.sub ? <p class="t-body-s muted">{p.sub}</p> : null}
      </div>
    </div>
  );
}

function Ticker(p: { d: DraftState }): JSX.Element {
  const line = p.d.log[p.d.log.length - 1];
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => { animateIn(el.current, { from: 'right', d: 'fast' }); }, [p.d.log.length]);
  return <p class="ticker t-body-s" role="log" aria-live="polite"><Icon name="info" size={14} /><span ref={el}>{line ?? ''}</span></p>;
}

function SeatCard(p: { s: DraftSeat; d: DraftState; rel: 'self' | 'ally' | 'enemy'; hidden?: boolean; actions?: JSX.Element | null }): JSX.Element {
  const { cv } = useApp();
  const s = p.s;
  const fid = s.locked ?? s.hover;
  const f = p.hidden ? undefined : cv.fighter(fid);
  const role = cv.role(s.role);
  const active = !!p.d.turn?.players.includes(s.player) && !s.locked;
  const status = s.locked ? (p.hidden ? cv.t('draft.seat.locked', 'Locked in') : f?.name ?? '') : s.hover && !p.hidden ? cv.t('draft.seat.hovering', 'Hovering {fighter}', { fighter: cv.fighter(s.hover)?.name ?? '' })
    : active ? cv.t('draft.seat.thinking', 'Choosing…') : '';
  return (
    <div class={`seat seat--${p.rel} ${active ? 'is-active' : ''} ${s.locked ? 'is-locked-in' : ''}`}>
      <span class="seat__portrait">
        {f ? <Portrait fighter={f} skin={s.skin} size="fill" class={s.locked ? '' : 'is-hover'} /> : <span class="seat__empty">{p.hidden && s.locked ? '?' : ''}</span>}
      </span>
      <span class="seat__text">
        <span class="seat__name t-body-s" title={s.isYou ? undefined : s.name}>{s.isYou ? cv.t('draft.you', 'You') : s.name}</span>
        {role || s.isBot ? <span class="seat__role t-caption">{role ? <><span class="roledot" style={{ background: role.color }} /><span class="seat__rolename">{role.name}</span></> : null}{s.isBot ? <span class="chip chip--bot chip--glyph" role="img" title={cv.t('draft.seat.bot', 'Bot')} aria-label={cv.t('draft.seat.bot', 'Bot')}><Icon name="bot" size={12} /></span> : null}</span> : null}
        <span class={`seat__status t-caption ${s.locked ? 'is-locked' : ''}`}>{s.locked && !p.hidden ? <Icon name="check" size={12} /> : null}{status}</span>
      </span>
      {p.actions}
    </div>
  );
}

function TeamColumn(p: { d: DraftState; team: number; rel: 'ally' | 'enemy'; hideLocks?: boolean; actions?: (s: DraftSeat) => JSX.Element | null }): JSX.Element {
  const { cv } = useApp();
  const seats = p.d.seats.filter((s) => s.team === p.team);
  return (
    <aside class={`dteam dteam--${p.rel}`} aria-label={p.rel === 'ally' ? cv.t('draft.your_team', 'Your team') : cv.t('draft.enemy_team', 'The other team')}>
      <h2 class="dteam__head t-label"><SideMark team={p.team} />{p.rel === 'ally' ? cv.t('draft.your_team', 'Your team') : cv.t('draft.enemy_team', 'The other team')}</h2>
      {seats.map((s) => <SeatCard s={s} d={p.d} rel={s.isYou ? 'self' : p.rel} hidden={p.hideLocks && !s.isYou} actions={p.actions?.(s) ?? null} />)}
    </aside>
  );
}

/** the lock-in beat: when the session confirms your lock (a press or the timer's own lock), the fighter's call plays
 *  and the showcase strikes noon for BEAT_MS. Returns whether the beat is running. */
const BEAT_MS = 1200;
function useLockBeat(locked: string | undefined): boolean {
  const { sound } = useApp();
  const prev = useRef(locked);
  const [beat, setBeat] = useState(false);
  useEffect(() => {
    const was = prev.current;
    prev.current = locked;
    if (!locked || was === locked) return;
    sound.lockCall(locked);
    setBeat(true);
    const t = setTimeout(() => setBeat(false), reducedMotion.peek() ? 200 : BEAT_MS);
    return () => clearTimeout(t);
  }, [locked]);
  return beat;
}

const KIT = ['passive', 'a1', 'a2', 'a3', 'ult'] as const;

function KitIcon(p: { f: FighterDefT; slot: typeof KIT[number] }): JSX.Element {
  const { cv, state } = useApp();
  const r = p.f.kit[p.slot];
  const binds = state.settings.value.controls.binds;
  const keyLabel = p.slot === 'passive' ? undefined : keyShort(binds[p.slot]);
  const slotLabel = p.slot === 'passive' ? cv.t('collection.detail.passive', 'Passive') : cv.t(`settings.controls.action.${p.slot}`, p.slot);
  const tip = useTip(() => <AbilityTip record={r as Parameters<typeof AbilityTip>[0]['record']} slotLabel={slotLabel} keyLabel={keyLabel} resourceName={cv.resource(p.f.resource)?.name} cv={cv} />, { place: 'above', wide: true });
  return (
    <span class="dshow__ab" tabIndex={0} aria-label={`${slotLabel}: ${r.name}`} onPointerEnter={tip.onPointerEnter} onPointerLeave={tip.onPointerLeave} onFocus={tip.onFocus} onBlur={tip.onBlur}>
      <SetupIcon icon={r.icon} kind={p.slot === 'passive' ? 'passive' : 'ability'} keyLabel={keyLabel} name={r.name} palette={p.f.palette.primary} size="s" />
    </span>
  );
}

/** your hovered or locked fighter, large (client F5): the painted plate on the right fading into ink, the name, title,
 *  class, role and kit on the left; a new hover crossfades over the last one (240 ms). The dial seal in the corner
 *  rests with its gnomon at ten o'clock and a dashed ring while you hover; locking in swings it to noon and closes it. */
function Showcase(p: { fighter: FighterDefT | undefined; skin?: string; role?: string; locked: boolean; beat: boolean }): JSX.Element {
  const { cv } = useApp();
  const f = p.fighter;
  const key = f ? `${f.id}:${p.skin ?? ''}` : '';
  const last = useRef<{ key: string; f?: FighterDefT; skin?: string }>({ key, f, skin: p.skin });
  const [prev, setPrev] = useState<{ key: string; f?: FighterDefT; skin?: string } | null>(null);
  useEffect(() => {
    const was = last.current;
    last.current = { key, f, skin: p.skin };
    if (!was.key || was.key === key) return;
    setPrev(was);
    const t = setTimeout(() => setPrev(null), 260);
    return () => clearTimeout(t);
  }, [key]);
  const role = cv.role(p.role ?? f?.role);
  if (!f) {
    return (
      <section class="dshow dshow--empty plate" aria-label={cv.t('draft.show.title', 'Your pick')}>
        <DialSeal locked={false} />
        <p class="t-body muted">{cv.t('draft.show.empty', 'Hover a fighter to see them here. Your team sees your hover.')}</p>
      </section>
    );
  }
  return (
    <section class={`dshow plate ${p.locked ? 'is-locked' : 'is-hover'} ${p.beat ? 'is-beat' : ''}`} aria-label={cv.t('draft.show.title', 'Your pick')} aria-live="polite">
      {prev?.f ? <span class="dshow__art is-out" key={`out:${prev.key}`}><Portrait fighter={prev.f} skin={prev.skin} kind="splash" size="fill" position="72% 40%" /></span> : null}
      <span class="dshow__art" key={key}><Portrait fighter={f} skin={p.skin} kind="splash" size="fill" position="72% 40%" /></span>
      <div class="dshow__text">
        <span class="dshow__kick t-label">{p.locked ? cv.t('draft.show.locked', 'Locked in') : cv.t('draft.show.hover', 'Your pick')}</span>
        <h2 class="t-display-m dshow__name">{f.name}</h2>
        <span class="dshow__title">{f.title}</span>
        <span class="dshow__facts t-body-s"><ClassMark classId={f.class} withName />{role ? <span class="dshow__role"><RoleIcon roleId={role.id} size={14} />{role.name}</span> : null}</span>
        <span class="dshow__kit">{KIT.map((slot) => <KitIcon f={f} slot={slot} />)}</span>
      </div>
      <DialSeal locked={p.locked} />
    </section>
  );
}

/** the showcase's dial seal: a ring (state) and the gnomon (the act of choosing) — ten o'clock and dashed while you
 *  hover, swung clockwise to noon and closed when you lock in */
function DialSeal(p: { locked: boolean }): JSX.Element {
  return (
    <svg class={`dseal ${p.locked ? 'is-locked' : ''}`} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="19" class="dseal__face" />
      <circle cx="24" cy="24" r="19" class="dseal__ring" pathLength={100} />
      <line x1="24" y1="2" x2="24" y2="8" class="dseal__noon" />
      <g class="dseal__gnomon"><polygon points="24,24 21.5,9 26.5,9" /></g>
      <circle cx="24" cy="24" r="2.2" class="dseal__pin" />
    </svg>
  );
}

// ── RIFT: bans + snake picks (and blind) ───────────────────────────────────────────────────────
function TeamDraft(p: { d: DraftState; onLeave: () => void }): JSX.Element {
  const { cv, session, sound } = useApp();
  const d = p.d;
  const me = d.seats.find((s) => s.isYou)!;
  const queue = cv.queue(d.queue)!;
  const blind = cv.pickOf(queue) === 'blind';
  const teams = [...new Set(d.seats.map((s) => s.team))];
  const other = teams.find((t) => t !== me.team) ?? 1 - me.team;
  const [filter, setFilter] = useState<GridFilter>(NO_FILTER);
  const [banned, setBanned] = useState<string | null>(null);
  const ban = d.phase === 'ban';
  const myTurn = !!d.turn && (d.turn.players.includes(me.player) || d.turn.action === 'free');
  const allyHover = new Map(d.seats.filter((s) => s.team === me.team && !s.isYou && s.hover && !s.locked).map((s) => [s.hover!, s.name]));
  const takenBy = new Map(d.seats.filter((s) => s.locked && !s.isYou).map((s) => [s.locked!, s]));
  const bansVisible = d.bans.filter((b) => b.fighter);
  const myBans = d.bans.filter((b) => b.team === me.team);
  const theirBans = d.bans.filter((b) => b.team !== me.team);
  const sel = me.hover;

  const hover = (id: string): void => { if (me.locked) return; session.draft({ a: 'hover', fighter: id }); };
  const act = (): void => {
    if (ban && sel) { sound.play('ban'); session.draft({ a: 'ban', fighter: sel }); setBanned(sel); }
    else if (!ban && sel) session.draft({ a: 'lock' });   // the sound is the lock-in beat's, when the session confirms
  };
  const beat = useLockBeat(me.locked);
  let reason: string | null = null;
  if (ban) {
    if (banned) reason = cv.t('draft.ban.waiting', 'Waiting for the other bans.');
    else if (!sel) reason = cv.t('draft.ban.prompt', 'Your team bans {n}. Pick a fighter to ban.', { n: myBans.length });
    else if (allyHover.has(sel)) reason = cv.t('draft.ban.ally_hover', 'A teammate is about to pick {fighter}.', { fighter: cv.fighter(sel)?.name ?? '' });
  } else if (me.locked) reason = cv.t('draft.pick.you_locked', 'You locked {fighter}. Waiting for the others.', { fighter: cv.fighter(me.locked)?.name ?? '' });
  else if (!myTurn) {
    const turnSeat = d.seats.find((s) => d.turn?.players.includes(s.player));
    reason = turnSeat ? (turnSeat.team === me.team ? cv.t('draft.pick.team_turn', 'Your team is picking.') : cv.t('draft.pick.enemy_turn', 'The other team is picking.')) : cv.t('draft.finalize.waiting', 'Waiting for the others.');
  } else if (!sel) reason = cv.t('draft.pick.lock_disabled', 'Pick a fighter to lock in.');
  else if (!d.available.includes(sel)) reason = cv.t('error.draft.unavailable', 'That fighter is already taken.');

  const title = ban ? cv.t('draft.phase.ban', 'Ban phase') : cv.t('draft.phase.pick', 'Pick phase');
  const prompt = ban ? cv.t('draft.ban.prompt', 'Your team bans {n}. Pick a fighter to ban.', { n: myBans.length })
    : blind ? cv.t('draft.pick.blind', 'Pick a fighter. Picks are revealed together.')
      : myTurn && !me.locked ? cv.t('draft.pick.your_turn', 'Your turn. Pick a fighter.')
        : cv.t('draft.pick.turn_of', '{name} is picking.', { name: d.seats.find((s) => d.turn?.players.includes(s.player))?.name ?? '' });
  const sub = ban ? cv.t('draft.ban.prompt_hidden', "Allies see each other's bans. The other team does not.") : cv.t('draft.pick.hover_hint', 'What you hover is shown to your team.');

  return (
    <Screen layout="wide"
      foot={<div class="draft__foot"><Ticker d={d} />{reason ? <span class="reason t-body-s">{reason}</span> : null}</div>}
      cta={<Button variant="chalk" size="l" wedge cue={null} disabled={!!reason} reason={reason ?? undefined} onPress={act}>{ban ? cv.t('btn.ban', 'Ban') : cv.t('btn.lock_in', 'Lock in')}</Button>}>
      <div class="draft">
        <header class="draft__top stg">
          <BanRow bans={myBans} label={cv.t('draft.bans', 'Bans')} hidden={false} />
          <PhaseHead d={d} title={title} prompt={prompt} sub={sub} />
          <BanRow bans={theirBans} label={cv.t('draft.bans', 'Bans')} hidden={ban} />
        </header>
        <div class="draft__main">
          <TeamColumn d={d} team={me.team} rel="ally" />
          <div class="draft__center">
          <section class="draft__grid stg" aria-label={cv.t('draft.pick.title', 'Pick a fighter')}>
            <FighterGrid label={cv.t('draft.pick.title', 'Pick a fighter')} size="s" filter={filter} onFilter={setFilter} compactFilters compact
              card={(f) => {
                const isBanned = bansVisible.some((b) => b.fighter === f.id && (b.team === me.team || !ban));
                const tk = takenBy.get(f.id);
                const mine = me.locked === f.id;
                const unavailable = !ban && !mine && !d.available.includes(f.id);
                return {
                  selected: sel === f.id || mine,
                  intent: allyHover.has(f.id) ? 'ally' : null,
                  locked: isBanned ? cv.t('draft.pick.banned', '{fighter} is banned.', { fighter: f.name })
                    : tk && (tk.team === me.team || !blind) ? tk.name
                      : unavailable ? cv.t('draft.state.taken', 'Taken') : null,
                  lockedKind: isBanned ? 'banned' : 'taken',
                  cue: 'hover_fighter',
                  onPress: () => hover(f.id),
                };
              }} />
          </section>
          {!ban ? <Showcase fighter={cv.fighter(me.locked ?? me.hover)} skin={me.skin} role={me.role} locked={!!me.locked} beat={beat} /> : null}
          </div>
          <TeamColumn d={d} team={other} rel="enemy" hideLocks={blind} />
        </div>
      </div>
    </Screen>
  );
}

function BanRow(p: { bans: DraftState['bans']; label: string; hidden: boolean }): JSX.Element {
  const { cv } = useApp();
  return (
    <div class="bans" aria-label={p.label}>
      {p.bans.length === 0 ? <span class="t-caption quiet">{cv.t('state.empty.bans', 'No bans.')}</span> : null}
      {p.bans.map((b) => {
        const f = cv.fighter(b.fighter);
        return (
          <span class={`ban ${f ? 'is-set' : ''}`} title={f ? f.name : p.hidden ? cv.t('draft.ban.waiting', 'Waiting for the other bans.') : cv.t('draft.ban.none', 'No ban')}>
            {f ? <Portrait fighter={f} size="fill" /> : <span class="ban__q">{p.hidden ? '?' : '–'}</span>}
            {f ? <span class="ban__x" aria-hidden="true"><Icon name="close" /></span> : null}
          </span>
        );
      })}
    </div>
  );
}

// ── BRIDGE: the Lot ────────────────────────────────────────────────────────────────────────────
function LotView(p: { d: DraftState; onLeave: () => void }): JSX.Element {
  const { cv, session, sound } = useApp();
  const d = p.d;
  const me = d.seats.find((s) => s.isYou)!;
  const queue = cv.queue(d.queue)!;
  const bench = d.bench[me.team] ?? [];
  const mine = cv.fighter(me.locked);
  const draws = me.rerolls ?? 0;
  const prev = useRef(me.locked);
  const drawEl = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (prev.current && prev.current !== me.locked) animateIn(drawEl.current, { from: 'above', dist: 'panel', d: 'panel' });
    prev.current = me.locked;
  }, [me.locked]);
  const reason = draws <= 0 ? cv.t('lot.draw_none', 'No draws left') : null;
  return (
    <Screen layout="wide"
      foot={<div class="draft__foot"><Ticker d={d} /><span class="t-body-s muted">{cv.t('lot.lot_note', 'Everyone on your team can swap with the Lot while the timer runs.')}</span></div>}
      cta={<Button variant="chalk" size="l" icon="reroll" cue="click" disabled={!!reason} reason={reason ?? undefined}
        onPress={() => session.draft({ a: 'reroll' })}>{cv.t('btn.draw_again', 'Draw again')}</Button>}>
      <div class="lot">
        <header class="draft__top draft__top--lot stg">
          <PhaseHead d={d} title={cv.t('lot.title', 'The Lot')} prompt={cv.t('lot.prompt', 'Your fighter was drawn by lot. Swap with your team\'s Lot, or draw again once.')}
            sub={cv.t('lot.window', 'The Lot closes in {t}.', { t: fmtWait(d.timer) })} />
        </header>
        <div class="lot__main">
          <section class="lot__draw plate stg" aria-label={cv.t('lot.your_draw', 'Your draw')}>
            <div ref={drawEl} class="lot__splash"><Portrait fighter={mine} skin={me.skin} kind="splash" size="fill" /></div>
            <div class="lot__drawtext">
              <span class="t-label muted">{cv.t('lot.your_draw', 'Your draw')}</span>
              <h2 class="t-display-m">{mine?.name ?? '—'}</h2>
              {mine ? <span class="t-body-s muted"><ClassMark classId={mine.class} withName /> · {mine.title}</span> : null}
              {mine ? <p class="t-body">{mine.job}</p> : null}
              <span class="t-caption muted">{draws > 0 ? (draws === 1 ? cv.t('lot.draw_left', '{n} draw left', { n: draws }) : cv.t('lot.draw_left_plural', '{n} draws left', { n: draws })) : cv.t('lot.draw_none', 'No draws left')} · {cv.t('lot.draw_hint', 'Draw a new fighter. Your old one joins the Lot.')}</span>
            </div>
          </section>
          <section class="lot__bench stg" aria-label={cv.t('lot.team_lot', "Your team's Lot")}>
            <h2 class="t-h2">{cv.t('lot.team_lot', "Your team's Lot")} <span class="t-caption muted num">{bench.length}/{queue.bench?.size ?? bench.length}</span></h2>
            {bench.length ? (
              <div class="lot__cards" data-arrownav="grid">
                {bench.map((id) => {
                  const f = cv.fighter(id);
                  if (!f) return null;
                  return (
                    <div class="lotcard plate">
                      <Portrait fighter={f} size="fill" class="lotcard__art" />
                      <div class="lotcard__meta">
                        <span class="t-body-s">{f.name}</span>
                        <span class="t-caption muted"><ClassMark classId={f.class} withName /></span>
                      </div>
                      <Button variant="secondary" size="s" icon="swap" tip={cv.t('lot.swap_hint', 'Your fighter goes to the Lot for a teammate to take.')}
                        onPress={() => { sound.play('click'); session.draft({ a: 'benchSwap', fighter: id }); }}>{cv.t('lot.swap', 'Swap')}</Button>
                    </div>
                  );
                })}
              </div>
            ) : <EmptyState compact text={cv.t('state.empty.lot', 'The Lot is empty.')} />}
            <p class="t-caption muted">{cv.t('lot.swap_hint', 'Your fighter goes to the Lot for a teammate to take.')}</p>
          </section>
          <TeamColumn d={d} team={me.team} rel="ally" />
        </div>
      </div>
    </Screen>
  );
}

// ── FRAY: simultaneous pick ────────────────────────────────────────────────────────────────────
function FrayPick(p: { d: DraftState; onLeave: () => void }): JSX.Element {
  const { cv, session } = useApp();
  const d = p.d;
  const me = d.seats.find((s) => s.isYou)!;
  useLockBeat(me.locked);
  const [filter, setFilter] = useState<GridFilter>(NO_FILTER);
  const lockedBy = new Map(d.seats.filter((s) => s.locked && !s.isYou).map((s) => [s.locked!, s]));
  const mySeat = seatOf(me.player);
  const colour = cv.t(`fray.seat.${mySeat}`, '');
  const sel = me.hover;
  const reason = me.locked ? cv.t('draft.pick.you_locked', 'You locked {fighter}. Waiting for the others.', { fighter: cv.fighter(me.locked)?.name ?? '' })
    : !sel ? cv.t('draft.pick.lock_disabled', 'Pick a fighter to lock in.')
      : lockedBy.has(sel) ? cv.t('fray.pick.taken', '{name} locked {fighter}.', { name: lockedBy.get(sel)!.name, fighter: cv.fighter(sel)?.name ?? '' }) : null;
  return (
    <Screen layout="wide"
      foot={<div class="draft__foot"><Ticker d={d} /><span class="t-body-s muted">{cv.t('fray.pick.first_lock', 'If two players lock the same fighter, the first lock keeps it.')}</span></div>}
      cta={<Button variant="chalk" size="l" wedge cue={null} disabled={!!reason} reason={reason ?? undefined} onPress={() => session.draft({ a: 'lock' })}>{cv.t('btn.lock_in', 'Lock in')}</Button>}>
      <div class="draft draft--ffa">
        <header class="draft__top draft__top--ffa stg">
          <PhaseHead d={d} title={cv.t('fray.pick.title', 'Pick your fighter')} prompt={cv.t('fray.pick.prompt', 'Pick any fighter nobody else has locked.')}
            sub={cv.t('fray.seat.you', 'You hold Seat {roman} · {colour}.', { roman: roman(mySeat), colour })} />
          <div class="fseats" aria-label={cv.t('hourboard.title', 'Hour Board')}>
            {d.seats.map((s) => {
              const f = cv.fighter(s.locked);
              const seat = seatOf(s.player);
              return (
                <div class={`fseat ${s.isYou ? 'is-you' : ''} ${s.locked ? 'is-locked' : ''}`} title={`${s.name}${f ? ` · ${f.name}` : ''}`}>
                  <span class="fseat__art">{f ? <Portrait fighter={f} skin={s.skin} size="fill" /> : null}</span>
                  <SeatMark seat={seat} you={s.isYou} size={16} />
                  <span class="fseat__name t-caption">{s.isYou ? cv.t('common.you', 'You') : breakable(s.name)}</span>
                </div>
              );
            })}
          </div>
        </header>
        <section class="draft__grid draft__grid--ffa stg">
          <FighterGrid label={cv.t('fray.pick.title', 'Pick your fighter')} size="s" filter={filter} onFilter={setFilter} compactFilters compact cols={8}
            card={(f) => {
              const by = lockedBy.get(f.id);
              const mine = me.locked === f.id;
              return {
                selected: sel === f.id || mine,
                locked: by ? cv.t('fray.pick.taken', '{name} locked {fighter}.', { name: by.name, fighter: f.name }) : null,
                lockedKind: 'taken', cue: 'hover_fighter',
                onPress: () => { if (!me.locked) session.draft({ a: 'hover', fighter: f.id }); },
              };
            }} />
        </section>
      </div>
    </Screen>
  );
}

/** a player name that may wrap at its underscores (the 720p seat chips give names two short lines) */
function breakable(name: string): (string | JSX.Element)[] {
  return name.split('_').flatMap((part, i, all) => (i < all.length - 1 ? [`${part}_`, <wbr />] : [part]));
}

// ── finalize: skin, spells, boons, trades ──────────────────────────────────────────────────────
function Finalize(p: { d: DraftState; ffa: boolean; onLeave: () => void }): JSX.Element {
  const { cv, state, session, sound } = useApp();
  const d = p.d;
  const me = d.seats.find((s) => s.isYou)!;
  const f = cv.fighter(me.locked);
  const queue = cv.queue(d.queue)!;
  const mode = cv.mode(d.mode);
  const rules = cv.rulesOf(queue);
  const [lockedIn, setLockedIn] = useState(false);
  const loadout = me.loadout ?? state.profile.value.loadouts[me.locked ?? ''] ?? { spells: [], boons: [] };
  const trades = d.trades ?? [];
  const incoming = trades.filter((t) => t.to === me.player);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const t of incoming) {
      const k = `${t.from}>${t.to}`;
      if (seen.current.has(k)) continue;
      seen.current.add(k);
      const from = d.seats.find((s) => s.player === t.from);
      state.toast(cv.t('toast.trade_incoming', '{name} wants to trade fighters.', { name: from?.name ?? '' }), 'info');
    }
  }, [incoming.length]);
  const done = d.phase === 'done';
  const nBoons = cv.boonSlots(rules.itemPool);
  const full = loadout.spells.length >= cv.spellSlots() && loadout.boons.length >= nBoons;
  const reason = done ? cv.t('draft.phase.done', 'Draft complete') : lockedIn ? cv.t('draft.finalize.starting', 'The match starts when the timer ends.') : !full ? cv.t('loadout.needs_full', 'Fill every slot to lock in.') : null;
  const tradeActions = (s: DraftSeat): JSX.Element | null => {
    if (s.isYou || !s.locked || !me.locked || s.team !== me.team || p.ffa || done) return null;
    const inc = incoming.find((t) => t.from === s.player);
    const out = trades.find((t) => t.from === me.player && t.to === s.player);
    if (inc) return <Button variant="secondary" size="s" icon="swap" cue="accept" onPress={() => session.draft({ a: 'tradeAccept', with: s.player })}>{cv.t('draft.trade.accept', 'Accept')}</Button>;
    if (out) return <span class="t-caption muted">{cv.t('draft.trade.pending', 'Waiting for {name}.', { name: s.name })}</span>;
    return <Button variant="quiet" size="s" icon="swap" class="seat__trade" label={cv.t('draft.trade.request', 'Ask {name} to trade', { name: s.name })} tip={cv.t('draft.trade.request', 'Ask {name} to trade', { name: s.name })}
      onPress={() => { session.draft({ a: 'tradeRequest', with: s.player }); state.toast(cv.t('toast.trade_request', 'Trade request sent to {name}.', { name: s.name }), 'info'); }}>{cv.t('btn.trade', 'Trade')}</Button>;
  };
  const teams = [...new Set(d.seats.map((s) => s.team))];
  const other = teams.find((t) => t !== me.team);
  const blind = cv.pickOf(queue) === 'blind';
  return (
    <Screen layout="wide"
      foot={<div class="draft__foot"><Ticker d={d} />{reason ? <span class="reason t-body-s">{reason}</span> : null}</div>}
      cta={<Button variant="chalk" size="l" wedge cue={null} disabled={!!reason} reason={reason ?? undefined}
        onPress={() => { sound.play('lockin'); session.draft({ a: 'loadout', loadout }); if (me.skin) session.draft({ a: 'skin', skin: me.skin }); setLockedIn(true); state.toast(cv.t('loadout.locked_in', 'Locked in'), 'ok'); }}>
        {lockedIn ? cv.t('loadout.locked_in', 'Locked in') : cv.t('btn.lock_in', 'Lock in')}
      </Button>}>
      <div class="draft draft--final">
        <header class="draft__top stg">
          <PhaseHead d={d} title={done ? cv.t('draft.phase.done', 'Draft complete') : cv.t('draft.finalize.title', 'Skin and loadout')}
            prompt={p.ffa ? cv.t('fray.pick.spells', 'FRAY starts you at level 6 with your ultimate ready.') : cv.t('draft.finalize.prompt', 'Choose your skin and loadout. You can trade fighters with a locked teammate.')} />
        </header>
        <div class={`draft__main ${p.ffa ? 'draft__main--ffa' : ''}`}>
          {p.ffa ? (
            <aside class="dteam" aria-label={cv.t('hourboard.title', 'Hour Board')}>
              {d.seats.map((s) => {
                const sf = cv.fighter(s.locked);
                return (
                  <div class={`seat seat--${s.isYou ? 'self' : 'enemy'} seat--ffa`}>
                    <span class="seat__portrait">{sf ? <Portrait fighter={sf} skin={s.skin} size="fill" /> : null}</span>
                    <span class="seat__text"><span class="seat__name t-body-s"><SeatMark seat={seatOf(s.player)} you={s.isYou} size={14} />{s.isYou ? cv.t('common.you', 'You') : s.name}</span><span class="t-caption muted">{sf?.name}</span></span>
                  </div>
                );
              })}
            </aside>
          ) : <TeamColumn d={d} team={me.team} rel="ally" actions={tradeActions} />}
          <section class="draft__final stg">
            {f ? (
              <div class="final">
                <div class="final__who">
                  <h2 class="t-display-m">{f.name}</h2>
                  <span class="t-body-s muted final__facts"><ClassMark classId={f.class} withName /><span class="dshow__role"><RoleIcon roleId={me.role ?? f.role} size={14} />{cv.role(me.role ?? f.role)?.name}</span></span>
                  <p class="t-body-s final__job">{f.job}</p>
                </div>
                <LoadoutPanel fighter={f} skin={me.skin} loadout={loadout} pool={rules.itemPool} modeName={mode?.name} draft tabs
                  readOnly={done || lockedIn ? (done ? cv.t('draft.phase.done', 'Draft complete') : cv.t('loadout.locked_in', 'Locked in')) : undefined}
                  onSkin={(s) => { session.draft({ a: 'skin', skin: s.id }); sound.play('equip'); }}
                  onLoadout={(l) => session.draft({ a: 'loadout', loadout: l })} />
              </div>
            ) : <EmptyState text={cv.t('error.draft.not_locked', 'Lock in a fighter first.')} />}
          </section>
          {!p.ffa && other !== undefined ? <TeamColumn d={d} team={other} rel="enemy" hideLocks={blind && d.phase !== 'finalize'} /> : null}
        </div>
      </div>
    </Screen>
  );
}
