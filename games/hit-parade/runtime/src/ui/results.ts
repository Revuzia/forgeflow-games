// HIT PARADE - RESULTS (lane UI; CONTRACT section 8 "results (winner quote, stats)", 16 Menus.showResults, 18.3 MatchResult,
// 27.3 / 27.4 CHANGED(UI) P2).
//
// Left: the winner's portrait, name, how it ended (BY KNOCKOUT / BY DECISION / BY FORFEIT / OPPONENT LEFT) and a win
// quote (the fighter file's winQuotes, seeded by the match seed - CONTRACT 26.3). An online disconnect / forfeit win
// leads with the DISCONNECT card. Right: ROUND BY ROUND (winner, how, time, damage and best combo per side for every
// round: MatchResult.rounds merged with the Hud's own per-round log of the same bout, ui/tally.ts) and THE TAPE - rounds
// won, health left and time on air straight from MatchResult (game.ts builds it from sim snapshots only), plus
// MatchResult.stats (counted from the sim's own events): damage, best combo, counters, punish counters, perfect parries,
// throws, supers, wall splats; the better value per row is marked. SEASON bouts add the episode score (+ NEW BEST).
// BRAWL BREAK / HECKLER TOSS (mode brawl / heckler) show the bonus panel instead: the score, the ratings it adds, a
// grade (ui/season.ts bonusGrade) and the round's tallies.
// Choices by mode:
//   versus / training : REMATCH, CHARACTER SELECT, MAIN MENU
//   online            : REMATCH, MAIN MENU
//   arcade win        : NEXT EPISODE (-> 'next'), MAIN MENU
//   arcade loss       : the CONTINUE screen - a 10 s countdown; CONTINUE (-> 'rematch' = continue the same episode, its
//                       ratings reset) / END THE SEASON (-> 'menu'); the countdown running out = END THE SEASON
//   brawl / heckler   : NEXT EPISODE (-> 'next')

import type { MatchResult, MatchStats, RoundLog, UiGameData } from './types.ts';
import { btn, div, el, setText } from './dom.ts';
import { colorsOf, fighter, fighterName, fillPortrait } from './data.ts';
import { t } from './strings.ts';
import { bonusGrade, winQuote as seasonQuote } from './season.ts';
import { boutLogFor } from './tally.ts';

export type ResultChoice = 'rematch' | 'charselect' | 'menu' | 'next';
const STATS: ReadonlyArray<readonly [keyof MatchStats, string]> = [
  ['damage', 'res.stat.damage'], ['maxCombo', 'res.stat.maxCombo'], ['counters', 'res.stat.counters'], ['punishes', 'res.stat.punishes'],
  ['perfectParries', 'res.stat.parries'], ['throws', 'res.stat.throws'], ['supers', 'res.stat.supers'], ['wallSplats', 'res.stat.splats'],
];
export const CONTINUE_SECONDS = 10;

/** the human player of a one-player mode (the side whose cpu is -1; P1 when both are human) */
export function humanSide(r: MatchResult): 0 | 1 {
  return r.cfg.p[0].cpu < 0 ? 0 : r.cfg.p[1].cpu < 0 ? 1 : 0;
}

export function isContinue(r: MatchResult): boolean {
  return r.cfg.mode === 'arcade' && r.winner !== humanSide(r);
}

export function resultChoices(r: MatchResult): Array<[ResultChoice, string]> {
  const mode = r.cfg.mode;
  // a bonus round outside THE SEASON (deep link / practice) goes back to the menu on the same choice
  if (mode === 'brawl' || mode === 'heckler') return [['next', r.season ? t('res.next') : t('res.menu')]];
  if (mode === 'arcade') return isContinue(r) ? [['rematch', t('res.continue')], ['menu', t('res.giveUp')]] : [['next', t('res.next')], ['menu', t('res.menu')]];
  if (mode === 'online') return [['rematch', t('res.rematch')], ['menu', t('res.menu')]];
  return [['rematch', t('res.rematch')], ['charselect', t('res.charselect')], ['menu', t('res.menu')]];
}

/** kept for callers of the P1 API: a quote for the fighter (unseeded) */
export function winQuote(fid: string, data?: UiGameData): string {
  return data ? seasonQuote(data, fid, Math.floor(Math.random() * 1e6)) : '';
}

export function howItEnded(r: MatchResult): 'ko' | 'time' | 'forfeit' | 'disconnect' | 'draw' {
  if (r.disconnect) return 'disconnect';
  if (r.forfeit === 0 || r.forfeit === 1) return 'forfeit';
  if (r.winner !== 0 && r.winner !== 1) return 'draw';
  const loser = r.fighters[1 - r.winner];
  return loser && loser.hp > 0 ? 'time' : 'ko';
}

const clock = (frames: number): string => {
  const s = Math.max(0, Math.floor(frames / 60));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** MatchResult.rounds (game.ts) merged with the Hud's per-round log of the same bout (winner / how from game.ts win) */
export function roundRows(r: MatchResult): RoundLog[] {
  const hud = boutLogFor(r.cfg)?.rounds ?? [];
  const sim = r.rounds ?? [];
  const n = Math.max(hud.length, sim.length);
  const out: RoundLog[] = [];
  for (let i = 0; i < n; i++) {
    const h = hud[i];
    const s = sim[i];
    out.push({
      round: h?.round ?? i + 1,
      winner: s ? s.winner : h ? h.winner : -1,
      how: s ? s.how : h ? h.how : 'draw',
      frames: h?.frames ?? 0,
      damage: h ? [h.damage[0], h.damage[1]] : [0, 0],
      maxCombo: h ? [h.maxCombo[0], h.maxCombo[1]] : [0, 0],
    });
  }
  return out;
}

export interface ResultsView { buttons: HTMLButtonElement[]; dispose(): void }

/** build the results body into `host`; returns the choice buttons in row order + a disposer (the continue countdown) */
export function buildResults(host: HTMLElement, data: UiGameData, r: MatchResult, pick: (c: ResultChoice) => void, touch = false): ResultsView {
  host.replaceChildren();
  const bonus = r.cfg.mode === 'brawl' || r.cfg.mode === 'heckler';
  const wrap = div(`hpm-res${bonus ? ' bonus' : ''}`, host);
  const w = r.winner;
  const draw = w !== 0 && w !== 1;
  const nameOf = (i: 0 | 1): string => r.names?.[i] ?? fighterName(data, r.cfg.p[i].fighter);
  let dispose = (): void => undefined;

  // ── winner column
  const L = div('hpm-res-win', wrap);
  const how = howItEnded(r);
  if (r.cfg.mode === 'online' && (how === 'disconnect' || how === 'forfeit') && !draw) {
    // the DISCONNECT card (CONTRACT 27.2): the opponent left the show mid-bout; the stayer takes the win
    const dc = div('hpm-res-dc', L);
    dc.append(el('b', '', how === 'disconnect' ? t('res.dc.title') : t('res.ff.title')), el('span', '', t('res.dc.sub', { name: nameOf(w) })));
  }
  const pic = div('hp-portrait hpm-res-portrait', L);
  if (bonus) fillPortrait(pic, data, r.cfg.p[0].fighter, colorsOf(fighter(data, r.cfg.p[0].fighter))[r.cfg.p[0].color]?.tint ?? null);
  else if (!draw) {
    const wp = r.cfg.p[w];
    const col = colorsOf(fighter(data, wp.fighter))[wp.color];
    fillPortrait(pic, data, wp.fighter, col?.tint ?? null);
  } else fillPortrait(pic, data, 'random');
  const stamp = div('hpm-res-stamp', L, bonus ? t(`res.bonus.${r.cfg.mode}`) : draw ? t('res.draw') : t('res.winner'));
  stamp.dataset.side = bonus ? '1' : draw ? 'draw' : String(w + 1);
  div('hpm-res-name', L, bonus ? nameOf(0) : draw ? t('res.draw') : t('res.wins', { name: nameOf(w) }));
  const howKey: Record<string, string> = { ko: 'res.byKo', time: 'res.byTime', forfeit: 'res.byForfeit', disconnect: 'res.byDisconnect' };
  if (!bonus && howKey[how]) div('hpm-res-how', L, t(howKey[how]));
  if (!draw && !bonus) {
    const q = div('hpm-res-quote', L);
    q.append(el('p', '', seasonQuote(data, r.cfg.p[w].fighter, (r.cfg.seed >>> 0) + w * 7)));
  }

  // ── the right column
  const R = div('hpm-res-tape', wrap);
  if (bonus) buildBonus(R, r);
  else {
    const rounds = roundRows(r);
    if (rounds.length) buildRounds(R, rounds, nameOf);
    const head = div('hpm-res-row head', R);
    head.append(el('span', 'k', t('res.tape')), el('b', 'v p1', nameOf(0)), el('b', 'v p2', nameOf(1)));
    const rr = div('hpm-res-row rounds', R);
    rr.append(el('span', 'k', t('res.rounds')));
    const need = Math.max(1, r.cfg.rounds ?? 2);
    for (let i = 0; i < 2; i++) {
      const v = el('span', `v p${i + 1}`);
      for (let k = 0; k < need; k++) v.append(el('i', k < (r.wins[i] ?? 0) ? 'on' : ''));
      rr.append(v);
    }
    const row = (label: string, a: number, b: number, fmt: (n: number) => string, key: string): void => {
      const x = div('hpm-res-row', R);
      x.dataset.stat = key;
      x.append(el('span', 'k', label), el('b', `v p1${a > b ? ' best' : ''}`, fmt(a)), el('b', `v p2${b > a ? ' best' : ''}`, fmt(b)));
    };
    const pct = (i: 0 | 1): number => {
      const f = r.fighters[i];
      return f && f.hpMax > 0 ? Math.round((Math.max(0, f.hp) / f.hpMax) * 100) : 0;
    };
    row(t('res.hpLeft'), pct(0), pct(1), (n) => `${n}%`, 'hpLeft');
    if (r.stats) for (const [key, label] of STATS) row(t(label), Number(r.stats[0][key]) || 0, Number(r.stats[1][key]) || 0, (n) => n.toLocaleString('en-US'), key);
    const tm = div('hpm-res-row time', R);
    tm.append(el('span', 'k', t('res.time')), el('b', 'v wide', clock(r.frames)));
  }
  if (typeof r.score === 'number' && !bonus) {
    const ep = div('hpm-res-score', R);
    ep.append(el('span', 'k', t('res.score')), el('b', 'v', Math.max(0, Math.floor(r.score)).toLocaleString('en-US')));
    if (r.best) ep.append(el('span', 'best', t('res.newBest')));
  }
  if (r.cfg.mode === 'online') div('hpm-res-note', R, r.rated ? t('on.rated') : t('on.unrated'));

  // ── choices (the CONTINUE screen for an arcade loss)
  const acts = div('hpm-res-acts', wrap);
  const out: HTMLButtonElement[] = [];
  if (isContinue(r)) {
    acts.classList.add('continue');
    const panel = div('hpm-res-cont', acts);
    const num = el('b', 'n', String(CONTINUE_SECONDS));
    panel.append(el('span', 'q', t('res.cont.q')), num, el('span', 'note', t('res.continueNote')));
    const cont = typeof r.season?.continues === 'number' && r.season.continues > 0 ? t('res.cont.used', { n: r.season.continues }) : '';
    if (cont) panel.append(el('span', 'used', cont));
    let left = CONTINUE_SECONDS;
    const timer = window.setInterval(() => {
      left--;
      setText(num, String(Math.max(0, left)));
      num.classList.toggle('low', left <= 3);
      if (left <= 0) { window.clearInterval(timer); pick('menu'); }
    }, 1000);
    dispose = () => window.clearInterval(timer);
    void touch;
  }
  resultChoices(r).forEach(([c, label], k) => {
    const b = btn(k === 0 ? 'hpm-btn hot' : 'hpm-btn', label);
    b.id = `hpm-res-${c}`;
    if (k === 0) b.dataset.default = '';
    b.addEventListener('click', () => { dispose(); pick(c); });
    acts.append(b);
    out.push(b);
  });
  return { buttons: out, dispose };
}

/** ROUND BY ROUND: one line per round (CONTRACT 27.3) */
function buildRounds(host: HTMLElement, rounds: ReadonlyArray<RoundLog>, nameOf: (i: 0 | 1) => string): void {
  const box = div('hpm-res-rounds', host);
  box.append(el('h4', 'hpm-cap', t('res.rbr')));
  const head = div('rr head', box);
  head.append(el('span', 'k', ''), el('span', 'w', t('res.rbr.winner')), el('span', 'h', t('res.rbr.how')), el('span', 't', t('res.rbr.time')),
    el('span', 'd', t('res.rbr.dmg')), el('span', 'c', t('res.rbr.combo')));
  for (const r of rounds) {
    const row = div(`rr w${r.winner + 1}`, box);
    row.dataset.round = String(r.round);
    const who = r.winner === 0 || r.winner === 1 ? nameOf(r.winner) : t('res.draw');
    row.append(
      el('span', 'k', t('res.rbr.round', { n: r.round })),
      el('b', `w p${r.winner + 1}`, who),
      el('span', `h ${r.how}`, t(`res.how.${r.how}`)),
      el('span', 't', r.frames > 0 ? clock(r.frames) : '-'),
      el('span', 'd', `${r.damage[0].toLocaleString('en-US')} / ${r.damage[1].toLocaleString('en-US')}`),
      el('span', 'c', `${r.maxCombo[0]} / ${r.maxCombo[1]}`),
    );
  }
}

/** the BRAWL BREAK / HECKLER TOSS panel: score, the ratings it adds, a grade, the round's tallies */
function buildBonus(host: HTMLElement, r: MatchResult): void {
  const mode = r.cfg.mode as 'brawl' | 'heckler';
  const ev = boutLogFor(r.cfg)?.bonus ?? { goonsDown: 0, goonsSpawned: 0, heckles: 0, parried: 0, perfect: 0, hitsTaken: 0 };
  // the sim's own bonus snapshot (CONTRACT 28.4 MatchSnap.brawl) wins over the Hud's event tallies
  const bs = r.match.brawl;
  const tally = bs ? { goonsDown: bs.downed ?? ev.goonsDown, goonsSpawned: bs.spawned ?? ev.goonsSpawned, heckles: ev.heckles, parried: bs.parries ?? ev.parried,
    perfect: bs.perfects ?? ev.perfect, hitsTaken: bs.hitsTaken ?? ev.hitsTaken } : ev;
  const score = Math.max(0, Math.floor(r.score ?? bs?.score ?? 0));
  const box = div('hpm-res-bonus', host);
  const g = bonusGrade(mode, tally);
  const top = div('top', box);
  top.append(el('span', 'k', t('res.bonus.score')), el('b', 'v', score.toLocaleString('en-US')));
  const grade = el('b', `grade g-${g}`, g);
  top.append(grade);
  if (r.season) div('ratings', box, t('res.bonus.ratings', { n: score.toLocaleString('en-US') }));
  if (bs) div('mult', box, t('res.bonus.mult', { x: (Math.max(100, bs.mult) / 100).toFixed(1) }));
  const rows: Array<[string, number]> = mode === 'brawl'
    ? [[t('res.bonus.goons'), tally.goonsDown], [t('res.bonus.hits'), tally.hitsTaken]]
    : [[t('res.bonus.parried'), tally.parried], [t('res.bonus.perfect'), tally.perfect], [t('res.bonus.thrown'), tally.heckles], [t('res.bonus.hits'), tally.hitsTaken]];
  for (const [k, v] of rows) { const x = div('hpm-res-row', box); x.append(el('span', 'k', k), el('b', 'v wide', v.toLocaleString('en-US'))); }
  div('hpm-res-note', box, t(`res.bonus.${mode}.note`));
}
