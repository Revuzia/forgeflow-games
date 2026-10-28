// VALE HUD — the top of the screen: the sky strip (720 × 48, top centre: takedowns and structures per
// side, the clock, objective chips with return rings and, under its right end, your own ledger line — T/F/A
// and Wicks, HUD-4; FRAY: the time left and "First to 12"; pregame
// countdown; sudden death in HARM), the announcer banner under it (two lines, minor 2.4 s / major
// 3.6 s, a queue of 2; it is also the subtitle; takedown banners carry the two fighters as 48 px round
// portraits in their relationship rings, the fallen one cut by the 30° shadow line, in over 70 ms,
// 3.5 s, out over 300 ms — r12 m2), the surrender vote plate, the kill feed (top right,
// 3 rows, 6 s, newest on top; your rows in the Noonwhite double frame) and the FRAY Hour Board
// (220 × 236, top right; the kill feed docks under it).

import type { CSSProperties, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import type { ObjectiveTimerView, PlayerView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { roman } from '../components/Seat.tsx';
import { SeatGlyph } from '../components/Glyphs.tsx';
import { fmtClock, fmtInt } from '../format.ts';
import { put, REL_VAR, setCls, setVar, useHud, useViewKey, useWriter } from './ctx.ts';
import { SideGlyph } from './glyphs.tsx';
import type { Cause, KillRow, Who } from './model.ts';

// ── sky strip ────────────────────────────────────────────────────────────────────────────────────
export function SkyStrip(): JSX.Element {
  const { cv } = useApp();
  const { model, client } = useHud();
  const mine = (): ReturnType<typeof model.view.teams.find> => model.view.teams.find((t) => t.team === model.myTeam);
  const theirs = (): ReturnType<typeof model.view.teams.find> => model.view.teams.find((t) => t.team !== model.myTeam);
  useViewKey(() => { const v = model.view, a = mine(), b = theirs(); return `${v.phase}|${v.suddenDeath ? 1 : 0}|${a?.kills ?? 0}|${a?.structuresDestroyed ?? 0}|${b?.kills ?? 0}|${b?.structuresDestroyed ?? 0}`; });
  const mode = cv.mode(client.setup.mode);
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : mode?.rules;
  const limit = rules?.end.timeLimit ?? 0;
  const clockEl = useRef<HTMLSpanElement>(null);
  // the clock: pregame countdown (HARM in the last 5 s), match time, FRAY's time left (HARM in the last minute)
  useWriter(() => {
    const v = model.view;
    const el = clockEl.current;
    if (v.phase === 'pregame') { put(el, fmtClock(Math.ceil(-v.time))); setCls(el?.parentElement, 'is-harm', -v.time <= 5); return; }
    if (model.ffa && limit) { const left = Math.max(0, limit - Math.max(0, v.time)); put(el, fmtClock(left)); setCls(el, 'is-harm', left <= 60); return; }
    put(el, fmtClock(Math.max(0, v.time)));
  });
  const v = model.view;
  const pre = v.phase === 'pregame';
  const clock = pre ? (
    <span class="sky__clock num" aria-live="off">
      <span class="t-caption sky__pre">{cv.t('hud.pregame', 'The match begins in {t}', { t: '' }).replace(/\s*$/, '')}</span> <span ref={clockEl} />
    </span>
  ) : <span class={`sky__clock num ${v.suddenDeath ? 'is-harm' : ''}`} title={cv.t('hud.clock', 'Match time')} ref={clockEl} />;
  if (model.ffa) {
    const first = rules?.end.killScore ?? 0;
    return (
      <header class="sky sky--ffa" aria-label={cv.t('hud.score', 'Score')}>
        <span class="sky__side t-caption">{first ? cv.t('hud.fray.first_to', 'First to {n}', { n: first }) : ''}</span>
        {clock}
        <span class="sky__side t-caption">{limit && !pre ? cv.t('hud.fray.clock', 'Ends at {t}', { t: fmtClock(limit) }) : ''}</span>
        {v.suddenDeath ? <span class="sky__sd t-label">{cv.t('hud.sudden_death', 'Sudden death')}</span> : null}
        <div class="sky__under"><span /><span /><span class="sky__under-r"><SkyLedger /></span></div>
      </header>
    );
  }
  const a = mine(), b = theirs();
  return (
    <header class="sky" aria-label={cv.t('hud.score', 'Score')}>
      <div class="sky__team sky__team--ally">
        <span class="sky__mark" style={{ color: REL_VAR.ally }}><SideGlyph team={model.myTeam} size={14} /></span>
        <span class="sky__struct num" title={cv.t('score.structures_down', 'Structures down')}><StructGlyph />{a?.structuresDestroyed ?? 0}</span>
        <span class="sky__kills num" title={cv.t('hud.takedowns', 'Takedowns')}>{a?.kills ?? 0}</span>
      </div>
      <div class="sky__mid">
        {clock}
        {v.suddenDeath ? <span class="sky__sd t-caption">{cv.t('hud.sudden_death', 'Sudden death')}</span> : null}
      </div>
      <div class="sky__team sky__team--enemy">
        <span class="sky__kills num" title={cv.t('hud.takedowns', 'Takedowns')}>{b?.kills ?? 0}</span>
        <span class="sky__struct num" title={cv.t('score.structures_down', 'Structures down')}>{b?.structuresDestroyed ?? 0}<StructGlyph /></span>
        <span class="sky__mark" style={{ color: REL_VAR.enemy }}><SideGlyph team={b?.team ?? 1} size={14} /></span>
      </div>
      <div class="sky__under"><span /><ObjectiveChips /><span class="sky__under-r"><SkyLedger /></span></div>
    </header>
  );
}

/** HUD-4: your own ledger, always on — a quiet Mono line docked under the sky strip's right end: takedowns /
 *  falls / assists and Wicks (FRAY: no Wicks). It re-renders only when one of those numbers changes (B4); the
 *  per-minute rate lives in its tooltip, refreshed by the writer once a second. Settings › Gameplay hides it
 *  (a per-device HUD preference). */
export function SkyLedger(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  const el = useRef<HTMLSpanElement>(null);
  useViewKey(() => { const p = model.me; return p ? `${p.kills}/${p.deaths}/${p.assists}|${Math.floor(p.cs)}` : ''; });
  const rate = useRef('');
  useWriter(() => {
    const p = model.me, t = model.view.time;
    if (!p || !el.current || model.ffa) return;
    const r = t >= 60 ? (p.cs / (t / 60)).toFixed(1) : '';
    if (r === rate.current) return;
    rate.current = r;
    el.current.title = r ? cv.t('hud.ledger.rate', '{n} Wicks a minute', { n: r }) : '';
  });
  const p = model.me;
  if (!p || state.prefs.value.hudLedger === false) return null;
  const tfa = `${p.kills}/${p.deaths}/${p.assists}`;
  const wicks = fmtInt(Math.floor(p.cs));
  const label = model.ffa ? cv.t('hud.ledger.aria_ffa', 'Your takedowns, falls and assists: {tfa}', { tfa })
    : cv.t('hud.ledger.aria', 'Your takedowns, falls and assists: {tfa}. Wicks: {n}', { tfa, n: wicks });
  return (
    <span ref={el} class="skyledger num" role="status" aria-live="off" aria-label={label}>
      <span class="skyledger__k">{cv.t('hud.ledger.tfa', 'T/F/A')}</span><span class="skyledger__v">{tfa}</span>
      {model.ffa ? null : <><span class="skyledger__sep" aria-hidden="true">·</span><span class="skyledger__k">{cv.t('hud.ledger.wicks', 'Wicks')}</span><span class="skyledger__v">{wicks}</span></>}
    </span>
  );
}
const StructGlyph = (): JSX.Element => <svg class="sky__sg" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l3.5 9h-7z" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>;

/** one chip per objective unit kind (camps of the same unit share a chip: the soonest one) */
function objectivesByUnit(objs: readonly ObjectiveTimerView[]): Map<string, ObjectiveTimerView> {
  const byUnit = new Map<string, ObjectiveTimerView>();
  for (const o of objs) {
    const cur = byUnit.get(o.unit);
    if (!cur || (cur.alive ? false : o.alive || o.respawnIn < cur.respawnIn)) byUnit.set(o.unit, o);
  }
  return byUnit;
}
function ObjectiveChips(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  useViewKey(() => [...objectivesByUnit(model.view.objectives).values()].map((o) => `${o.unit}:${o.alive ? 1 : 0}`).join(','));
  const objs = [...objectivesByUnit(model.view.objectives).values()];
  if (!objs.length) return <span />;
  return (
    <div class="sky__objs" aria-label={cv.t('hud.objectives', 'Objectives')}>
      {objs.map((o) => <ObjChip unit={o.unit} key={o.unit} />)}
    </div>
  );
}
function ObjChip(p: { unit: string }): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  const ring = useRef<HTMLSpanElement>(null), t = useRef<HTMLSpanElement>(null);
  const max = model.unit(p.unit) ? (cv.map(model.client.setup.map)?.camps.find((c) => c.units.some((u) => u.unit === p.unit))?.respawn ?? 0) : 0;
  const get = (): ObjectiveTimerView | undefined => objectivesByUnit(model.view.objectives).get(p.unit);
  useWriter(() => {
    const o = get();
    if (!o) return;
    setVar(ring.current, '--f', (!o.alive && max > 0 ? Math.max(0, Math.min(1, 1 - o.respawnIn / max)) : 1).toFixed(3));
    put(t.current, o.alive ? cv.t('hud.objective_up', 'Up') : fmtClock(o.respawnIn));
  });
  const o = get();
  if (!o) return null;
  const name = model.unit(o.unit)?.name ?? o.unit;
  return (
    <span class={`objchip ${o.alive ? 'is-up' : ''}`} title={o.alive ? `${name} · ${cv.t('hud.objective_up', 'Up')}` : `${name} · ${cv.t('hud.objective_returns', 'Returns in {t}', { t: '' }).trim()}`}>
      <span class="objchip__ring" ref={ring} />
      <span class="t-caption objchip__name">{name}</span>
      <span class="num objchip__t" ref={t} />
    </span>
  );
}

// ── announcer ────────────────────────────────────────────────────────────────────────────────────
export function Announcer(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  const b = model.banner.value;
  if (!b || !state.settings.value.access.subtitles) return null;
  const kill = !!(b.a || b.b);
  return (
    <div class={`announce announce--${b.tone} ${b.major ? 'is-major' : ''} ${kill ? 'is-kill' : ''}`} key={b.id} role="status" aria-live="polite" aria-label={cv.t('a11y.announcer_region', 'Match announcements')}
      style={{ '--life': `${b.ms}ms` } as CSSProperties}>
      {kill ? <AnnounceFace w={b.a} /> : null}
      <span class="announce__text">
        <span class="announce__rule" aria-hidden="true" />
        <span class="t-h1 announce__title">{b.title}</span>
        {b.sub ? <span class="t-body-s announce__sub">{b.sub}</span> : null}
      </span>
      {kill ? <AnnounceFace w={b.b} down /> : null}
    </div>
  );
}
/** a takedown banner's fighter: 48 px round portrait in its relationship ring (FRAY: seat colour) */
function AnnounceFace(p: { w: Who | undefined; down?: boolean }): JSX.Element {
  const { cv } = useApp();
  const { model } = useHud();
  const w = p.w;
  if (!w) return <span class="aface aface--empty" aria-hidden="true" />;
  const f = cv.fighter(w.fighter);
  const color = model.ffa && w.rel !== 'self' && w.seat ? `var(--seat-${w.seat})` : REL_VAR[w.rel];
  return (
    <span class={`aface aface--${w.rel} ${p.down ? 'is-down' : ''}`} style={{ '--c': color } as CSSProperties} aria-hidden="true">
      <span class="aface__img">{f ? <Portrait fighter={f} skin={w.skin} size="fill" round /> : null}</span>
      {p.down ? <span class="aface__cut" /> : null}
    </span>
  );
}

// ── surrender ────────────────────────────────────────────────────────────────────────────────────
export function SurrenderPlate(): JSX.Element | null {
  const { cv } = useApp();
  const { model, client } = useHud();
  const vote = model.vote.value;
  if (!vote) return null;
  return (
    <div class="vote plate" role="group" aria-label={cv.t('hud.surrender.title', 'Surrender')}>
      <span class="t-label">{cv.t('hud.surrender.title', 'Surrender')}</span>
      <span class="t-body-s num">{cv.t('hud.surrender.tally', '{yes} yes · {no} no · {needed} needed', { yes: vote.yes, no: vote.no, needed: vote.needed })}</span>
      {vote.voted ? <span class="t-caption muted">{cv.t('hud.surrender.you_voted', 'You voted {choice}.', { choice: (vote.mine === false ? cv.t('common.no', 'No') : cv.t('common.yes', 'Yes')).toLowerCase() })}</span> : (
        <span class="vote__btns">
          <button type="button" class="hbtn hbtn--chalk" onClick={() => { client.send({ type: 'surrenderVote', yes: true }); model.vote.value = { ...vote, voted: true, mine: true }; }}>{cv.t('common.yes', 'Yes')}</button>
          <button type="button" class="hbtn" onClick={() => { client.send({ type: 'surrenderVote', yes: false }); model.vote.value = { ...vote, voted: true, mine: false }; }}>{cv.t('common.no', 'No')}</button>
        </span>
      )}
    </div>
  );
}

// ── kill feed ────────────────────────────────────────────────────────────────────────────────────
export function KillFeed(): JSX.Element {
  const { model } = useHud();
  const rows = model.killfeed.value;
  return (
    <ol class={`kfeed ${model.ffa ? 'kfeed--ffa' : ''}`} aria-live="polite">
      {rows.map((r) => <KillFeedRow r={r} key={r.id} />)}
    </ol>
  );
}
/** one kill-feed row (HUD-6). Fighter rows are pictographic — killer or cause, the arrow, the fallen fighter's chip
 *  — and never repeat a name the chip already shows; the full sentence is the row's aria-label. Team rows
 *  (structure lost, objective taken, wipe) keep their sentence beside the side mark. */
function KillFeedRow(p: { r: KillRow }): JSX.Element {
  const { cv } = useApp();
  const r = p.r;
  const arrow = r.kind === 'takedown' || r.kind === 'objective' || (r.kind === 'fell' && !!r.cause);
  const words = r.kind === 'structure' || r.kind === 'objective' || r.kind === 'wipe';
  return (
    <li class={`krow plate ${r.mine ? 'is-mine' : ''} krow--${r.kind}`} aria-label={r.text}>
      {r.killer ? <WhoChip w={r.killer} /> : null}
      {r.cause ? <CauseChip c={r.cause} /> : null}
      {arrow ? (
        <span class="krow__act" aria-hidden="true">
          <svg viewBox="0 0 20 12"><path d="M1 6h13M10 1.5l6 4.5-6 4.5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
          {r.assists.length ? <span class="krow__assists">{r.assists.slice(0, 4).map((a) => <WhoDot w={a} />)}</span> : null}
        </span>
      ) : null}
      {r.victim ? <WhoChip w={r.victim} down={r.kind !== 'structure' && r.kind !== 'wipe'} /> : null}
      {words ? <span class="krow__text t-caption" aria-hidden="true">{r.text}</span> : null}
      {r.kind === 'out' ? <span class="krow__tag t-caption" aria-hidden="true">{cv.t('killfeed.tag.out', 'Out')}</span> : null}
      {r.kind === 'fell' && !r.cause ? <span class="krow__tag t-caption" aria-hidden="true">{cv.t('killfeed.tag.fell', 'Fell')}</span> : null}
    </li>
  );
}
/** what a fighter fell to: a drawn mark in its relationship colour and the unit's name (structure, camp, Wicks) */
function CauseChip(p: { c: Cause }): JSX.Element {
  return (
    <span class={`kcause kcause--${p.c.kind}`} style={{ '--c': REL_VAR[p.c.rel] } as CSSProperties} aria-hidden="true">
      <svg class="kcause__glyph" viewBox="0 0 16 16">
        {p.c.kind === 'structure' ? <path d="M8 1.5l4.2 12H3.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
          : p.c.kind === 'monster' ? <rect x="3" y="3" width="10" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6" />
            : <><circle cx="5" cy="9" r="2.4" fill="currentColor" /><circle cx="11" cy="9" r="2.4" fill="currentColor" /><circle cx="8" cy="4.5" r="2.4" fill="currentColor" /></>}
      </svg>
      <span class="kcause__name t-caption">{p.c.name}</span>
    </span>
  );
}
function WhoChip(p: { w: Who; down?: boolean }): JSX.Element {
  const { cv } = useApp();
  const { model } = useHud();
  const f = cv.fighter(p.w.fighter);
  const color = model.ffa && p.w.rel !== 'self' && p.w.seat ? `var(--seat-${p.w.seat})` : REL_VAR[p.w.rel];
  return (
    <span class={`who who--${p.w.rel} ${p.down ? 'is-down' : ''}`} style={{ '--c': color } as CSSProperties}>
      {f ? <Portrait fighter={f} skin={p.w.skin} size="fill" round class="who__face" /> : p.w.team !== undefined ? <span class="who__mark"><SideGlyph team={p.w.team} size={12} /></span> : null}
      {model.ffa && p.w.seat ? <span class="who__seat"><SeatGlyph seat={p.w.seat} size={10} color={color} /></span> : null}
      {f ? <span class="who__name t-caption">{p.w.rel === 'self' ? cv.t('killfeed.you', 'You') : p.w.name}</span> : null}
    </span>
  );
}
function WhoDot(p: { w: Who }): JSX.Element {
  const { cv } = useApp();
  const f = cv.fighter(p.w.fighter);
  return <span class={`whodot who--${p.w.rel}`} style={{ '--c': REL_VAR[p.w.rel] } as CSSProperties}>{f ? <Portrait fighter={f} skin={p.w.skin} size="fill" round /> : null}</span>;
}

// ── FRAY Hour Board ──────────────────────────────────────────────────────────────────────────────
export function rankFray(players: readonly PlayerView[]): PlayerView[] {
  const inn = players.filter((p) => p.placement === undefined).sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.damageToFighters - a.damageToFighters || a.player - b.player);
  const out = players.filter((p) => p.placement !== undefined).sort((a, b) => (a.placement ?? 0) - (b.placement ?? 0));
  return [...inn, ...out];
}

export function HourBoard(): JSX.Element {
  const { cv, state } = useApp();
  const { model, client } = useHud();
  useViewKey(() => model.view.players.map((p) => `${p.player}:${p.score ?? 0}:${p.lives ?? 0}:${p.placement ?? ''}:${Math.round(p.damageToFighters / 50)}`).join(','));
  const v = model.view;
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : cv.mode(client.setup.mode)?.rules;
  const lives = rules?.end.lives ?? 0;
  const first = rules?.end.killScore ?? 0;
  const rows = rankFray(v.players);
  const lead = rows[0];
  const colours = state.frayColors.value;
  return (
    <section class="hboard plate" aria-label={cv.t('hourboard.title', 'Hour Board')}>
      <header class="hboard__head">
        <span class="t-label">{cv.t('hourboard.title', 'Hour Board')}</span>
        {first ? <span class="t-caption muted">{cv.t('hourboard.first_to', 'First to {n}', { n: first })}</span> : null}
      </header>
      <ol class="hboard__rows">
        {rows.map((p, i) => {
          const you = p.player === model.you;
          const seat = (p.colorIndex % 10) + 1;
          const out = p.placement !== undefined;
          const color = you ? 'var(--team-self)' : colours === 'simple' ? 'var(--team-enemy)' : `var(--seat-${seat})`;
          return (
            <li class={`frow ${you ? 'is-you' : ''} ${out ? 'is-out' : ''}`} style={{ '--c': color } as CSSProperties}>
              <span class="frow__place num">{out ? p.placement : i + 1}</span>
              <span class="frow__seat" title={`${roman(seat)}`}><SeatGlyph seat={seat} size={colours === 'stamp' && !you ? 15 : 11} color={color} keyline={!you} /></span>
              <span class="frow__name t-caption">{you ? cv.t('hourboard.you', 'You') : p.name}</span>
              {out ? <span class="frow__out t-caption">{cv.t('hourboard.out', 'Out')}</span> : (
                <span class="frow__lives" aria-label={cv.t('fray.lives_n', '{n} lives', { n: p.lives ?? 0 })}>{Array.from({ length: lives }, (_, k) => <i class={k < (p.lives ?? 0) ? 'is-on' : ''} />)}</span>
              )}
              <span class="frow__score num">{fmtInt(p.score ?? 0)}{p === lead && !out && (p.score ?? 0) > 0 ? <span class="frow__lead" aria-label={cv.t('hourboard.leader', 'Leading')} /> : null}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
