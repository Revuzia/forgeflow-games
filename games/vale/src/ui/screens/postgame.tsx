// VALE UI — Post-game (client_hud §3.8). The banner in Gloock — the only Display XL in the client:
// VICTORY / DEFEAT (one-word results in caps) or the FRAY placement ("2nd of 10"), the mode sub-line,
// the reason and length. Rewards: one ledger row per GrantSummary line (grant.<label>), Candles tick up
// over 1,200 ms, the total, the account level bar; ranked adds the rating change and the tier emblem.
// Tabs: Summary · Scoreboard · Gleam lead (the per-minute graph, from your side). Defeat is dignified:
// same plate, no red. CTA Play again (disabled with the reason during a lockout); Choose another mode
// and Return home beside it.

import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GrantSummary } from '../../contracts/session.ts';
import type { MatchResult, PlayerResult } from '../../contracts/sim.ts';
import { useApp } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { Currency } from '../components/Currency.tsx';
import { Icon } from '../components/Glyphs.tsx';
import { AssetImg, Portrait } from '../components/Portrait.tsx';
import { RankEmblem } from '../components/RankEmblem.tsx';
import { Screen } from '../components/Screen.tsx';
import { roman, SeatMark, seatOf, SideMark } from '../components/Seat.tsx';
import { EmptyState } from '../components/States.tsx';
import { Tabs } from '../components/Tabs.tsx';
import { TipText, useTip } from '../components/Tooltip.tsx';
import { fmtClock, fmtInt, fmtWait } from '../format.ts';
import { animateIn, dur, tween } from '../motion.ts';
import { TOKENS } from '../tokens.ts';

const xpToNext = (level: number): number => 100 + 25 * (level - 1);   // CONTRACT §7 grants

export function PostgameScreen(p: { params: Record<string, string> }): JSX.Element {
  const { cv, state, router, sound } = useApp();
  const pg = state.postgame.value;
  const tab = p.params.tab ?? 'summary';
  const res = pg?.result;
  const me = res?.players.find((x) => x.player === pg!.you);
  const mode = cv.mode(res?.mode);
  const ffa = cv.isFfa(mode);
  if (!pg || !res || !me) {
    return (
      <Screen title={cv.t('postgame.title', 'Match summary')}>
        <EmptyState text={cv.t('state.empty.history', 'No matches yet. Play one and it will be kept here.')} action={{ label: cv.t('btn.return_home', 'Return home'), run: () => router.reset('home', {}, 'back') }} />
      </Screen>
    );
  }
  const queue = cv.queue(res.queue);
  const lock = state.lockoutLeft.value;
  const reason = lock > 0 ? cv.t('postgame.queue_again_locked', 'You can queue again in {t}.', { t: fmtWait(lock) }) : null;
  const title = ffa ? cv.t('fray.place_of', '{ord} of {total}', { ord: cv.ordinal(me.placement), total: res.players.length })
    : me.won ? cv.t('postgame.victory.title', 'Victory') : cv.t('postgame.defeat.title', 'Defeat');
  const sub = ffa ? cv.t(`postgame.fray.sub.${me.placement}`, '')
    : cv.t(`postgame.${me.won ? 'victory' : 'defeat'}.sub.${res.mode}`, cv.t(`postgame.${me.won ? 'victory' : 'defeat'}.sub.generic`, ''));
  return (
    <Screen layout="wide"
      foot={<div class="row">
        <Button variant="secondary" onPress={() => router.reset('play', {}, 'back')}>{cv.t('postgame.next.change_mode', 'Choose another mode')}</Button>
        <Button variant="quiet" cue="back" onPress={() => router.reset('home', {}, 'back')}>{cv.t('postgame.next.home', 'Return home')}</Button>
        {reason ? <span class="reason reason--warn t-body-s">{reason}</span> : null}
      </div>}
      cta={<Button variant="chalk" size="l" wedge disabled={!!reason} reason={reason ?? undefined} onPress={() => state.playAgain()} data-autofocus="">{cv.t('btn.play_again', 'Play again')}</Button>}>
      <div class="pg">
        <header class={`pg__banner ${ffa ? 'is-place' : me.won ? 'is-win' : 'is-loss'}`}>
          <span class="t-label muted pg__queue">{cv.t('postgame.queue_line', '{mode} · {queue}', { mode: mode?.name ?? '', queue: queue?.name ?? '' })}</span>
          <Banner text={title} caps={!ffa} />
          {sub ? <p class="t-body-l pg__sub">{sub}</p> : null}
          <p class="t-body-s muted pg__reason">{cv.t(`postgame.reason.${res.reason}`, res.reason)} · {cv.t('postgame.duration', '{t} played', { t: fmtClock(res.duration) })}</p>
        </header>
        <Tabs label={cv.t('postgame.title', 'Match summary')} value={tab} onChange={(id) => router.setParams({ tab: id })} items={[
          { id: 'summary', label: cv.t('postgame.tab.summary', 'Summary') },
          { id: 'scoreboard', label: ffa ? cv.t('hourboard.title', 'Hour Board') : cv.t('postgame.tab.scoreboard', 'Scoreboard') },
          { id: 'graph', label: cv.t('postgame.tab.graph', 'Gleam lead'), disabled: res.goldGraph.length < 2 ? cv.t('postgame.graph.empty', 'The match ended too soon to chart the Gleam lead.') : undefined },
        ]} />
        <div class="pg__body">
          {tab === 'summary' ? <Summary res={res} grants={pg.grants} me={me} /> : null}
          {tab === 'scoreboard' ? <Scoreboard res={res} me={me} ffa={ffa} /> : null}
          {tab === 'graph' ? <GoldGraph res={res} me={me} ffa={ffa} /> : null}
        </div>
      </div>
    </Screen>
  );
}

function Banner(p: { text: string; caps: boolean }): JSX.Element {
  const el = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    if (!el.current?.animate) return;
    el.current.animate([{ opacity: 0, transform: 'translateY(16px)', letterSpacing: '0.12em' }, { opacity: 1, transform: 'none', letterSpacing: '0.02em' }],
      { duration: dur('reward'), easing: TOKENS.motion.ease.dawn, fill: 'backwards' });
  }, []);
  return <h1 ref={el} class={`t-display-xl pg__title ${p.caps ? 'is-caps' : ''}`}>{p.text}</h1>;
}

// ── summary: rewards, level, rating, your match ────────────────────────────────────────────────
function Summary(p: { res: MatchResult; grants: GrantSummary; me: PlayerResult }): JSX.Element {
  const { cv, state, sound } = useApp();
  const g = p.grants;
  const profile = state.profile.value;
  const [shown, setShown] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { sound.play('reward_reveal'); animateIn(panel.current, { from: 'below', dist: 'panel', d: 'panel', delay: 240 }); }, []);
  // rows reveal one by one, then their amounts tick up
  useEffect(() => {
    if (shown >= g.lines.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 480 : 260);
    return () => clearTimeout(t);
  }, [shown]);
  const none = g.lines.find((l) => l.label === 'no_rewards' || l.label === 'left_match');
  const totals = new Map<string, number>();
  for (const l of g.lines) if (l.currency) totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amount);
  const leveled = g.levelAfter > g.levelBefore;
  const rated = g.ratingBefore !== undefined && g.ratingAfter !== undefined;
  const q = cv.queue(p.res.queue);
  const rec = q?.ranked ? profile.ratings[q.ranked.ratingId] : undefined;
  const me = p.me;
  return (
    <div class="pgsum">
      <section ref={panel} class="pgsum__rewards plate pad-l" aria-label={cv.t('postgame.rewards.title', 'Rewards')}>
        <h2 class="t-h2">{cv.t('postgame.rewards.title', 'Rewards')}</h2>
        {none || g.lines.length === 0 ? (
          <p class="t-body muted">{none?.label === 'left_match' ? cv.t('postgame.rewards.left', 'You left the match early, so no rewards were given.')
            : none ? cv.t('postgame.rewards.practice', 'No rewards are given in practice or custom games.') : cv.t('postgame.rewards.none', 'No rewards this time.')}</p>
        ) : (
          <ul class="ledger">
            {g.lines.map((l, i) => (
              <li class={`ledger__row ${i < shown ? 'is-in' : ''}`}>
                <span class="t-body">{cv.t(`grant.${l.label}`, l.label)}</span>
                {l.currency ? <Currency id={l.currency} amount={i < shown ? l.amount : 0} signed /> : <span class="num ledger__xp">{i < shown ? `+${fmtInt(l.amount)}` : '+0'} XP</span>}
              </li>
            ))}
            {[...totals].map(([cur, n]) => (
              <li class="ledger__row ledger__row--total is-in">
                <span class="t-label">{cv.t('postgame.rewards.total', 'Total')}</span>
                <Currency id={cur} amount={shown >= g.lines.length ? n : 0} size="l" />
              </li>
            ))}
          </ul>
        )}
        <LevelBar g={g} />
        {leveled ? <p class="pg__levelup t-h2" role="status"><Icon name="plus" size={16} />{cv.t('postgame.level.reached', 'You reached level {n}.', { n: g.levelAfter })}</p> : null}
        <p class="t-caption quiet">{cv.t('postgame.rewards.saved', 'Rewards are saved to this browser.')}</p>
      </section>
      <div class="pgsum__side">
        {q?.ranked ? (
          <section class="plate pad-l pgsum__rating" aria-label={cv.t('postgame.rating.title', 'Rating')}>
            <h2 class="t-h2">{cv.t('postgame.rating.title', 'Rating')}</h2>
            <div class="row row--nowrap">
              <RankEmblem tier={cv.c.ranks.find((r) => r.id === g.tierAfter)} provisional={!g.tierAfter} size={88} art />
              <div class="stack stack--s">
                {rated ? <span class="t-body">{cv.t('postgame.rating.change', 'Rating {before} to {after}', { before: fmtInt(g.ratingBefore!), after: fmtInt(g.ratingAfter!) })}</span> : null}
                {rated ? <span class={`num t-num-clock ${g.ratingAfter! >= g.ratingBefore! ? 'is-up' : 'is-down'}`}>
                  {g.ratingAfter! >= g.ratingBefore! ? cv.t('postgame.rating.up', '+{n}', { n: fmtInt(g.ratingAfter! - g.ratingBefore!) }) : cv.t('postgame.rating.down', '−{n}', { n: fmtInt(g.ratingBefore! - g.ratingAfter!) })}</span> : null}
                <span class="t-body-s muted">{!g.tierAfter && rec ? cv.t('postgame.rating.placing', 'Placement match {n} of {m}', { n: rec.games, m: q.ranked.placementGames })
                  : g.tierAfter && !g.tierBefore ? cv.t('postgame.rating.placed', 'You are placed. Your tier is {tier}.', { tier: cv.c.ranks.find((r) => r.id === g.tierAfter)?.name ?? '' })
                    : g.tierAfter && g.tierBefore !== g.tierAfter ? cv.t(cv.c.ranks.findIndex((r) => r.id === g.tierAfter) > cv.c.ranks.findIndex((r) => r.id === g.tierBefore) ? 'postgame.rating.tier_up' : 'postgame.rating.tier_down', 'You are now {tier}.', { tier: cv.c.ranks.find((r) => r.id === g.tierAfter)?.name ?? '' })
                      : g.tierAfter ? cv.t('postgame.rating.tier_kept', 'You are still {tier}.', { tier: cv.c.ranks.find((r) => r.id === g.tierAfter)?.name ?? '' }) : ''}</span>
              </div>
            </div>
          </section>
        ) : null}
        <section class="plate pad-l pgsum__you" aria-label={cv.t('postgame.stats.title', 'Your match')}>
          <h2 class="t-h2">{cv.t('postgame.stats.title', 'Your match')}</h2>
          <div class="row row--nowrap">
            <Portrait fighter={cv.fighter(me.fighter)} skin={me.skin} size="m" />
            <div class="stack stack--s"><span class="t-h2">{cv.fighter(me.fighter)?.name}</span><span class="t-caption muted">{cv.t('common.level', 'Level {n}', { n: me.level })}</span></div>
          </div>
          <dl class="stats">
            <div><dt class="t-caption">{cv.t('score.col.kda', 'T / F / A')}</dt><dd class="num">{me.kills} / {me.deaths} / {me.assists}</dd></div>
            <div><dt class="t-caption">{cv.t('score.col.cs', 'Wicks')}</dt><dd class="num">{fmtInt(me.cs)}</dd></div>
            <div><dt class="t-caption">{cv.t('score.col.gold', 'Gleam')}</dt><dd class="num">{fmtInt(me.gold)}</dd></div>
            <div><dt class="t-caption">{cv.t('score.col.damage', 'Damage')}</dt><dd class="num">{fmtInt(me.damageToFighters)}</dd></div>
            <div><dt class="t-caption">{cv.t('score.col.taken', 'Taken')}</dt><dd class="num">{fmtInt(me.damageTaken)}</dd></div>
            <div><dt class="t-caption">{cv.t('score.col.healing', 'Healing')}</dt><dd class="num">{fmtInt(me.healing)}</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function LevelBar(p: { g: GrantSummary }): JSX.Element {
  const { cv, state, sound } = useApp();
  const profile = state.profile.value;
  const g = p.g;
  const leveled = g.levelAfter > g.levelBefore;
  const after = profile.xp / xpToNext(profile.level);
  const before = leveled ? 0 : Math.max(0, (profile.xp - g.xp) / xpToNext(profile.level));
  const [v, setV] = useState(before);
  useEffect(() => tween(before, after, dur('reward'), (x, done) => { setV(x); if (done && leveled) sound.play('level_account'); }, 700), []);
  return (
    <div class="levelbar">
      <div class="row row--nowrap levelbar__head">
        <span class="t-label">{leveled ? cv.t('postgame.level.range', 'Level {a} to level {b}', { a: g.levelBefore, b: g.levelAfter }) : cv.t('postgame.level.up', 'Level {n}', { n: profile.level })}</span>
        <span class="fig t-caption muted">{cv.t('postgame.level.progress', '{xp} / {next} XP', { xp: fmtInt(profile.xp), next: fmtInt(xpToNext(profile.level)) })}</span>
      </div>
      <div class={`bar-line bar-line--gloam ${leveled ? 'is-up' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(after * 100)}>
        <span class="bar-line__fill" style={{ width: `${(v * 100).toFixed(2)}%`, transition: 'none' }} />
      </div>
    </div>
  );
}

// ── scoreboard (team blocks, or the Hour Board in FRAY) ────────────────────────────────────────
// A real table: every cell stays a table cell (the row class is the post-game's own `pgrow`, never the
// HUD's flex `.srow`), so each header sits over its column. The player cell holds an inner flex box;
// items are the painted item icons; the best value of the match carries a noon tick with its tooltip.
type Col = { key: string; label: string; get: (r: PlayerResult) => number; fmt?: (n: number) => string };

function Scoreboard(p: { res: MatchResult; me: PlayerResult; ffa: boolean }): JSX.Element {
  const { cv } = useApp();
  const cols: Col[] = [
    { key: 'level', label: cv.t('score.col.level', 'Lv'), get: (r) => r.level },
    { key: 'kda', label: cv.t('score.col.kda', 'T / F / A'), get: (r) => r.kills },
    { key: 'cs', label: cv.t('score.col.cs', 'Wicks'), get: (r) => r.cs, fmt: fmtInt },
    { key: 'gold', label: cv.t('score.col.gold', 'Gleam'), get: (r) => r.gold, fmt: fmtInt },
    { key: 'damage', label: cv.t('score.col.damage', 'Damage'), get: (r) => r.damageToFighters, fmt: fmtInt },
    { key: 'healing', label: cv.t('score.col.healing', 'Healing'), get: (r) => r.healing, fmt: fmtInt },
    { key: 'structures', label: cv.t('score.col.structures', 'Structures'), get: (r) => r.structureDamage, fmt: fmtInt },
  ];
  const best = new Map(cols.map((c) => [c.key, Math.max(...p.res.players.map(c.get))]));
  const blocks: { title: string; team?: number; rows: PlayerResult[]; won?: boolean }[] = p.ffa
    ? [{ title: cv.t('hourboard.title', 'Hour Board'), rows: [...p.res.players].sort((a, b) => a.placement - b.placement) }]
    : [p.me.team, ...new Set(p.res.players.map((r) => r.team).filter((t) => t !== p.me.team))].map((t) => ({
      title: t === p.me.team ? cv.t('score.team.ally', 'Your team') : cv.t('score.team.enemy', 'The other team'), team: t,
      rows: p.res.players.filter((r) => r.team === t), won: p.res.winningTeam === t,
    }));
  return (
    <div class="score">
      {blocks.map((b) => (
        <table class={`score__table plate ${p.ffa ? 'score__table--ffa' : ''}`}>
          <caption class="score__cap t-label"><span class="score__capin">
            {b.team !== undefined ? <SideMark team={b.team} withName /> : null}
            {b.title}
            {b.won !== undefined ? <span class="chip chip--line">{b.won ? cv.t('score.team.winner', 'Winners') : cv.t('score.team.loser', 'Defeated')}</span> : null}
          </span></caption>
          <colgroup>
            {p.ffa ? <col class="score__c-place" /> : null}
            <col class="score__c-player" />
            {cols.map((c) => <col class={`score__c-num score__c-${c.key}`} />)}
            <col class="score__c-items" />
          </colgroup>
          <thead>
            <tr>
              {p.ffa ? <th class="t-caption score__place" scope="col">{cv.t('score.col.place', 'Place')}</th> : null}
              <th class="t-caption score__player" scope="col">{cv.t('score.col.player', 'Player')}</th>
              {cols.map((c) => <th class="t-caption num score__num" scope="col">{c.label}</th>)}
              <th class="t-caption score__items" scope="col">{cv.t('score.col.items', 'Items')}</th>
            </tr>
          </thead>
          <tbody>
            {b.rows.map((r) => {
              const f = cv.fighter(r.fighter);
              const you = r.player === p.me.player;
              const rel = you ? 'self' : p.ffa ? 'enemy' : r.team === p.me.team ? 'ally' : 'enemy';
              return (
                <tr class={`pgrow pgrow--${rel}`}>
                  {p.ffa ? <td class="num pgrow__place">{cv.ordinal(r.placement)}</td> : null}
                  <td class="pgrow__player">
                    <div class="pgrow__who">
                      <Portrait fighter={f} skin={r.skin} size="xs" round={rel === 'ally'} />
                      {p.ffa ? <SeatMark seat={seatOf(r.player)} you={you} size={14} showNumeral={false} /> : null}
                      <span class="pgrow__names"><span class="t-body-s">{you ? cv.t('score.you', 'You') : r.name}{r.controller === 'bot' ? <span class="chip chip--bot">{cv.t('score.bot', 'Bot')}</span> : null}</span>
                        <span class="t-caption muted">{f?.name}{r.role ? ` · ${cv.role(r.role)?.name ?? ''}` : ''}{p.ffa ? ` · ${roman(seatOf(r.player))}` : ''}</span></span>
                    </div>
                  </td>
                  {cols.map((c) => {
                    const v = c.get(r);
                    const text = c.key === 'kda' ? `${r.kills} / ${r.deaths} / ${r.assists}` : (c.fmt ?? String)(v);
                    return <td class="num pgrow__num">{v > 0 && v === best.get(c.key) ? <BestValue text={text} /> : text}</td>;
                  })}
                  <td class="pgrow__items"><span class="pgrow__itemrow">{Array.from({ length: 6 }, (_, i) => <ItemCell id={r.items[i] ?? null} />)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
    </div>
  );
}

/** the match's best value in a column: brighter, with a noon tick over it and its tooltip */
function BestValue(p: { text: string }): JSX.Element {
  const { cv } = useApp();
  const label = cv.t('postgame.stats.best', 'Best in the match');
  const tip = useTip(() => <TipText text={label} />, { place: 'above' });
  return <span class="bestv" {...tip} tabIndex={0} aria-label={`${p.text}. ${label}`}><i class="bestv__tick" aria-hidden="true" />{p.text}</span>;
}

/** one item slot: the painted item icon (its name on hover and focus); an empty slot is a quiet well */
function ItemCell(p: { id: string | null }): JSX.Element {
  const { cv } = useApp();
  const it = cv.item(p.id);
  const tip = useTip(it ? () => <TipText text={it.name} /> : null, { place: 'above' });
  if (!it) return <span class="itemslot" aria-hidden="true" />;
  return (
    <span class="itemslot is-full" {...tip} tabIndex={0} role="img" aria-label={it.name}>
      <AssetImg src={cv.asset(it.icon)} alt="" fallback={<span class="itemslot__fb" aria-hidden="true" />} />
    </span>
  );
}

// ── the Gleam lead graph (above the line, your team led) ───────────────────────────────────────
function GoldGraph(p: { res: MatchResult; me: PlayerResult; ffa: boolean }): JSX.Element {
  const { cv } = useApp();
  const sign = !p.ffa && p.me.team === 1 ? -1 : 1;
  const pts = p.res.goldGraph.map((v) => v * sign);
  if (pts.length < 2) return <EmptyState text={cv.t('state.empty.recap', 'No damage was recorded.')} />;
  const W = 1000, H = 320, PAD = 36;
  const max = Math.max(1000, ...pts.map(Math.abs));
  const x = (i: number): number => PAD + (i / (pts.length - 1)) * (W - PAD * 2);
  const y = (v: number): number => H / 2 - (v / max) * (H / 2 - PAD);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1)} ${H / 2} L${x(0)} ${H / 2} Z`;
  const step = pts.length > 30 ? 10 : 5;
  return (
    <figure class="graph plate pad-l">
      <figcaption class="row"><span class="t-h2">{cv.t('postgame.graph.title', 'Gleam lead by minute')}</span><span class="t-body-s muted">{cv.t('postgame.graph.hint', 'Above the line, your team was ahead.')}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} class="graph__svg" role="img" aria-label={cv.t('postgame.graph.title', 'Gleam lead by minute')}>
        <defs>
          <clipPath id="g-up"><rect x="0" y="0" width={W} height={H / 2} /></clipPath>
          <clipPath id="g-dn"><rect x="0" y={H / 2} width={W} height={H / 2} /></clipPath>
        </defs>
        {[-1, -0.5, 0.5, 1].map((k) => <line x1={PAD} x2={W - PAD} y1={y(k * max)} y2={y(k * max)} class="graph__grid" />)}
        <path d={area} class="graph__area graph__area--up" clip-path="url(#g-up)" />
        <path d={area} class="graph__area graph__area--dn" clip-path="url(#g-dn)" />
        <line x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} class="graph__zero" />
        <path d={line} class="graph__line" />
        {pts.map((_, i) => (i % step === 0 ? <text x={x(i)} y={H - 8} class="graph__lab" text-anchor="middle">{i}</text> : null))}
        <text x={PAD - 6} y={y(max) + 4} class="graph__lab" text-anchor="end">+{fmtInt(max)}</text>
        <text x={PAD - 6} y={y(-max) + 4} class="graph__lab" text-anchor="end">−{fmtInt(max)}</text>
      </svg>
      <span class="t-caption muted">{cv.t('postgame.graph.axis_min', 'Minute')}</span>
    </figure>
  );
}
