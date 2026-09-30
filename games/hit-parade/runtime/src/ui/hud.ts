// HIT PARADE - the TV-frame HUD (lane UI; CONTRACT section 8, 16 `Hud`).
//
//   top strip   show bug + LIVE (top-left) and SCORE in a slanted yellow frame (top-right, arcade only)
//   bars        per side: portrait, name plate (P1 / P2 / CPU LVn), slanted health bar (yellow fill, grey recoverable
//               HP, a red damage trail that lags 0.45 s), NERVE (6 bars) with the STAGE FRIGHT state, and SHOWTIME
//               (the RATINGS meter, 3 bars) in the bottom corner; the centre has the timer and the round pips
//   combo       the attacker's side: hit count + style word SOLID / SPICY / BRUTAL / PRIME TIME / SYNDICATED + damage
//   callouts    COUNTER, PUNISH COUNTER, THROW ESCAPE, PERFECT PARRY, STAGE FRIGHT, WALL SPLAT, FIRST BLOOD
//   broadcast   ROUND / FIGHT / K.O. / TIME OVER / PERFECT / WINS sweeps, the stage manager's straps, host captions
//
// frame() is cheap: DOM writes happen only when a value changes. Events are deduped by (frame, type, a, b) because a
// rollback re-emits them (CONTRACT 4.5). Payloads per CONTRACT 17 rule 6 / 19.8: HIT, BLOCK, COUNTER, PUNISH, PARRY,
// PERFECT_PARRY, SUPER_HIT `a` attacker `b` victim (so a PERFECT PARRY belongs to `b`); THROW / THROW_TECH `a` thrower
// `b` victim (the escape belongs to `b`); WALL_SPLAT `a` victim; STAGE_FRIGHT_ON/OFF, CINEMATIC_START `a` fighter;
// KO `a` winner `b` loser (double KO: a = b = -1). Round / match winners come from MatchSnap.roundWinner / winner.
// SCORE (brawl / heckler; payload not fixed by SIM yet): a = player, b = points.
// The combo counter reads FighterSnap.combo / comboDamage of the ATTACKER (19.7). tally() keeps the per-match numbers
// the results screen shows (MatchResult.stats) - all from the sim's own events and snapshots.
//
// Touch mode (html.hp-touch) re-flows the blocks out of the stick zone and the button arc (styles.css).

import type { MatchCfg, MatchStats, SimEvent, UiFighterSnap, UiGameData, UiMatchSnap } from './types.ts';
import { EV } from './ev.ts';
import { Broadcast, buildBug, setBugLine, type CaptionEvent } from './broadcast.ts';
import { clamp, div, el, pulse, setText, touchModeOn, watchTouchMode } from './dom.ts';
import { fighterName, fillPortrait, colorsOf, fighter, onPortraits, setPortraits } from './data.ts';
import { setStrings, t } from './strings.ts';
import { InputDisplay, FrameReadout, type TrainingOpts } from './training.ts';
import './styles.css';

export const SHOWTIME_BAR = 10000;
export const SHOWTIME_BARS = 3;
export const NERVE_BAR = 10000;
export const NERVE_BARS = 6;
/** combo style tiers: minimum hits -> strings key (a super in the combo lifts it to PRIME TIME at least) */
export const COMBO_TIERS: ReadonlyArray<readonly [number, string]> = [[2, 'solid'], [4, 'spicy'], [6, 'brutal'], [9, 'prime'], [12, 'syndicated']];
const LOW_HP = 0.25;
const COMBO_HOLD_MS = 1300;
const CALL_MS = 1600;

type CallKind = 'counter' | 'punish' | 'throwEscape' | 'perfectParry' | 'stageFright' | 'wallSplat' | 'firstBlood';

interface Side {
  root: HTMLElement;
  portrait: HTMLElement;
  name: HTMLElement;
  tag: HTMLElement;
  health: HTMLElement;
  fill: HTMLElement;
  greyBar: HTMLElement;
  trail: HTMLElement;
  nerveBox: HTMLElement;
  nerveSegs: HTMLElement[];
  nerveLbl: HTMLElement;
  show: HTMLElement;
  showLvl: HTMLElement;
  showSegs: HTMLElement[];
  combo: HTMLElement;
  comboN: HTMLElement;
  comboHits: HTMLElement;
  comboWord: HTMLElement;
  comboDmg: HTMLElement;
  calls: HTMLElement;
  // last written values
  hp: number; hpMax: number; greyV: number; nerve: number; fright: boolean; showtime: number; low: boolean;
  comboCount: number; comboSuper: boolean; comboShownAt: number; comboOn: boolean; wins: number;
  primeAnnounced: boolean;
}

export class Hud {
  readonly root: HTMLElement;
  readonly broadcast: Broadcast;
  private readonly data: UiGameData;
  private readonly frameEl: HTMLElement;
  private readonly bug: HTMLElement;
  private readonly scoreBox: HTMLElement;
  private readonly scoreV: HTMLElement;
  private readonly timer: HTMLElement;
  private readonly pips: [HTMLElement, HTMLElement];
  private readonly sides: [Side, Side];
  private cfg: MatchCfg | null = null;
  private roundsToWin = 2;
  private seen = new Map<string, number>();
  private lastTimer = '';
  private firstBlood = false;
  private score: number | null = null;
  private scoreEv = 0;
  private names: [string | null, string | null] = [null, null];
  private lastRound = 0;
  private koThisRound: number[] = [];
  private timeOverThisRound = false;
  private offs: Array<() => void> = [];
  private stats: [MatchStats, MatchStats] = [blankStats(), blankStats()];
  private lastHp: [number, number] = [-1, -1];
  private lastSuperF: [number, number] = [-1e9, -1e9];
  private inputs: InputDisplay | null = null;
  private frames: FrameReadout | null = null;
  /** read-back: the last 40 events handled (after dedupe) as [frame, type, a, b] */
  private readonly evLog: Array<[number, number, number, number]> = [];

  constructor(root: HTMLElement, data: UiGameData) {
    this.data = data;
    setStrings(data.strings);
    const R = this.root = el('div', 'hp-hud');
    R.id = 'hp-hud';
    R.hidden = true;
    R.setAttribute('aria-hidden', 'true');
    const F = this.frameEl = div('hp-frame', R);

    const top = div('hp-top', F);
    this.bug = buildBug('');
    top.append(this.bug);
    this.scoreBox = div('hp-score', top);
    this.scoreBox.append(el('span', 'lbl', t('hud.score')));
    this.scoreV = el('span', 'v', '0');
    this.scoreBox.append(this.scoreV);
    this.scoreBox.hidden = true;

    const bars = div('hp-bars', F);
    const s1 = this.mkSide(0);
    const center = div('hp-center', bars);
    const mini = div('hp-minibug', center);
    mini.append(el('i'), document.createTextNode(t('show.live')));
    this.timer = div('hp-timer', center, '99');
    const pips = div('hp-pips', center);
    this.pips = [el('span', 'p1'), el('span', 'p2')];
    pips.append(this.pips[0], this.pips[1]);
    const s2 = this.mkSide(1);
    bars.prepend(s1.root);
    bars.append(s2.root);
    this.sides = [s1, s2];
    for (const s of this.sides) F.append(s.combo, s.calls);

    root.append(R);
    this.broadcast = new Broadcast(root);
    this.broadcast.root.hidden = true;
    this.setTouchMode(touchModeOn());
    this.offs.push(watchTouchMode((on) => this.setTouchMode(on)));
    this.offs.push(onPortraits(() => this.refreshPortraits()));
  }

  private mkSide(i: 0 | 1): Side {
    const root = el('div', `hp-side p${i + 1}`);
    const portrait = div('hp-portrait', root);
    const plate = div('hp-plate', root);
    const name = el('b', 'name', '');
    const tag = el('span', 'tag', '');
    plate.append(name, tag);
    const health = div('hp-health', root);
    const trail = el('i', 'trail');
    const grey = el('i', 'grey');
    const fill = el('i', 'fill');
    health.append(trail, grey, fill);
    const meters = div('hp-meters', root);
    const nerveBox = div('hp-nerve', meters);
    const nerveSegs: HTMLElement[] = [];
    for (let k = 0; k < NERVE_BARS; k++) { const s = el('i'); nerveSegs.push(s); nerveBox.append(s); }
    const nerveLbl = el('span', 'hp-nerve-lbl', t('hud.nerve'));
    meters.append(nerveLbl);
    const show = div(`hp-show p${i + 1}`, root);
    const showLvl = el('div', 'lvl');
    showLvl.append(el('b', '', '0'));
    const col = el('div', 'col');
    col.append(el('span', 'lbl', t('hud.ratings')));
    const segsBox = div('segs', col);
    const showSegs: HTMLElement[] = [];
    for (let k = 0; k < SHOWTIME_BARS; k++) { const s = el('i'); showSegs.push(s); segsBox.append(s); }
    show.append(showLvl, col);
    const combo = el('div', `hp-combo p${i + 1}`);
    const nrow = div('n-row', combo);
    const comboN = el('b', 'n', '0');
    const comboHits = el('span', 'hits', '');
    nrow.append(comboN, comboHits);
    const comboWord = el('span', 'word', '');
    const comboDmg = el('span', 'dmg', '');
    combo.append(comboWord, comboDmg);
    const calls = el('div', `hp-calls p${i + 1}`);
    return {
      root, portrait, name, tag, health, fill, greyBar: grey, trail, nerveBox, nerveSegs, nerveLbl, show, showLvl, showSegs,
      combo, comboN, comboHits, comboWord, comboDmg, calls,
      hp: -1, hpMax: -1, greyV: -1, nerve: -1, fright: false, showtime: -1, low: false,
      comboCount: 0, comboSuper: false, comboShownAt: 0, comboOn: false, wins: -1, primeAnnounced: false,
    };
  }

  // ─────────────────────────── CONTRACT 16 ───────────────────────────
  mount(cfg: MatchCfg): void {
    this.cfg = cfg;
    this.roundsToWin = Math.max(1, cfg.rounds ?? 2);
    this.seen.clear();
    this.firstBlood = false;
    this.lastTimer = '';
    this.lastRound = 0;
    this.koThisRound = [];
    this.timeOverThisRound = false;
    this.score = null;
    this.scoreEv = 0;
    this.stats = [blankStats(), blankStats()];
    this.lastHp = [-1, -1];
    this.lastSuperF = [-1e9, -1e9];
    this.broadcast.clear();
    this.broadcast.root.hidden = false;
    this.scoreBox.hidden = cfg.mode !== 'arcade' && cfg.mode !== 'brawl' && cfg.mode !== 'heckler';
    this.setScoreText(0);
    setBugLine(this.bug, this.bugLine(cfg));
    for (let i = 0; i < 2; i++) {
      const s = this.sides[i];
      const p = cfg.p[i];
      s.hp = s.hpMax = s.greyV = s.nerve = s.showtime = -1;
      s.fright = false; s.low = false; s.comboCount = 0; s.comboOn = false; s.comboSuper = false; s.wins = -1; s.primeAnnounced = false;
      s.trail.classList.add('snap');
      s.combo.classList.remove('on');
      s.calls.replaceChildren();
      s.health.classList.remove('low');
      s.nerveBox.classList.remove('fright');
      s.nerveLbl.classList.remove('fright');
      setText(s.nerveLbl, t('hud.nerve'));
      setText(s.name, this.names[i] ?? fighterName(this.data, p.fighter));
      const cpu = p.cpu >= 0;
      const dummy = cfg.mode === 'training' && i === 1;
      setText(s.tag, dummy ? t('cs.dummy') : cpu ? t('hud.cpu', { n: p.cpu }) : t('hud.player', { n: i + 1 }));
      s.tag.classList.toggle('cpu', cpu || dummy);
    }
    this.refreshPortraits();
    this.renderPips([0, 0]);
    this.root.hidden = false;
    if (cfg.mode === 'training') this.setTraining({ inputs: true, frames: true });
    else this.setTraining(null);
  }

  unmount(): void {
    this.root.hidden = true;
    this.broadcast.clear();
    this.broadcast.root.hidden = true;
    this.setTraining(null);
    this.cfg = null;
  }

  frame(m: UiMatchSnap, f: readonly [UiFighterSnap, UiFighterSnap], ev: readonly SimEvent[]): void {
    if (!this.cfg) return;
    if (m.round !== this.lastRound) { this.lastRound = m.round; this.koThisRound = []; this.timeOverThisRound = false; }
    for (const e of ev) this.onEvent(e, m, f);
    // timer
    const infinite = this.cfg.timer === 0 || m.timer < 0;
    const tv = infinite ? t('hud.infinite') : String(Math.max(0, Math.ceil(m.timer)));
    if (tv !== this.lastTimer) {
      this.lastTimer = tv;
      this.timer.textContent = tv;
      this.timer.classList.toggle('low', !infinite && m.timer <= 10);
    }
    this.renderPips([m.wins[0] ?? 0, m.wins[1] ?? 0]);
    const now = performance.now();
    for (let i = 0 as 0 | 1; i < 2; i = (i + 1) as 0 | 1) {
      this.renderSide(i, f[i]);
      this.renderCombo(i, f[i], now);
      // tallies: damage dealt = the opponent's HP drops (a new round refills: rises are ignored); best combo
      const o = f[1 - i];
      if (this.lastHp[1 - i] >= 0 && o.hp < this.lastHp[1 - i]) this.stats[i].damage += this.lastHp[1 - i] - o.hp;
      if ((f[i].combo | 0) > this.stats[i].maxCombo) this.stats[i].maxCombo = f[i].combo | 0;
    }
    this.lastHp = [f[0].hp, f[1].hp];
    this.frames?.frame(m, f, ev);
  }

  // ─────────────────────────── additive API (CHANGED(UI)) ───────────────────────────
  /** the arcade score from the integrator (authoritative); null = sum SCORE events */
  setScore(n: number | null): void { this.score = n; this.setScoreText(n ?? this.scoreEv); }
  /** display names (online opponents); null = the fighter's name */
  setNames(n: [string | null, string | null]): void {
    this.names = n;
    if (this.cfg) for (let i = 0; i < 2; i++) setText(this.sides[i].name, n[i] ?? fighterName(this.data, this.cfg.p[i].fighter));
  }
  setEpisodeLine(line: string): void { setBugLine(this.bug, line); }
  setPortraits(map: Readonly<Record<string, string>>): void { setPortraits(map); }
  /** cue a host caption / strap by name (e.g. 'boss_phase2' when Ricky's phase flips) */
  cue(ev: CaptionEvent, vars: Readonly<Record<string, string | number>> = {}): void {
    if (ev === 'boss_phase2') this.broadcast.strap('phase2', t('strap.bossPhase2'), t('strap.bossPhase2.sub'), true);
    this.broadcast.caption(ev, vars);
  }
  /** training overlays (input display + frame data); null removes them */
  setTraining(o: Partial<TrainingOpts> | null): void {
    this.root.classList.toggle('training', !!o);
    const wantIn = !!o && o.inputs !== false;
    const wantFr = !!o && o.frames !== false;
    if (wantIn && !this.inputs) this.inputs = new InputDisplay(this.frameEl);
    if (!wantIn && this.inputs) { this.inputs.dispose(); this.inputs = null; }
    if (wantFr && !this.frames) this.frames = new FrameReadout(this.frameEl);
    if (!wantFr && this.frames) { this.frames.dispose(); this.frames = null; }
  }
  /** feed the input display (training): the input words the sim stepped with this tick */
  pushInputs(word: number, frame: number): void { this.inputs?.push(word, frame); }
  setRecordState(s: 'off' | 'record' | 'play'): void { this.frames?.setRecord(s); }

  setTouchMode(on: boolean): void { this.root.classList.toggle('touch', on); }

  /** this match's per-player numbers so far (game.ts puts them in MatchResult.stats) */
  tally(): [MatchStats, MatchStats] { return [{ ...this.stats[0] }, { ...this.stats[1] }]; }

  readback(): Record<string, unknown> {
    const side = (s: Side) => ({
      name: s.name.textContent, tag: s.tag.textContent, hp: s.hp, hpMax: s.hpMax, nerve: s.nerve, fright: s.fright, showtime: s.showtime,
      combo: s.comboOn ? Number(s.comboN.textContent) : 0, word: s.comboWord.textContent, calls: [...s.calls.children].map((c) => c.textContent),
    });
    return {
      mounted: !!this.cfg, timer: this.timer.textContent, pips: this.pips.map((p) => p.querySelectorAll('i.on').length),
      score: this.scoreBox.hidden ? null : this.scoreV.textContent, sides: [side(this.sides[0]), side(this.sides[1])],
      events: this.evLog.slice(-12), broadcast: this.broadcast.readback(), touch: this.root.classList.contains('touch'),
    };
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs = [];
    this.setTraining(null);
    this.broadcast.dispose();
    this.root.remove();
  }

  // ─────────────────────────── internals ───────────────────────────
  private bugLine(cfg: MatchCfg): string {
    const stage = t(`stage.${cfg.stage}.name`);
    return stage.startsWith('[') ? '' : stage;
  }

  private refreshPortraits(): void {
    if (!this.cfg) return;
    for (let i = 0; i < 2; i++) {
      const p = this.cfg.p[i];
      const col = colorsOf(fighter(this.data, p.fighter))[p.color];
      fillPortrait(this.sides[i].portrait, this.data, p.fighter, col?.tint ?? null);
    }
  }

  private setScoreText(n: number): void { setText(this.scoreV, String(Math.max(0, Math.floor(n))).padStart(7, '0')); }

  private renderPips(w: [number, number]): void {
    for (let i = 0; i < 2; i++) {
      const s = this.sides[i];
      if (s.wins === w[i] && this.pips[i].childElementCount === this.roundsToWin) continue;
      s.wins = w[i];
      const box = this.pips[i];
      box.replaceChildren();
      for (let k = 0; k < this.roundsToWin; k++) box.append(el('i', k < w[i] ? 'on' : ''));
    }
  }

  private renderSide(i: 0 | 1, f: UiFighterSnap): void {
    const s = this.sides[i];
    const hpMax = f.hpMax > 0 ? f.hpMax : 1;
    const hp = clamp(f.hp, 0, hpMax);
    const grey = clamp(hp + (f.greyHp ?? 0), 0, hpMax);
    if (hp !== s.hp || hpMax !== s.hpMax) {
      const frac = hp / hpMax;
      if (hp > s.hp || s.hp < 0 || hpMax !== s.hpMax) s.trail.classList.add('snap'); else s.trail.classList.remove('snap');
      if (s.hp >= 0 && hp < s.hp) {
        s.portrait.classList.remove('hit');
        void s.portrait.offsetWidth;
        s.portrait.classList.add('hit');
      }
      s.fill.style.transform = `scaleX(${frac.toFixed(4)})`;
      s.trail.style.transform = `scaleX(${frac.toFixed(4)})`;
      const low = frac <= LOW_HP && hp > 0;
      if (low !== s.low) { s.low = low; s.health.classList.toggle('low', low); }
      s.hp = hp; s.hpMax = hpMax;
    }
    if (grey !== s.greyV) { s.greyV = grey; s.greyBar.style.transform = `scaleX(${(grey / hpMax).toFixed(4)})`; }
    const nerve = Math.max(0, f.nerve);
    const fright = !!f.stageFright;
    if (nerve !== s.nerve || fright !== s.fright) {
      for (let k = 0; k < NERVE_BARS; k++) s.nerveSegs[k].style.setProperty('--f', clamp((nerve - k * NERVE_BAR) / NERVE_BAR, 0, 1).toFixed(3));
      if (fright !== s.fright) {
        s.nerveBox.classList.toggle('fright', fright);
        s.nerveLbl.classList.toggle('fright', fright);
        setText(s.nerveLbl, fright ? t('hud.stageFright') : t('hud.nerve'));
      }
      s.nerve = nerve; s.fright = fright;
    }
    const st = Math.max(0, f.showtime);
    if (st !== s.showtime) {
      const lvl = Math.min(SHOWTIME_BARS, Math.floor(st / SHOWTIME_BAR));
      for (let k = 0; k < SHOWTIME_BARS; k++) {
        const fr = clamp((st - k * SHOWTIME_BAR) / SHOWTIME_BAR, 0, 1);
        s.showSegs[k].style.setProperty('--f', fr.toFixed(3));
        s.showSegs[k].classList.toggle('full', fr >= 1);
      }
      setText(s.showLvl.firstElementChild as HTMLElement, String(lvl));
      s.show.classList.toggle('max', lvl >= SHOWTIME_BARS);
      if (lvl >= SHOWTIME_BARS && s.showtime >= 0 && s.showtime < SHOWTIME_BARS * SHOWTIME_BAR && !s.primeAnnounced && this.cfg) {
        s.primeAnnounced = true;
        this.broadcast.strap(`prime${i}`, t('strap.primeReady'), t('strap.primeReady.sub', { name: this.nameOf(i) }));
      }
      if (lvl < SHOWTIME_BARS) s.primeAnnounced = false;
      s.showtime = st;
    }
  }

  /** side i's combo = what fighter i is landing (the attacker's own snapshot, CONTRACT 19.7) */
  private renderCombo(i: 0 | 1, atk: UiFighterSnap, now: number): void {
    const s = this.sides[i];
    const n = Math.max(0, atk.combo | 0);
    if (n >= 2) {
      if (n !== s.comboCount) {
        setText(s.comboN, String(n));
        setText(s.comboHits, t('hud.hits', { n }).replace(String(n), '').trim());
        let tier = -1;
        for (let k = 0; k < COMBO_TIERS.length; k++) if (n >= COMBO_TIERS[k][0]) tier = k;
        if (s.comboSuper) tier = Math.max(tier, 3);
        s.comboWord.dataset.tier = String(tier);
        setText(s.comboWord, tier >= 0 ? t(`hud.combo.${COMBO_TIERS[tier][1]}`) : '');
        pulse(s.comboN, [{ transform: 'scale(1.45)' }, { transform: 'scale(1)' }], 140);
      }
      const dmg = Math.max(0, atk.comboDamage ?? 0);
      setText(s.comboDmg, dmg > 0 ? t('hud.dmg', { n: dmg }) : '');
      if (!s.comboOn) { s.comboOn = true; s.combo.classList.add('on'); }
      s.comboShownAt = now;
    } else {
      if (s.comboCount >= 2) s.comboShownAt = now;           // combo just ended: hold it on screen a moment
      if (s.comboOn && now - s.comboShownAt > COMBO_HOLD_MS) { s.comboOn = false; s.combo.classList.remove('on'); }
      if (n === 0) s.comboSuper = false;
    }
    s.comboCount = n;
  }

  private call(i: number, k: CallKind): void {
    const s = this.sides[i === 1 ? 1 : 0];
    const c = el('div', 'hp-call', t(`call.${k}`));
    c.dataset.k = k;
    s.calls.prepend(c);
    while (s.calls.childElementCount > 3) s.calls.lastElementChild?.remove();
    window.setTimeout(() => c.remove(), CALL_MS);
  }

  private nameOf(i: number): string {
    if (!this.cfg) return '';
    const p = this.cfg.p[i === 1 ? 1 : 0];
    return this.names[i] ?? fighterName(this.data, p.fighter);
  }

  private onEvent(e: SimEvent, m: UiMatchSnap, f: readonly [UiFighterSnap, UiFighterSnap]): void {
    const key = `${e.frame}:${e.type}:${e.a}:${e.b}`;
    if (this.seen.has(key)) return;
    this.seen.set(key, e.frame);
    if (this.seen.size > 600) { const cut = e.frame - 900; for (const [k, fr] of this.seen) if (fr < cut) this.seen.delete(k); }
    this.evLog.push([e.frame, e.type, e.a, e.b]);
    if (this.evLog.length > 40) this.evLog.shift();
    const P = (v: number): 0 | 1 => (v === 1 ? 1 : 0);
    const both = (atk: 0 | 1) => ({ attacker: this.nameOf(atk), victim: this.nameOf(1 - atk), name: this.nameOf(atk), n: m.round });
    const B = this.broadcast;
    switch (e.type) {
      case EV.ROUND_INTRO: {
        const w0 = m.wins[0] ?? 0, w1 = m.wins[1] ?? 0, last = this.roundsToWin - 1;
        const final = w0 === last && w1 === last && last > 0;
        void B.sweep(final ? t('hud.finalRound') : t('hud.round', { n: m.round }), { tone: 'round' });
        if (final) B.caption('final_round', both(0));
        else if (last > 0 && (w0 === last || w1 === last)) {
          const leader = w0 === last ? 0 : 1;
          B.strap('matchpoint', t('strap.matchPoint'), t('strap.matchPoint.sub'));
          B.caption('match_point', { ...both(leader), name: this.nameOf(leader) });
        } else B.caption('round_start', both(0));
        break;
      }
      case EV.FIGHT: void B.sweep(t('hud.fight'), { tone: 'fight' }); break;
      case EV.HIT:
        if (!this.firstBlood) { this.firstBlood = true; this.call(P(e.a), 'firstBlood'); B.caption('first_blood', both(P(e.a))); }
        break;
      case EV.COUNTER: this.stats[P(e.a)].counters++; this.call(P(e.a), 'counter'); B.caption('counter', both(P(e.a))); break;
      case EV.PUNISH: this.stats[P(e.a)].punishes++; this.call(P(e.a), 'punish'); B.caption('punish', both(P(e.a))); break;
      case EV.PERFECT_PARRY: this.stats[P(e.b)].perfectParries++; this.call(P(e.b), 'perfectParry'); B.caption('perfect_parry', both(P(e.b))); break;
      case EV.THROW: this.stats[P(e.a)].throws++; break;
      case EV.THROW_TECH: this.call(P(e.b), 'throwEscape'); B.caption('throw_escape', both(P(e.b))); break;
      case EV.WALL_SPLAT: {
        const atk = P(1 - P(e.a));
        this.stats[atk].wallSplats++;
        this.call(atk, 'wallSplat');
        B.caption('wall_splat', both(atk));
        break;
      }
      case EV.SUPER_HIT: case EV.CINEMATIC_START: {
        const a = P(e.a);
        this.sides[a].comboSuper = true;
        if (e.type === EV.SUPER_HIT && e.frame - this.lastSuperF[a] > 90) this.stats[a].supers++;
        if (e.type === EV.SUPER_HIT) this.lastSuperF[a] = e.frame;
        B.caption('super', both(a));
        break;
      }
      case EV.STAGE_FRIGHT_ON: this.call(P(e.a), 'stageFright'); B.caption('stage_fright', { ...both(P(e.a)), name: this.nameOf(P(e.a)) }); break;
      case EV.KO: {
        const dbl = e.a < 0 || e.b < 0 || (f[0].hp <= 0 && f[1].hp <= 0);
        if (this.koThisRound.length === 0) void B.sweep(dbl ? t('hud.doubleKo') : t('hud.ko'), { tone: 'ko' });
        this.koThisRound.push(e.b);
        if (!dbl) B.caption('ko', { winner: this.nameOf(P(e.a)), loser: this.nameOf(P(e.b)) });
        break;
      }
      case EV.TIMEOVER:
        this.timeOverThisRound = true;
        void B.sweep(t('hud.timeOver'), { tone: 'time' });
        B.caption('time_over', both(0));
        break;
      case EV.ROUND_END: {
        const rw = typeof m.roundWinner === 'number' && m.roundWinner >= 0 ? m.roundWinner : e.a;
        if (rw !== 0 && rw !== 1) { void B.sweep(t('hud.draw'), { tone: 'win' }); B.caption('draw', both(0)); break; }
        const w = rw, l = 1 - w;
        const wf = f[w];
        const cv = { winner: this.nameOf(w), loser: this.nameOf(l) };
        const perfect = wf.hpMax > 0 && wf.hp >= wf.hpMax;
        if (perfect) { void B.sweep(t('hud.perfect'), { tone: 'win' }); B.caption('perfect_round', cv); }
        else if (wf.hpMax > 0 && wf.hp / wf.hpMax < LOW_HP) B.caption('comeback', cv);
        else if (this.timeOverThisRound) B.caption('round_end', cv);
        void B.sweep(t('hud.wins', { name: this.nameOf(w) }), { tone: 'win' });
        break;
      }
      case EV.MATCH_END: {
        const w = typeof m.winner === 'number' && m.winner >= 0 ? m.winner : e.a;
        if (w === 0 || w === 1) B.caption('match_end', { winner: this.nameOf(w), loser: this.nameOf(1 - w) });
        break;
      }
      case EV.SCORE:
        this.scoreEv += Math.max(0, e.b | 0);
        if (this.score === null) this.setScoreText(this.scoreEv);
        break;
      default: break;
    }
  }
}

function blankStats(): MatchStats {
  return { damage: 0, maxCombo: 0, counters: 0, punishes: 0, perfectParries: 0, throws: 0, supers: 0, wallSplats: 0 };
}
