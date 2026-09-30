// HIT PARADE - RESULTS (lane UI; CONTRACT section 8 "results (winner quote, stats)", 16 Menus.showResults, 18.3 MatchResult).
//
// Left: the winner's portrait, name, how it ended (BY KNOCKOUT / BY DECISION / BY FORFEIT / OPPONENT LEFT) and a win
// quote in a speech card. Right: THE TAPE - rounds won, health left and time on air straight from MatchResult (built by
// game.ts from sim snapshots only), plus MatchResult.stats (= Hud.tally(), counted from the sim's own events) when
// present: damage, best combo, counters, punish counters, perfect parries, throws, supers, wall splats; the better value
// per row is marked. SEASON bouts add the episode score (+ NEW BEST). Choices by mode:
//   versus / training : REMATCH, CHARACTER SELECT, MAIN MENU
//   online            : REMATCH, MAIN MENU
//   arcade win        : NEXT EPISODE (-> 'next'), MAIN MENU          arcade loss: CONTINUE (-> 'rematch'), END THE SEASON (-> 'menu')
//   brawl / heckler   : NEXT EPISODE (-> 'next')

import type { MatchResult, MatchStats, UiGameData } from './types.ts';
import { btn, div, el } from './dom.ts';
import { colorsOf, fighter, fighterName, fillPortrait } from './data.ts';
import { pool, t } from './strings.ts';

export type ResultChoice = 'rematch' | 'charselect' | 'menu' | 'next';
const STATS: ReadonlyArray<readonly [keyof MatchStats, string]> = [
  ['damage', 'res.stat.damage'], ['maxCombo', 'res.stat.maxCombo'], ['counters', 'res.stat.counters'], ['punishes', 'res.stat.punishes'],
  ['perfectParries', 'res.stat.parries'], ['throws', 'res.stat.throws'], ['supers', 'res.stat.supers'], ['wallSplats', 'res.stat.splats'],
];

/** the human player of a one-player mode (the side whose cpu is -1; P1 when both are human) */
export function humanSide(r: MatchResult): 0 | 1 {
  return r.cfg.p[0].cpu < 0 ? 0 : r.cfg.p[1].cpu < 0 ? 1 : 0;
}

export function resultChoices(r: MatchResult): Array<[ResultChoice, string]> {
  const mode = r.cfg.mode;
  if (mode === 'brawl' || mode === 'heckler') return [['next', t('res.next')]];
  if (mode === 'arcade') {
    const won = r.winner === humanSide(r);
    return won ? [['next', t('res.next')], ['menu', t('res.menu')]] : [['rematch', t('res.continue')], ['menu', t('res.giveUp')]];
  }
  if (mode === 'online') return [['rematch', t('res.rematch')], ['menu', t('res.menu')]];
  return [['rematch', t('res.rematch')], ['charselect', t('res.charselect')], ['menu', t('res.menu')]];
}

export function winQuote(fid: string): string {
  const q = pool(`quote.${fid}`);
  const list = q.length ? q : pool('quote.default');
  return list.length ? list[Math.floor(Math.random() * list.length)] : '';
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

/** build the results body into `host`; returns the choice buttons in row order */
export function buildResults(host: HTMLElement, data: UiGameData, r: MatchResult, pick: (c: ResultChoice) => void): HTMLButtonElement[] {
  host.replaceChildren();
  const wrap = div('hpm-res', host);
  const w = r.winner;
  const draw = w !== 0 && w !== 1;
  const nameOf = (i: 0 | 1): string => r.names?.[i] ?? fighterName(data, r.cfg.p[i].fighter);

  // ── winner column
  const L = div('hpm-res-win', wrap);
  const pic = div('hp-portrait hpm-res-portrait', L);
  if (!draw) {
    const wp = r.cfg.p[w];
    const col = colorsOf(fighter(data, wp.fighter))[wp.color];
    fillPortrait(pic, data, wp.fighter, col?.tint ?? null);
  } else fillPortrait(pic, data, 'random');
  const stamp = div('hpm-res-stamp', L, draw ? t('res.draw') : t('res.winner'));
  stamp.dataset.side = draw ? 'draw' : String(w + 1);
  div('hpm-res-name', L, draw ? t('res.draw') : t('res.wins', { name: nameOf(w) }));
  const how = howItEnded(r);
  const howKey: Record<string, string> = { ko: 'res.byKo', time: 'res.byTime', forfeit: 'res.byForfeit', disconnect: 'res.byDisconnect' };
  if (howKey[how]) div('hpm-res-how', L, t(howKey[how]));
  if (!draw) {
    const q = div('hpm-res-quote', L);
    q.append(el('p', '', winQuote(r.cfg.p[w].fighter)));
  }

  // ── the tape
  const R = div('hpm-res-tape', wrap);
  const head = div('hpm-res-row head', R);
  head.append(el('span', 'k', t('res.tape')), el('b', 'v p1', nameOf(0)), el('b', 'v p2', nameOf(1)));
  const rr = div('hpm-res-row rounds', R);
  rr.append(el('span', 'k', t('res.rounds')));
  const rounds = Math.max(1, r.cfg.rounds ?? 2);
  for (let i = 0; i < 2; i++) {
    const v = el('span', `v p${i + 1}`);
    for (let k = 0; k < rounds; k++) v.append(el('i', k < (r.wins[i] ?? 0) ? 'on' : ''));
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
  if (typeof r.score === 'number') {
    const ep = div('hpm-res-score', R);
    ep.append(el('span', 'k', t('res.score')), el('b', 'v', Math.max(0, Math.floor(r.score)).toLocaleString('en-US')));
    if (r.best) ep.append(el('span', 'best', t('res.newBest')));
  }
  if (r.cfg.mode === 'arcade' && r.winner !== humanSide(r)) div('hpm-res-note', R, t('res.continueNote'));
  if (r.cfg.mode === 'online') div('hpm-res-note', R, r.rated ? t('on.rated') : t('on.unrated'));

  // ── choices
  const acts = div('hpm-res-acts', wrap);
  const out: HTMLButtonElement[] = [];
  resultChoices(r).forEach(([c, label], k) => {
    const b = btn(k === 0 ? 'hpm-btn hot' : 'hpm-btn', label);
    b.id = `hpm-res-${c}`;
    if (k === 0) b.dataset.default = '';
    b.addEventListener('click', () => pick(c));
    acts.append(b);
    out.push(b);
  });
  return out;
}
