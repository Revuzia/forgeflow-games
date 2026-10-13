// VALE HUD — the top of the screen: the sky strip (720 × 48, top centre: takedowns and structures per
// side, the clock, objective chips with return rings; FRAY: the time left and "First to 12"; pregame
// countdown; sudden death in HARM), the announcer banner under it (two lines, minor 2.4 s / major
// 3.6 s, a queue of 2; it is also the subtitle), the surrender vote plate, the kill feed (top right,
// 3 rows, 6 s, newest on top; your rows in the Noonwhite double frame) and the FRAY Hour Board
// (220 × 236, top right; the kill feed docks under it).

import type { CSSProperties, JSX } from 'preact';
import type { PlayerView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { roman } from '../components/Seat.tsx';
import { SeatGlyph } from '../components/Glyphs.tsx';
import { fmtClock, fmtInt } from '../format.ts';
import { REL_VAR, useHud } from './ctx.ts';
import { SideGlyph } from './glyphs.tsx';
import type { KillRow, Who } from './model.ts';

// ── sky strip ────────────────────────────────────────────────────────────────────────────────────
export function SkyStrip(): JSX.Element {
  const { cv } = useApp();
  const { model, client } = useHud();
  model.frame.value;
  const v = model.view;
  const pre = v.phase === 'pregame';
  const mode = cv.mode(client.setup.mode);
  const q = cv.queue(client.setup.queue);
  const rules = q ? cv.rulesOf(q) : mode?.rules;
  const clock = pre ? (
    <span class={`sky__clock num ${-v.time <= 5 ? 'is-harm' : ''}`} aria-live="off">
      <span class="t-caption sky__pre">{cv.t('hud.pregame', 'The match begins in {t}', { t: '' }).replace(/\s*$/, '')}</span> {fmtClock(Math.ceil(-v.time))}
    </span>
  ) : <span class={`sky__clock num ${v.suddenDeath ? 'is-harm' : ''}`} title={cv.t('hud.clock', 'Match time')}>{fmtClock(Math.max(0, v.time))}</span>;
  if (model.ffa) {
    const limit = rules?.end.timeLimit ?? 0;
    const left = Math.max(0, limit - Math.max(0, v.time));
    const first = rules?.end.killScore ?? 0;
    return (
      <header class="sky sky--ffa" aria-label={cv.t('hud.score', 'Score')}>
        <span class="sky__side t-caption">{first ? cv.t('hud.fray.first_to', 'First to {n}', { n: first }) : ''}</span>
        {pre ? clock : <span class={`sky__clock num ${left <= 60 && limit ? 'is-harm' : ''}`}>{limit ? fmtClock(left) : fmtClock(Math.max(0, v.time))}</span>}
        <span class="sky__side t-caption">{limit && !pre ? cv.t('hud.fray.clock', 'Ends at {t}', { t: fmtClock(limit) }) : ''}</span>
        {v.suddenDeath ? <span class="sky__sd t-label">{cv.t('hud.sudden_death', 'Sudden death')}</span> : null}
      </header>
    );
  }
  const mine = v.teams.find((t) => t.team === model.myTeam);
  const theirs = v.teams.find((t) => t.team !== model.myTeam);
  return (
    <header class="sky" aria-label={cv.t('hud.score', 'Score')}>
      <div class="sky__team sky__team--ally">
        <span class="sky__mark" style={{ color: REL_VAR.ally }}><SideGlyph team={model.myTeam} size={14} /></span>
        <span class="sky__struct num" title={cv.t('score.structures_down', 'Structures down')}><StructGlyph />{mine?.structuresDestroyed ?? 0}</span>
        <span class="sky__kills num" title={cv.t('hud.takedowns', 'Takedowns')}>{mine?.kills ?? 0}</span>
      </div>
      <div class="sky__mid">
        {clock}
        {v.suddenDeath ? <span class="sky__sd t-caption">{cv.t('hud.sudden_death', 'Sudden death')}</span> : null}
      </div>
      <div class="sky__team sky__team--enemy">
        <span class="sky__kills num" title={cv.t('hud.takedowns', 'Takedowns')}>{theirs?.kills ?? 0}</span>
        <span class="sky__struct num" title={cv.t('score.structures_down', 'Structures down')}>{theirs?.structuresDestroyed ?? 0}<StructGlyph /></span>
        <span class="sky__mark" style={{ color: REL_VAR.enemy }}><SideGlyph team={theirs?.team ?? 1} size={14} /></span>
      </div>
      <ObjectiveChips />
    </header>
  );
}
const StructGlyph = (): JSX.Element => <svg class="sky__sg" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1l3.5 9h-7z" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>;

function ObjectiveChips(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  model.frame.value;
  const objs = model.view.objectives;
  if (!objs.length) return null;
  // one chip per objective unit kind (camps of the same unit share a chip: the soonest one)
  const byUnit = new Map<string, (typeof objs)[number]>();
  for (const o of objs) {
    const cur = byUnit.get(o.unit);
    if (!cur || (cur.alive ? false : o.alive || o.respawnIn < cur.respawnIn)) byUnit.set(o.unit, o);
  }
  return (
    <div class="sky__objs" aria-label={cv.t('hud.objectives', 'Objectives')}>
      {[...byUnit.values()].map((o) => {
        const name = model.unit(o.unit)?.name ?? o.unit;
        const max = model.unit(o.unit) ? (cv.map(model.client.setup.map)?.camps.find((c) => c.units.some((u) => u.unit === o.unit))?.respawn ?? 0) : 0;
        const frac = !o.alive && max > 0 ? Math.max(0, Math.min(1, 1 - o.respawnIn / max)) : 1;
        return (
          <span class={`objchip ${o.alive ? 'is-up' : ''}`} title={o.alive ? `${name} · ${cv.t('hud.objective_up', 'Up')}` : `${name} · ${cv.t('hud.objective_returns', 'Returns in {t}', { t: fmtClock(o.respawnIn) })}`}>
            <span class="objchip__ring" style={{ '--f': frac.toFixed(3) } as CSSProperties} />
            <span class="t-caption objchip__name">{name}</span>
            <span class="num objchip__t">{o.alive ? cv.t('hud.objective_up', 'Up') : fmtClock(o.respawnIn)}</span>
          </span>
        );
      })}
    </div>
  );
}

// ── announcer ────────────────────────────────────────────────────────────────────────────────────
export function Announcer(): JSX.Element | null {
  const { cv, state } = useApp();
  const { model } = useHud();
  const b = model.banner.value;
  if (!b || !state.settings.value.access.subtitles) return null;
  return (
    <div class={`announce announce--${b.tone} ${b.major ? 'is-major' : ''}`} key={b.id} role="status" aria-live="polite" aria-label={cv.t('a11y.announcer_region', 'Match announcements')}
      style={{ '--life': `${b.ms}ms` } as CSSProperties}>
      <span class="announce__rule" aria-hidden="true" />
      <span class="t-h1 announce__title">{b.title}</span>
      {b.sub ? <span class="t-body-s announce__sub">{b.sub}</span> : null}
    </div>
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
function KillFeedRow(p: { r: KillRow }): JSX.Element {
  const r = p.r;
  return (
    <li class={`krow plate ${r.mine ? 'is-mine' : ''} krow--${r.kind}`} aria-label={r.text}>
      {r.killer ? <WhoChip w={r.killer} /> : null}
      {r.kind === 'takedown' || r.kind === 'objective' ? (
        <span class="krow__act" aria-hidden="true">
          <svg viewBox="0 0 20 12"><path d="M1 6h13M10 1.5l6 4.5-6 4.5" fill="none" stroke="currentColor" stroke-width="1.6" /></svg>
          {r.assists.length ? <span class="krow__assists">{r.assists.slice(0, 4).map((a) => <WhoDot w={a} />)}</span> : null}
        </span>
      ) : null}
      {r.victim ? <WhoChip w={r.victim} down={r.kind !== 'structure' && r.kind !== 'wipe'} /> : null}
      {r.kind !== 'takedown' ? <span class="krow__text t-caption">{r.text}</span> : null}
    </li>
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
  model.frame.value;
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
            <li class={`hrow ${you ? 'is-you' : ''} ${out ? 'is-out' : ''}`} style={{ '--c': color } as CSSProperties}>
              <span class="hrow__place num">{out ? p.placement : i + 1}</span>
              <span class="hrow__seat" title={`${roman(seat)}`}><SeatGlyph seat={seat} size={colours === 'stamp' && !you ? 15 : 11} color={color} keyline={!you} /></span>
              <span class="hrow__name t-caption">{you ? cv.t('hourboard.you', 'You') : p.name}</span>
              {out ? <span class="hrow__out t-caption">{cv.t('hourboard.out', 'Out')}</span> : (
                <span class="hrow__lives" aria-label={cv.t('fray.lives_n', '{n} lives', { n: p.lives ?? 0 })}>{Array.from({ length: lives }, (_, k) => <i class={k < (p.lives ?? 0) ? 'is-on' : ''} />)}</span>
              )}
              <span class="hrow__score num">{fmtInt(p.score ?? 0)}{p === lead && !out && (p.score ?? 0) > 0 ? <span class="hrow__lead" aria-label={cv.t('hourboard.leader', 'Leading')} /> : null}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
