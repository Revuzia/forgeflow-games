// VALE HUD — panels that open on demand: the scoreboard (hold Tab; team blocks "Your team" over "The
// other team", or the full Hour Board in FRAY; enemy Gleam hidden), the death recap (opens 1.2 s after
// you fall, left of centre, 360 px; damage taken in the last 15 s grouped by source with a stacked bar
// by damage type, a factual tip line), the end-of-match banner (held over the last frame before the
// shadow-line wipe to the post-game), and the practice tools (practice queue only).

import type { JSX } from 'preact';
import type { DamageLogEntry } from '../../contracts/session.ts';
import type { PlayerView } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Portrait } from '../components/Portrait.tsx';
import { SeatGlyph } from '../components/Glyphs.tsx';
import { roman } from '../components/Seat.tsx';
import { fmtInt, fmtWait } from '../format.ts';
import { REL_VAR, useHud } from './ctx.ts';
import { ItemGlyph, SideGlyph } from './glyphs.tsx';
import { rankFray } from './top.tsx';

// ── scoreboard ───────────────────────────────────────────────────────────────────────────────────
export function Scoreboard(): JSX.Element | null {
  const { cv } = useApp();
  const { model, board } = useHud();
  if (!board.value) return null;
  model.frame.value;
  const v = model.view;
  if (model.ffa) {
    const rows = rankFray(v.players);
    return (
      <section class="score plate plate--raised" aria-label={cv.t('hourboard.title', 'Hour Board')}>
        <header class="score__head"><span class="t-h2">{cv.t('hourboard.title', 'Hour Board')}</span><span class="t-caption muted">{cv.t('hourboard.hint', '')}</span></header>
        <table class="score__table">
          <thead><tr>
            <th>{cv.t('hourboard.col.place', 'Place')}</th><th>{cv.t('hourboard.col.seat', 'Seat')}</th><th class="l">{cv.t('hourboard.col.player', 'Player')}</th>
            <th>{cv.t('score.col.level', 'Lv')}</th><th>{cv.t('hourboard.col.lives', 'Lives')}</th><th>{cv.t('hourboard.col.takedowns', 'Takedowns')}</th>
            <th>{cv.t('score.col.kda', 'T / F / A')}</th><th>{cv.t('score.col.damage', 'Damage')}</th><th class="l">{cv.t('score.col.items', 'Items')}</th>
          </tr></thead>
          <tbody>{rows.map((p, i) => <FrayRow p={p} place={p.placement ?? i + 1} />)}</tbody>
        </table>
      </section>
    );
  }
  const mine = v.players.filter((p) => p.team === model.myTeam);
  const theirs = v.players.filter((p) => p.team !== model.myTeam);
  const tm = v.teams.find((t) => t.team === model.myTeam), tt = v.teams.find((t) => t.team !== model.myTeam);
  const lead = (tm?.gold ?? 0) - (tt?.gold ?? 0);
  return (
    <section class="score plate plate--raised" aria-label={cv.t('score.title', 'Scoreboard')}>
      <header class="score__head">
        <span class="t-h2">{cv.t('score.title', 'Scoreboard')}</span>
        <span class="t-caption muted num">{cv.t('score.gold_lead', 'Gleam lead')} {lead >= 0 ? '+' : '−'}{fmtInt(Math.abs(lead))}</span>
      </header>
      {[{ list: mine, rel: 'ally' as const, team: tm }, { list: theirs, rel: 'enemy' as const, team: tt }].map((blk) => (
        <div class={`score__block score__block--${blk.rel}`}>
          <div class="score__bhead">
            <span style={{ color: REL_VAR[blk.rel] }}><SideGlyph team={blk.team?.team ?? (blk.rel === 'ally' ? model.myTeam : 1 - model.myTeam)} size={14} /></span>
            <span class="t-label">{blk.rel === 'ally' ? cv.t('score.team.ally', 'Your team') : cv.t('score.team.enemy', 'The other team')}</span>
            <span class="t-caption muted num">{cv.t('hud.takedowns', 'Takedowns')} {blk.team?.kills ?? 0} · {cv.t('score.structures_down', 'Structures down')} {blk.team?.structuresDestroyed ?? 0}</span>
          </div>
          <table class="score__table">
            <thead><tr>
              <th class="l">{cv.t('score.col.player', 'Player')}</th><th>{cv.t('score.col.level', 'Lv')}</th><th>{cv.t('score.col.kda', 'T / F / A')}</th>
              <th>{cv.t('score.col.cs', 'Wicks')}</th><th>{cv.t('score.col.gold', 'Gleam')}</th><th>{cv.t('score.col.damage', 'Damage')}</th><th class="l">{cv.t('score.col.items', 'Items')}</th>
            </tr></thead>
            <tbody>{blk.list.map((p) => <TeamRow p={p} enemy={blk.rel === 'enemy'} />)}</tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function PlayerCell(p: { p: PlayerView }): JSX.Element {
  const { cv } = useApp();
  const { model } = useHud();
  const f = cv.fighter(p.p.fighter);
  const role = cv.role(p.p.role);
  return (
    <td class="l score__player">
      <Portrait fighter={f} skin={p.p.skin} size="fill" round class="score__face" />
      <span class="score__names">
        <span class="t-body-s">{p.p.player === model.you ? `${p.p.name}` : p.p.name}{p.p.controller === 'bot' ? <span class="chip chip--bot">{cv.t('score.bot', 'Bot')}</span> : null}</span>
        <span class="t-caption muted">{f?.name}{role ? ` · ${role.name}` : ''}</span>
      </span>
    </td>
  );
}
function Items(p: { p: PlayerView }): JSX.Element {
  const { cv } = useApp();
  return <td class="l"><span class="score__items">{p.p.items.map((id) => <span class="score__item">{id ? <ItemGlyph item={cv.item(id)} src={cv.asset(cv.item(id)?.icon)} /> : null}</span>)}</span></td>;
}
function TeamRow(p: { p: PlayerView; enemy: boolean }): JSX.Element {
  const { model } = useHud();
  const e = model.view.entity(p.p.entity);
  const dead = !e || !e.alive;
  const you = p.p.player === model.you;
  return (
    <tr class={`${you ? 'is-you' : ''} ${dead ? 'is-dead' : ''} ${p.enemy ? 'is-enemy' : 'is-ally'}`}>
      <PlayerCell p={p.p} />
      <td class="num">{e?.level ?? '—'}</td>
      <td class="num">{p.p.kills} / {p.p.deaths} / {p.p.assists}</td>
      <td class="num">{fmtInt(p.p.cs)}</td>
      <td class="num">{p.enemy ? '—' : fmtInt(p.p.gold)}</td>
      <td class="num">{fmtInt(p.p.damageToFighters)}</td>
      <Items p={p.p} />
      {dead && p.p.respawnIn > 0 ? <td class="num score__down">{Math.ceil(p.p.respawnIn)}</td> : <td />}
    </tr>
  );
}
function FrayRow(p: { p: PlayerView; place: number }): JSX.Element {
  const { cv, state } = useApp();
  const { model, client } = useHud();
  const e = model.view.entity(p.p.entity);
  const you = p.p.player === model.you;
  const seat = (p.p.colorIndex % 10) + 1;
  const q = cv.queue(client.setup.queue);
  const lives = (q ? cv.rulesOf(q) : undefined)?.end.lives ?? 0;
  const color = you ? 'var(--team-self)' : state.frayColors.value === 'simple' ? 'var(--team-enemy)' : `var(--seat-${seat})`;
  return (
    <tr class={`${you ? 'is-you' : ''} ${p.p.placement !== undefined ? 'is-dead' : ''}`} style={{ '--c': color } as JSX.CSSProperties}>
      <td class="num">{p.place}</td>
      <td><span class="score__seat"><SeatGlyph seat={seat} size={14} color={color} keyline={!you} /><span class="num t-caption">{roman(seat)}</span></span></td>
      <PlayerCell p={p.p} />
      <td class="num">{e?.level ?? '—'}</td>
      <td><span class="hrow__lives">{Array.from({ length: lives }, (_, k) => <i class={k < (p.p.lives ?? 0) ? 'is-on' : ''} />)}</span></td>
      <td class="num">{fmtInt(p.p.score ?? 0)}</td>
      <td class="num">{p.p.kills} / {p.p.deaths} / {p.p.assists}</td>
      <td class="num">{fmtInt(p.p.damageToFighters)}</td>
      <Items p={p.p} />
    </tr>
  );
}

// ── death recap ──────────────────────────────────────────────────────────────────────────────────
interface Source { key: string; name: string; def: string; total: number; byType: Record<'phys' | 'magic' | 'true', number>; abilities: Map<string, number>; last: number }

export function DeathRecap(): JSX.Element | null {
  const { cv } = useApp();
  const { model, index } = useHud();
  const rc = model.recap.value;
  model.frame.value;
  if (!rc || !rc.open) return null;
  const me = model.me;
  const deathAt = rc.log.length ? rc.log[rc.log.length - 1].t : 0;
  const sources = groupLog(rc.log);
  const total = sources.reduce((s, x) => s + x.total, 0);
  const types = { phys: 0, magic: 0, true: 0 };
  for (const s of sources) { types.phys += s.byType.phys; types.magic += s.byType.magic; types.true += s.byType.true; }
  const tipKey = total <= 0 ? null : types.true / total >= 0.3 ? 'recap.tip.pierce' : types.phys / total >= 0.65 ? 'recap.tip.phys' : types.magic / total >= 0.65 ? 'recap.tip.magic' : 'recap.tip.mixed';
  const span = rc.log.length ? rc.log[rc.log.length - 1].t - rc.log[0].t : 99;
  const killerF = cv.fighter(rc.killerDef);
  const close = (): void => { model.recap.value = null; };
  return (
    <section class="recap plate plate--raised" aria-label={cv.t('recap.title', 'Death recap')}>
      <header class="recap__head">
        <span class="recap__face">{killerF ? <Portrait fighter={killerF} size="fill" round /> : <span class="recap__unit" />}</span>
        <span class="recap__titles">
          <span class="t-caption muted">{cv.t('recap.title', 'Death recap')}</span>
          <span class="t-h2">{rc.killerName ? (rc.structure ? cv.t('recap.fell_to', 'Fell to {name}', { name: rc.killerName }) : cv.t('recap.taken_down_by', 'Taken down by {name}', { name: rc.killerName })) : cv.t('hud.dead.title', 'Down')}</span>
          {me && me.respawnIn > 0 ? <span class="t-caption num">{cv.t('recap.respawn', 'Back in {t}', { t: fmtWait(Math.ceil(me.respawnIn)) })}</span> : null}
        </span>
        <button type="button" class="hbtn hbtn--icon" aria-label={cv.t('recap.close', 'Close')} onClick={close}><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
      </header>
      {sources.length ? (
        <>
          <p class="t-caption muted">{cv.t('recap.window', 'Damage taken in the last 15 s')}</p>
          <ol class="recap__rows">
            {sources.map((s) => {
              const f = cv.fighter(s.def);
              const abil = [...s.abilities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([id]) => (id ? index.get(id)?.name ?? id : cv.t('recap.basic', 'Basic attack')));
              return (
                <li class="rrow">
                  <span class="rrow__face">{f ? <Portrait fighter={f} size="fill" round /> : <span class="recap__unit" />}</span>
                  <span class="rrow__body">
                    <span class="rrow__line"><span class="t-body-s">{s.name}</span><span class="num t-body-s rrow__total">{fmtInt(s.total)}</span></span>
                    <span class="rrow__bar" aria-hidden="true">
                      {(['phys', 'magic', 'true'] as const).map((t) => s.byType[t] > 0 ? <i class={`rrow__seg rrow__seg--${t}`} style={{ flexGrow: s.byType[t] }} title={cv.t(`dmg.${t}`, t)} /> : null)}
                    </span>
                    <span class="t-caption muted">{abil.join(' · ')} · {cv.t('recap.ago', '{t} before', { t: `${Math.max(0, deathAt - s.last).toFixed(1)} s` })}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <footer class="recap__foot">
            <span class="t-label num">{cv.t('recap.total', 'Total {n}', { n: fmtInt(total) })}</span>
            <span class="recap__types">
              {(['phys', 'magic', 'true'] as const).map((t) => types[t] > 0 ? <span class={`dchip dchip--${t} num t-caption`} title={cv.t(`dmg.${t}_tip`, '')}>{cv.t(`dmg.${t}`, t)} {fmtInt(types[t])}</span> : null)}
            </span>
            {tipKey ? <p class="t-body-s recap__tip">{cv.t(tipKey, '')}{span <= 2 ? ` ${cv.t('recap.tip.burst', 'It all landed inside {t}.', { t: `${Math.max(0.1, span).toFixed(1)} s` })}` : ''}</p> : null}
          </footer>
        </>
      ) : <p class="t-body-s muted">{cv.t('recap.none', 'No damage was recorded.')}</p>}
    </section>
  );
}

function groupLog(log: readonly DamageLogEntry[]): Source[] {
  const m = new Map<string, Source>();
  for (const l of log) {
    const key = `${l.srcName}|${l.srcDef}`;
    let s = m.get(key);
    if (!s) { s = { key, name: l.srcName, def: l.srcDef, total: 0, byType: { phys: 0, magic: 0, true: 0 }, abilities: new Map(), last: l.t }; m.set(key, s); }
    s.total += l.amount;
    s.byType[l.dtype] += l.amount;
    s.abilities.set(l.ability ?? '', (s.abilities.get(l.ability ?? '') ?? 0) + l.amount);
    s.last = Math.max(s.last, l.t);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

// ── the end of the match ─────────────────────────────────────────────────────────────────────────
export function EndBanner(): JSX.Element | null {
  const { cv } = useApp();
  const { model } = useHud();
  const res = model.ended.value;
  if (!res) return null;
  const me = res.players.find((p) => p.player === model.you);
  const ffa = model.ffa;
  const won = !!me?.won;
  const title = ffa && me ? cv.t('fray.place_of', '{ord} of {total}', { ord: cv.ordinal(me.placement), total: res.players.length })
    : won ? cv.t('announce.victory.title', 'Victory') : cv.t('announce.defeat.title', 'Defeat');
  return (
    <div class={`endban ${won ? 'is-won' : 'is-lost'} ${ffa ? 'is-ffa' : ''}`} role="status" aria-live="assertive">
      <div class="endban__band" aria-hidden="true" />
      <span class="endban__wedge" aria-hidden="true" />
      <span class="t-display-l endban__title">{title}</span>
      <span class="t-body endban__sub">{cv.t(`postgame.reason.${res.reason}`, '')}</span>
    </div>
  );
}

// ── practice tools ───────────────────────────────────────────────────────────────────────────────
const SPEEDS = [0, 1, 2, 4, 8, 16];
export function PracticePanel(): JSX.Element | null {
  const { cv } = useApp();
  const { client, model } = useHud();
  model.frame.value;
  if (cv.queue(client.setup.queue)?.kind !== 'practice') return null;
  const act = (action: 'gold' | 'level' | 'resetCooldowns' | 'toggleCooldowns' | 'spawnDummy' | 'heal' | 'resetMatch'): void => client.send({ type: 'practice', action });
  const scale = client.timeScale;
  return (
    <section class="ptools plate" aria-label={cv.t('practice.panel.title', 'Practice tools')}>
      <span class="t-label">{cv.t('practice.panel.title', 'Practice tools')}</span>
      <div class="ptools__grid">
        <button type="button" class="hbtn" onClick={() => act('gold')}>{cv.t('practice.panel.gold', 'Add 5,000 Gleam')}</button>
        <button type="button" class="hbtn" onClick={() => act('level')}>{cv.t('practice.panel.level', 'Level up')}</button>
        <button type="button" class="hbtn" onClick={() => act('resetCooldowns')}>{cv.t('practice.panel.reset_cooldowns', 'Refresh cooldowns')}</button>
        <button type="button" class="hbtn" onClick={() => act('toggleCooldowns')}>{cv.t('practice.panel.toggle_cooldowns', 'No cooldowns')}</button>
        <button type="button" class="hbtn" onClick={() => act('spawnDummy')}>{cv.t('practice.panel.spawn_dummy', 'Place a training target')}</button>
        <button type="button" class="hbtn" onClick={() => act('heal')}>{cv.t('practice.panel.heal', 'Return to life')}</button>
        <button type="button" class="hbtn" onClick={() => act('resetMatch')}>{cv.t('practice.panel.reset_match', 'Reset match')}</button>
      </div>
      <div class="ptools__speed" role="radiogroup" aria-label={cv.t('practice.panel.speed', 'Speed')}>
        <span class="t-caption muted">{cv.t('practice.panel.speed', 'Speed')}</span>
        {SPEEDS.map((s) => (
          <button type="button" role="radio" aria-checked={Math.abs(scale - s) < 0.01} class={`hbtn hbtn--s ${Math.abs(scale - s) < 0.01 ? 'is-on' : ''}`} onClick={() => client.setTimeScale(s)}>
            {s === 0 ? cv.t('practice.panel.paused', 'Paused') : cv.t('practice.panel.speed_x', '×{n}', { n: s })}
          </button>
        ))}
      </div>
    </section>
  );
}
