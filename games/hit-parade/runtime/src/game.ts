// HIT PARADE - the game orchestrator (CONTRACT §16 "what game.ts wires together", §8, §12, §18; lane SHELL).
//
// One Game per page. It owns the 60 Hz loop (app/loop.ts), the app flow (app/flow.ts) and the current BOUT, and it
// turns the menus' intents into bouts:
//
//   menus intent ──> startBout(cfg) ──> BoutView.create (stage + fighters + warm-up, behind the loading card)
//                                      createMatch(cfg, data) · Hud.mount(cfg) · CPUs for cpu >= 0 players ·
//                                      (online) online.attach(m) -> RollbackSession
//                 ──> PRESS START card (deep links without autostart) or straight into the bout
//   loop tick (60 Hz, only in phase 'bout'; online also while paused):
//       offline  step(m, word1, word2)   word = Input (keyboard / pad / touch) or Cpu.input(m, p) or dev.setInputs
//       online   session.tick(localWord)  (the session steps the sim, rolls back, stalls)
//   rendered frame: NEW events (eventsSince from lastSeen - 16, deduped by (frame,type,a,b): rollback re-emits) ->
//       BoutView.frame + Hud.frame + audio.events, snapshots only (readMatch / readFighter), then BoutView.render
//   MATCH_END (a sim event) ──> the KO / win pose plays on (the sim keeps stepping) ──> ~2.6 s later (epoch-guarded)
//       finish(): a MatchResult built ONLY from sim snapshots + events (G6: results numbers = sim) ──> menus.showResults
//       ──> rematch / character select / menu / next (THE SEASON)
//
// Rules this file keeps (doctrine + CONTRACT):
//   * pause GATES the step (loop.simEnabled = false discards the accumulator); window.__PAUSE__ = { pause, resume,
//     toggle } exists while a bout is loaded; ESC / pad START pause and NEVER destroy a bout; FORFEIT goes through the
//     same verdict path as a KO (finish() with forfeit = the player) and counts as that player's loss.
//   * online bouts never stop the sim (NETCODE 3.8): ESC opens the pause card while the session keeps ticking.
//   * every deferred callback (timers, awaited loads, menu promises) is guarded by `epoch`: a callback from a torn-down
//     bout can never touch the next one (doctrine §4: "an unguarded setTimeout(endMatch) nulled the NEXT match").
//   * hit-stop / super freeze / KO slow-mo are SIM counters; loop.timeScale stays 1.
//   * a page going hidden pauses an offline bout (touch: also pagehide / blur); nothing ever auto-resumes.
//
// Every call into another lane's module that CONTRACT §16 does not spell out lives in one small named adapter
// (drainEvents, devWrite, buildResult, onlineWire) so an integrator adapts one function, not the flow.

import { createMatch, step, readFighter, readMatch, checksum, devSet, type Match, type MatchCfg } from './core/sim/match.ts';
import { EV, EV_NAMES, eventsSince } from './core/sim/events.ts';
import type { FighterSnap, GameData, MatchSnap, SimEvent } from './core/types.ts';
import { createCpu, type Cpu } from './core/ai/cpu.ts';
import type { RollbackSession } from './core/net/rollback.ts';
import { createOnline, readOnlineParams, type Online } from './net/online.ts';
import { BoutView } from './view/bout.ts';
import type { Renderer } from './view/renderer.ts';
import type { Assets } from './view/assets.ts';
import { Hud } from './ui/hud.ts';
import type { Menus } from './ui/menus.ts';
import type { CardView, LadderView, MatchResult, MenuIntent, VsView } from './ui/types.ts';
import type { GameAudio } from './audio/index.ts';
import { GameLoop } from './app/loop.ts';
import { SeasonRun, type Flow, type SeasonRoster, type SlotKind } from './app/flow.ts';
import { enterFullscreenLandscape, type BootUI } from './ui/boot.ts';
import { viewSettings, type SettingsStore } from './ui/settings.ts';
import type { SaveStore } from './ui/save.ts';
import type { Input } from './input.ts';

/** after MATCH_END the KO slow-mo + win pose play this long (real ms) before the results card */
export const RESULTS_DELAY_MS = 2600;
/** rollback depth margin for the event reader (frames) */
const EVENT_MARGIN = 16;

export interface GameDeps {
  data: GameData;
  renderer: Renderer;
  assets: Assets;
  audio: GameAudio;
  menus: Menus;
  hudRoot: HTMLElement;
  input: Input;
  settings: SettingsStore;
  save: SaveStore;
  boot: BootUI;
  flow: Flow;
  version: string;
  dev: boolean;
}

export interface BoutCtx {
  /** skip the PRESS START card (menus start, ?autostart=1, dev.startMatch) */
  autostart?: boolean;
  season?: SeasonRun | null;
  online?: Online | null;
  local?: 0 | 1;
}

/** per-player numbers the results card shows, all from sim events / snapshots */
class BoutStats {
  damage: [number, number] = [0, 0];
  maxCombo: [number, number] = [0, 0];
  counters: [number, number] = [0, 0];
  punishes: [number, number] = [0, 0];
  perfectParries: [number, number] = [0, 0];
  throws: [number, number] = [0, 0];
  supers: [number, number] = [0, 0];
  wallSplats: [number, number] = [0, 0];
  score: [number, number] = [0, 0];
  rounds: Array<{ winner: 0 | 1 | -1; how: 'ko' | 'time' | 'perfect' | 'double' | 'draw' }> = [];
  private hp: [number, number] = [-1, -1];
  private roundKo: 'ko' | 'double' | null = null;
  private roundTime = false;

  /** per rendered frame: hp falls = damage dealt by the other player; combo peaks */
  frame(f: readonly [FighterSnap, FighterSnap]): void {
    for (const i of [0, 1] as const) {
      const hp = f[i].hp;
      if (this.hp[i] >= 0 && hp < this.hp[i]) this.damage[i === 0 ? 1 : 0] += this.hp[i] - hp;
      this.hp[i] = hp;
      if (f[i].combo > this.maxCombo[i]) this.maxCombo[i] = f[i].combo;
    }
  }

  /** player MatchStats (ui/types.ts) for the results card */
  player(i: 0 | 1): { damage: number; maxCombo: number; counters: number; punishes: number; perfectParries: number; throws: number; supers: number; wallSplats: number } {
    return { damage: this.damage[i], maxCombo: this.maxCombo[i], counters: this.counters[i], punishes: this.punishes[i],
      perfectParries: this.perfectParries[i], throws: this.throws[i], supers: this.supers[i], wallSplats: this.wallSplats[i] };
  }

  event(e: SimEvent, m: MatchSnap, f: readonly [FighterSnap, FighterSnap]): void {
    const a: 0 | 1 | null = e.a === 0 || e.a === 1 ? e.a : null;
    const b: 0 | 1 | null = e.b === 0 || e.b === 1 ? e.b : null;
    switch (e.type) {
      case EV.COUNTER: if (a !== null) this.counters[a]++; break;
      case EV.PUNISH: if (a !== null) this.punishes[a]++; break;
      case EV.PERFECT_PARRY: if (b !== null) this.perfectParries[b]++; break;     // §17.6: a attacker, b the parrier
      case EV.THROW: if (a !== null) this.throws[a]++; break;
      case EV.SUPER_FREEZE: if (a !== null) this.supers[a]++; break;
      case EV.WALL_SPLAT: if (a !== null) this.wallSplats[a === 0 ? 1 : 0]++; break;   // a = the victim
      case EV.SCORE: if (a !== null) this.score[a] += Math.max(0, e.b | 0); break;
      case EV.KO: this.roundKo = e.a < 0 && e.b < 0 ? 'double' : 'ko'; break;
      case EV.TIMEOVER: this.roundTime = true; break;
      case EV.ROUND_END: {
        const w: 0 | 1 | null = m.roundWinner === 0 || m.roundWinner === 1 ? m.roundWinner : null;
        let how: 'ko' | 'time' | 'perfect' | 'double' | 'draw' = this.roundKo === 'double' ? 'double' : this.roundTime ? 'time' : 'ko';
        if (w === null && how !== 'double') how = 'draw';
        if (w !== null && how === 'ko' && f[w].hp >= f[w].hpMax) how = 'perfect';
        this.rounds.push({ winner: w ?? -1, how });
        this.roundKo = null;
        this.roundTime = false;
        break;
      }
      default: break;
    }
  }
}

interface Bout {
  epoch: number;
  cfg: MatchCfg;
  m: Match;
  view: BoutView;
  cpus: [Cpu | null, Cpu | null];
  online: Online | null;
  session: RollbackSession | null;
  local: 0 | 1;
  season: SeasonRun | null;
  stats: BoutStats;
  /** dedupe keys "frame:type:a:b" -> frame */
  seen: Map<string, number>;
  lastFrame: number;
  /** MATCH_END seen */
  over: boolean;
  /** finish() ran (results showing or shown) */
  finished: boolean;
  pausedBy: 0 | 1;
  pauseSeq: number;
  lastSnap: MatchSnap | null;
  lastFighters: [FighterSnap, FighterSnap] | null;
  stalls: number;
}

/** a logged event for __HP__.events(n) */
export interface LoggedEvent extends SimEvent { typeName: string }

const clampLevel = (v: number): number => Math.max(0, Math.min(8, Math.round(v)));

export class Game {
  readonly d: GameDeps;
  readonly loop: GameLoop;
  readonly hud: Hud;
  bout: Bout | null = null;
  season: SeasonRun | null = null;
  online: Online | null = null;
  /** bumps on every bout start / teardown: deferred callbacks compare it */
  epoch = 0;
  /** dev freeze (__HP__.dev.freeze): the sim holds even in phase 'bout' */
  frozen = false;
  private readonly words: [number, number] = [0, 0];
  private readonly evBuf: SimEvent[] = [];
  private readonly fresh: SimEvent[] = [];
  private readonly log: LoggedEvent[] = [];
  private readonly offs: Array<() => void> = [];
  private pauseApi: { pause(): void; resume(): void; toggle(): void } | null = null;
  fps = 0;
  private fpsAcc = 0;
  private fpsN = 0;

  constructor(d: GameDeps) {
    this.d = d;
    this.hud = new Hud(d.hudRoot, d.data);
    this.loop = new GameLoop(() => this.tick(), (_a, dt) => this.frame(dt));
    this.loop.simEnabled = false;
    this.loop.onError = (e) => this.crash(e);
    d.menus.onIntent((i) => { void this.intent(i); });
    this.offs.push(d.input.onUi((a, p) => { if (a === 'pause') this.onPauseKey(p); }));
    const onHidden = (): void => { if (document.visibilityState === 'hidden') this.autoPause('hidden'); };
    const onPageHide = (): void => this.autoPause('pagehide');
    const onBlur = (): void => { if (d.input.mode === 'touch') this.autoPause('blur'); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onBlur);
    this.offs.push(() => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('blur', onBlur);
    });
    this.offs.push(d.settings.on((s, keys) => {
      if (this.bout && (keys.includes('gore') || keys.includes('screenShake') || keys.includes('reduceFlashing') || keys.includes('cinematics') || keys.includes('bloom'))) {
        this.bout.view.setSettings(viewSettings(s));
      }
    }));
  }

  start(): void { this.loop.start(); }

  get phase(): string { return this.d.flow.phase; }

  // ───────────────────────────── intents ─────────────────────────────
  async intent(i: MenuIntent): Promise<void> {
    try {
      switch (i.kind) {
        case 'startMatch': await this.startBout(i.cfg as MatchCfg, { autostart: true }); break;
        case 'training': await this.startBout(i.cfg as MatchCfg, { autostart: true }); break;
        case 'startSeason': await this.startSeason(i); break;
        case 'online': await this.onlineAction(i.action, i.code, i.name); break;
        case 'onlinePick': this.online?.pick({ fighter: i.fighter, color: i.color, scheme: i.scheme }); break;
        case 'quitToTitle': this.toMenus('title'); break;
        default: break;
      }
    } catch (e) {
      this.crash(e);
    }
  }

  // ───────────────────────────── bouts ─────────────────────────────
  /** load a bout (loading card) -> PRESS START (or straight in with ctx.autostart) */
  async startBout(cfg: MatchCfg, ctx: BoutCtx = {}): Promise<void> {
    const d = this.d;
    this.teardown();
    const my = ++this.epoch;
    d.flow.mode = cfg.mode;
    d.flow.go('loading', 'bout ' + cfg.mode);
    d.menus.hide();
    d.boot.setMode(cfg.mode);
    d.boot.showLoading(`${cfg.p[0].fighter.toUpperCase()} vs ${cfg.p[1].fighter.toUpperCase()}`);
    d.boot.progress(0.1);
    const view = await BoutView.create(d.renderer, d.assets, cfg, d.data);
    if (my !== this.epoch) { view.dispose(); return; }
    d.boot.progress(0.9, 'Warming up the cameras...');
    view.setSettings(viewSettings(d.settings.get()));
    const m = createMatch(cfg, d.data);
    const local: 0 | 1 = ctx.local ?? 0;
    const cpus: [Cpu | null, Cpu | null] = [null, null];
    for (const p of [0, 1] as const) {
      const lv = cfg.p[p].cpu;
      if (!ctx.online && typeof lv === 'number' && lv >= 0) cpus[p] = createCpu(clampLevel(lv), cfg.p[p].fighter, (cfg.seed ^ (0x9e3779b9 * (p + 1))) >>> 0);
    }
    const session = ctx.online ? ctx.online.attach(m) : null;
    this.hud.mount(cfg);
    this.hud.setNames([this.nameOf(cfg.p[0].fighter), this.nameOf(cfg.p[1].fighter)]);
    d.menus.setMoveList(cfg.p[local].fighter, cfg.p[local].scheme);
    this.bout = {
      epoch: my, cfg, m, view, cpus, online: ctx.online ?? null, session, local, season: ctx.season ?? null, stats: new BoutStats(),
      seen: new Map(), lastFrame: 0, over: false, finished: false, pausedBy: local, pauseSeq: 0, lastSnap: null, lastFighters: null, stalls: 0,
    };
    this.installPauseApi();
    try { d.audio.preload([cfg.stage, cfg.p[0].fighter, cfg.p[1].fighter]); } catch (e) { console.warn('[hit-parade] audio.preload', e); }
    try { d.audio.music(cfg.p[1].fighter === 'ricky' || cfg.p[0].fighter === 'ricky' ? 'boss' : cfg.stage); } catch { /* audio is optional */ }
    d.boot.progress(1, 'Ready');
    // the first picture behind the card: the posed intro frame
    this.frame(0);
    if (ctx.autostart || ctx.online) this.enterBout('auto');
    else {
      d.flow.go('ready', 'press start');
      d.boot.showPlay((via) => {
        if (my !== this.epoch) return;
        void d.audio.unlock();
        if (d.input.mode === 'touch' && via === 'click') enterFullscreenLandscape();
        this.enterBout(via);
      });
    }
  }

  /** the bout starts stepping */
  private enterBout(why: string): void {
    const b = this.bout;
    if (!b) return;
    this.d.boot.hide();
    this.d.menus.hide();
    this.d.flow.go('bout', why);
    this.d.input.releaseAll();
    this.d.input.live = true;
    this.loop.simEnabled = !this.frozen;
  }

  /** one sim frame (60 Hz, from the loop) */
  private tick(): void {
    const b = this.bout;
    if (!b) return;
    const w = this.d.input.sampleAll(this.words);
    if (b.session) {
      const r = b.session.tick(w[b.local]);
      if (r.stalled) b.stalls++;
      return;
    }
    const in1 = b.cpus[0] ? b.cpus[0].input(b.m, 0) : w[0];
    const in2 = b.cpus[1] ? b.cpus[1].input(b.m, 1) : w[1];
    step(b.m, in1, in2);
  }

  /** run n sim frames right now (dev.step while frozen); returns frames stepped */
  stepFrames(n: number): number {
    if (!this.bout) return 0;
    return this.loop.stepSync(n);
  }

  // ───────────────────────────── the rendered frame ─────────────────────────────
  private frame(dt: number): void {
    const d = this.d;
    const ms = dt * 1000;
    if (dt > 0) {
      this.fpsAcc += ms; this.fpsN++;
      if (this.fpsAcc >= 500) { this.fps = (this.fpsN * 1000) / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    }
    const b = this.bout;
    if (!b) return;          // menus: the menus drive the Showcase themselves (ui/menus.ts update loop)
    const r = d.renderer;
    r.beginFrame();
    if (ms > 0) r.frameTime(ms, d.flow.phase === 'bout');
    const snap = readMatch(b.m);
    const f: [FighterSnap, FighterSnap] = [readFighter(b.m, 0), readFighter(b.m, 1)];
    const evs = this.drainEvents(b, snap.frame);
    b.stats.frame(f);
    for (const e of evs) {
      b.stats.event(e, snap, f);
      if (e.type === EV.ROUND_END && b.online) b.online.roundBreak();
      if (e.type === EV.MATCH_END) this.onMatchEnd(b, snap);
    }
    b.lastSnap = snap;
    b.lastFighters = f;
    b.view.frame(snap, f, evs, dt);
    this.hud.frame(snap, f, evs);
    try { d.audio.events(evs, snap); } catch (e) { console.warn('[hit-parade] audio.events', e); }
    b.view.render();
  }

  /** NEW events since the last rendered frame (§18.1 eventsSince + dedupe; rollback re-emits) */
  private drainEvents(b: Bout, frame: number): SimEvent[] {
    const buf = this.evBuf;
    const out = this.fresh;
    buf.length = 0;
    out.length = 0;
    eventsSince(b.m.events, Math.max(0, b.lastFrame - EVENT_MARGIN), buf);
    for (const e of buf) {
      const key = `${e.frame}:${e.type}:${e.a}:${e.b}`;
      if (b.seen.has(key)) continue;
      b.seen.set(key, e.frame);
      out.push(e);
      this.log.push({ ...e, typeName: EV_NAMES[e.type] ?? `EV${e.type}` });
      if (this.log.length > 512) this.log.splice(0, this.log.length - 512);
    }
    if (frame - b.lastFrame > 0 && b.seen.size > 512) {
      for (const [k, fr] of b.seen) if (fr < frame - 128) b.seen.delete(k);
    }
    b.lastFrame = Math.max(b.lastFrame, frame);
    return out;
  }

  private onMatchEnd(b: Bout, snap: MatchSnap): void {
    if (b.over) return;
    b.over = true;
    const winner: -1 | 0 | 1 = snap.winner === 0 || snap.winner === 1 ? snap.winner : -1;
    if (b.online) {
      // online: RESULT agreement first (online 'matchEnd' calls finish); the session keeps ticking meanwhile
      b.online.finish({ winner, frame: snap.frame, checksum: checksum(b.m) });
      return;
    }
    const my = b.epoch;
    window.setTimeout(() => {
      if (my !== this.epoch || !this.bout || this.bout.finished) return;
      void this.finish(winner, snap.draw ? 'draw' : null, -1);
    }, RESULTS_DELAY_MS);
  }

  // ───────────────────────────── results (the ONE verdict path) ─────────────────────────────
  /**
   * The verdict path: a KO / time-out, a FORFEIT (forfeit = the player who gave up; the other wins) and an online
   * disconnect all end here. Stops the sim, builds the MatchResult from the sim, shows the results card.
   */
  async finish(winner: -1 | 0 | 1, reason: 'draw' | 'disconnect' | 'forfeit' | null, forfeit: -1 | 0 | 1): Promise<void> {
    const b = this.bout;
    if (!b || b.finished) return;
    b.finished = true;
    const d = this.d;
    const my = b.epoch;
    if (forfeit >= 0) winner = forfeit === 0 ? 1 : 0;
    if (!b.online) this.loop.simEnabled = false;
    d.input.live = false;
    d.input.releaseAll();
    if (d.flow.phase !== 'results') d.flow.go('results', forfeit >= 0 ? 'forfeit' : reason ?? 'match end');
    const result = this.buildResult(b, winner, reason, forfeit);
    let choice: 'rematch' | 'charselect' | 'menu' | 'next';
    try {
      choice = await d.menus.showResults(result);
    } catch (e) {
      console.error('[hit-parade] results card', e);
      choice = 'menu';
    }
    if (my !== this.epoch) return;
    await this.afterResults(b, result, choice);
  }

  /** MatchResult (CONTRACT §18.3, ui/types.ts) from sim snapshots + events only (CONTRACT §13 G6 "results = sim") */
  private buildResult(b: Bout, winner: -1 | 0 | 1, reason: 'draw' | 'disconnect' | 'forfeit' | null, forfeit: -1 | 0 | 1): MatchResult {
    const snap = b.lastSnap ?? readMatch(b.m);
    const f = b.lastFighters ?? [readFighter(b.m, 0), readFighter(b.m, 1)];
    const s = b.stats;
    const r: MatchResult = {
      cfg: b.cfg, winner, wins: [snap.wins[0] ?? 0, snap.wins[1] ?? 0], frames: snap.frame, forfeit, fighters: [f[0], f[1]], match: snap,
      stats: [s.player(0), s.player(1)], names: [this.nameOf(b.cfg.p[0].fighter), this.nameOf(b.cfg.p[1].fighter)],
    };
    const run = b.season;
    const slot = run?.current() ?? null;
    if (run && slot) {
      const score = this.episodeScore(b, winner);
      const bonus = slot.kind === 'brawl' || slot.kind === 'heckler';
      r.score = score;
      r.season = { slot: run.index, slots: run.slots.length, kind: slot.kind, opponent: slot.opponent ?? '',
        cleared: (winner === 0 || bonus) && run.index === run.slots.length - 1, continues: run.continues };
    }
    if (b.online) { r.rated = false; r.disconnect = reason === 'disconnect'; }
    return r;
  }

  /**
   * THE SEASON episode score (provisional: FIGHTING_DESIGN leaves the arcade formula open). Bonus rounds = the sum of
   * the sim's SCORE events for P1. Bouts: 1000 per round won, + damage dealt, + 100 x best combo, + 300 per counter /
   * punish counter, + 500 per perfect parry, + 5000 for the win. Every term is a sim number.
   */
  private episodeScore(b: Bout, winner: -1 | 0 | 1): number {
    const s = b.stats;
    const slot = b.season?.current();
    if (slot && (slot.kind === 'brawl' || slot.kind === 'heckler')) return s.score[0];
    const snap = b.lastSnap ?? readMatch(b.m);
    return (snap.wins[0] ?? 0) * 1000 + s.damage[0] + 100 * s.maxCombo[0] + 300 * (s.counters[0] + s.punishes[0]) + 500 * s.perfectParries[0]
      + (winner === 0 ? 5000 : 0) + s.score[0];
  }

  private async afterResults(b: Bout, r: MatchResult, choice: 'rematch' | 'charselect' | 'menu' | 'next'): Promise<void> {
    if (b.online) {
      if (choice === 'rematch') { b.online.rematch(true); return; }      // the next 'matchStart' starts it
      b.online.rematch(false);
      b.online.leave();
      this.toMenus('main');
      return;
    }
    const run = b.season;
    if (run) { await this.seasonAfter(run, r, choice); return; }
    if (choice === 'rematch') { await this.startBout({ ...b.cfg, seed: (b.cfg.seed + 1) >>> 0 }, { autostart: true }); return; }
    if (choice === 'charselect') { this.toMenus('charselect', { mode: b.cfg.mode === 'training' ? 'training' : 'versus' }); return; }
    this.toMenus('main');
  }

  // ───────────────────────────── pause ─────────────────────────────
  private onPauseKey(p: 0 | 1): void {
    const ph = this.d.flow.phase;
    if (ph === 'bout' && this.bout && !this.bout.finished) this.pause('key', p);
  }

  private autoPause(why: string): void {
    const b = this.bout;
    if (!b || b.online || b.finished || this.d.flow.phase !== 'bout') return;
    this.pause(why, b.local);
  }

  /** ESC / pad START / __PAUSE__ / page hidden: the pause card; the bout is NEVER destroyed here */
  pause(why: string, by: 0 | 1 = 0): void {
    const b = this.bout;
    const d = this.d;
    if (!b || b.finished || d.flow.phase !== 'bout') return;
    b.pausedBy = by;
    const seq = ++b.pauseSeq;
    if (!b.online) this.loop.simEnabled = false;          // online: the session keeps ticking (NETCODE 3.8) ...
    d.input.live = false;                                 // ... with neutral words: the card's keys never move the fighter
    d.input.releaseAll();
    d.flow.go('paused', why);
    void this.pauseCard(b, seq);
  }

  private async pauseCard(b: Bout, seq: number): Promise<void> {
    const d = this.d;
    let choice: 'resume' | 'settings' | 'forfeit' | 'movelist';
    try {
      choice = await d.menus.showPause({ training: b.cfg.mode === 'training', online: !!b.online, fighter: b.cfg.p[b.pausedBy].fighter,
        scheme: b.cfg.p[b.pausedBy].scheme });
    } catch (e) {
      console.error('[hit-parade] pause card', e);
      choice = 'resume';
    }
    if (b !== this.bout || seq !== b.pauseSeq || d.flow.phase !== 'paused') return;   // stale card (resumed / torn down)
    if (choice === 'resume') { this.resume(); return; }
    if (choice === 'forfeit') { void this.forfeit(b.pausedBy); return; }
    // settings / move list: a sub-screen of the pause card; backing out re-opens the card (CONTRACT §18.3)
    d.menus.show(choice, {
      from: 'pause', fighter: b.cfg.p[b.pausedBy].fighter, scheme: b.cfg.p[b.pausedBy].scheme,
      onClose: () => { if (b === this.bout && seq === b.pauseSeq && d.flow.phase === 'paused') void this.pauseCard(b, ++b.pauseSeq); },
    });
  }

  resume(): void {
    const b = this.bout;
    const d = this.d;
    if (!b || d.flow.phase !== 'paused') return;
    b.pauseSeq++;
    d.menus.hide();
    d.flow.go('bout', 'resume');
    d.input.releaseAll();
    d.input.live = true;
    this.loop.simEnabled = !this.frozen;
  }

  /** forfeit = a loss for `who` through the verdict path */
  async forfeit(who: 0 | 1): Promise<void> {
    const b = this.bout;
    if (!b || b.finished) return;
    if (b.online) b.online.leave();
    await this.finish(who === 0 ? 1 : 0, 'forfeit', who);
  }

  private installPauseApi(): void {
    const api = {
      pause: () => this.pause('api', this.bout?.local ?? 0),
      resume: () => this.resume(),
      toggle: () => (this.d.flow.phase === 'paused' ? this.resume() : this.pause('api', this.bout?.local ?? 0)),
    };
    this.pauseApi = api;
    (window as unknown as { __PAUSE__?: unknown }).__PAUSE__ = api;
  }

  private removePauseApi(): void {
    const w = window as unknown as { __PAUSE__?: unknown };
    if (this.pauseApi && w.__PAUSE__ === this.pauseApi) delete w.__PAUSE__;
    this.pauseApi = null;
  }

  // ───────────────────────────── THE SEASON ─────────────────────────────
  private roster(): SeasonRoster {
    const f = this.d.data.fighters;
    const ids = Object.keys(f);
    return {
      playable: ids.filter((id) => id !== 'freak' && id !== 'ricky'),
      miniboss: 'freak', boss: 'ricky',
      rival: (id) => {
        const r = f[id]?.rival;
        return typeof r === 'string' && r && r !== '-' && f[r] ? r : null;
      },
    };
  }

  /** stage id for a slot: the slot's own, else the opponent's home stage, else the first stage in stages.json */
  private stageFor(opponent: string | null, fallback: string): string {
    const f = opponent ? this.d.data.fighters[opponent] : null;
    const st = f?.stage;
    return typeof st === 'string' && st ? st : fallback;
  }

  private firstStage(): string {
    const s = this.d.data.stages as unknown;
    if (Array.isArray(s)) { const x = s[0] as { id?: string } | undefined; if (x?.id) return x.id; }
    if (s && typeof s === 'object') {
      const o = s as Record<string, unknown>;
      if (Array.isArray(o.stages)) { const x = o.stages[0] as { id?: string } | undefined; if (x?.id) return x.id; }
      const k = Object.keys(o).find((key) => key !== 'stages' && !key.startsWith('$') && key !== 'version');
      if (k) return k;
    }
    return 'rust_theater';
  }

  async startSeason(i: Extract<MenuIntent, { kind: 'startSeason' }>): Promise<void> {
    // the menus' difficulty is an index (0 EASY, 1 NORMAL, 2 HARD; data/strings diff.*) -> the ladder shift -2 / 0 / +2
    const shift = Math.max(-2, Math.min(2, (Math.round(Number(i.difficulty) || 0) - 1) * 2));
    const seed = (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0;
    this.season = new SeasonRun({ fighter: i.fighter, color: i.color, scheme: i.scheme, length: i.length, difficulty: shift, seed }, this.roster(), this.d.data.ladder);
    this.d.flow.mode = 'arcade';
    await this.seasonSlot(this.season);
  }

  private seasonScore(run: SeasonRun): number {
    return (run as SeasonRun & { score?: number }).score ?? 0;
  }

  private async seasonSlot(run: SeasonRun): Promise<void> {
    const d = this.d;
    const my = ++this.epoch;
    this.teardown(false);
    const slot = run.current();
    if (!slot) { await this.seasonCleared(run); return; }
    if (d.flow.phase !== 'menu') d.flow.go('menu', 'season ladder');
    d.flow.setScreen('ladder');
    d.boot.hide();
    const init = run.init;
    const lv: LadderView = {
      fighter: init.fighter, color: init.color, length: init.length,
      bouts: run.slots.map((s, k) => ({ kind: s.kind, opponent: s.opponent ?? undefined, result: k < run.index ? 'won' : null })),
      current: run.index, score: this.seasonScore(run),
    };
    const go = await d.menus.showLadder(lv);
    if (my !== this.epoch) return;
    if (go === 'quit') { this.season = null; this.toMenus('main'); return; }
    const bonus = slot.kind === 'brawl' || slot.kind === 'heckler';
    if (slot.kind !== 'bout') {
      const card: CardView = { kind: slot.kind as Exclude<SlotKind, 'bout'>, a: init.fighter, b: slot.opponent ?? undefined };
      await d.menus.showCard(card);
      if (my !== this.epoch) return;
    }
    const opp = slot.opponent ?? init.fighter;
    const stage = slot.stage ?? this.stageFor(slot.opponent, this.firstStage());
    const cfg: MatchCfg = {
      mode: slot.kind === 'brawl' ? 'brawl' : slot.kind === 'heckler' ? 'heckler' : 'arcade',
      stage, seed: run.slotSeed(),
      p: [
        { fighter: init.fighter, color: init.color, scheme: init.scheme, cpu: -1 },
        { fighter: opp, color: opp === init.fighter ? (init.color === 0 ? 1 : 0) : 0, scheme: 0, cpu: bonus ? 0 : slot.level },
      ],
    };
    if (!bonus) {
      const vs: VsView = { p: [{ fighter: cfg.p[0].fighter, color: cfg.p[0].color }, { fighter: cfg.p[1].fighter, color: cfg.p[1].color }],
        stage, mode: 'arcade', episode: slot.episode, kind: slot.kind };
      await d.menus.showVs(vs);
      if (my !== this.epoch) return;
    }
    await this.startBout(cfg, { autostart: true, season: run });
  }

  private async seasonAfter(run: SeasonRun, r: MatchResult, choice: 'rematch' | 'charselect' | 'menu' | 'next'): Promise<void> {
    const won = r.winner === 0;
    const scored = run as SeasonRun & { score?: number };
    if (choice === 'menu' || choice === 'charselect') {
      this.season = null;
      this.toMenus(choice === 'menu' ? 'main' : 'charselect', choice === 'charselect' ? { mode: 'season' } : undefined);
      return;
    }
    const slot = run.current();
    const bonus = !!slot && (slot.kind === 'brawl' || slot.kind === 'heckler');
    if (won || bonus) {
      scored.score = (scored.score ?? 0) + (r.score ?? 0);
      run.record(true);
      await this.seasonSlot(run);
      return;
    }
    // a loss: CONTINUE (the same slot; the episode's ratings do not carry) or leave
    run.record(false);
    if (choice === 'rematch' || choice === 'next') { run.continueSlot(); await this.seasonSlot(run); return; }
    this.season = null;
    this.toMenus('main');
  }

  private async seasonCleared(run: SeasonRun): Promise<void> {
    const d = this.d;
    const my = this.epoch;
    const score = this.seasonScore(run);
    const init = run.init;
    let name = d.save.get().onlineName;
    try {
      const n = await d.menus.showNameEntry({ score, fighter: init.fighter });
      if (typeof n === 'string' && n.trim()) name = n;
    } catch (e) { console.warn('[hit-parade] name entry', e); }
    if (my !== this.epoch) return;
    const res = d.save.recordClear({ fighter: init.fighter, length: init.length, difficulty: init.difficulty, score, name });
    this.season = null;
    try { await d.menus.showEnding({ fighter: init.fighter, score, unlocked: res.unlocked }); } catch (e) { console.warn('[hit-parade] ending', e); }
    if (my !== this.epoch) return;
    this.toMenus('title');
  }

  // ───────────────────────────── online ─────────────────────────────
  ensureOnline(): Online {
    if (this.online) return this.online;
    const d = this.d;
    const o = createOnline({ data: d.data as unknown as Parameters<typeof createOnline>[0]['data'], version: d.version, settings: d.settings,
      save: d.save, name: d.save.get().onlineName || undefined, forceRelay: readOnlineParams().relay });
    this.onlineWire(o);
    this.online = o;
    return o;
  }

  /** NET §19.4 events -> menus / bouts (the one adapter for the online flow) */
  private onlineWire(o: Online): void {
    const d = this.d;
    o.on('status', (s) => d.menus.setOnlineStatus(s as unknown as Parameters<Menus['setOnlineStatus']>[0]));
    o.on('error', (e) => d.menus.setOnlineStatus(e as unknown as Parameters<Menus['setOnlineStatus']>[0]));
    o.on('select', (() => { d.menus.show('charselect', { mode: 'online', opponent: 'human' }); }) as (p: never) => void);
    o.on('reveal', ((p: { picks?: Array<{ fighter: string; color: number; scheme: 0 | 1 }> }) => {
      const other = p?.picks?.[o.local === 0 ? 1 : 0];
      if (other) d.menus.revealOpponent({ fighter: other.fighter, color: other.color, scheme: other.scheme });
    }) as unknown as (p: never) => void);
    o.on('matchStart', (cfg, local) => { void this.startBout(cfg, { online: o, local, autostart: true }).catch((e) => this.crash(e)); });
    o.on('matchEnd', (r) => {
      const b = this.bout;
      if (!b || b.online !== o) return;
      void this.finish(r.winner, r.reason === 'disconnect' ? 'disconnect' : null, -1);
    });
    o.on('disconnect', (r) => {
      const b = this.bout;
      if (!b || b.online !== o || b.finished) return;
      void this.finish(r.winner, 'disconnect', -1);
    });
  }

  private async onlineAction(action: 'quick' | 'create' | 'join' | 'cancel', code?: string, name?: string): Promise<void> {
    if (action === 'cancel') { this.online?.leave(); return; }
    if (name) this.d.save.setOnlineName(name);
    const o = this.ensureOnline();
    this.d.flow.mode = 'online';
    if (action === 'quick') await o.quick();
    else if (action === 'create') await o.create();
    else if (action === 'join' && code) await o.join(code);
  }

  // ───────────────────────────── navigation ─────────────────────────────
  /** tear the bout down (view, HUD, pause API); epoch++ so every deferred callback of it dies */
  teardown(bump = true): void {
    const b = this.bout;
    if (bump) this.epoch++;
    this.loop.simEnabled = false;
    this.d.input.live = false;
    this.d.input.releaseAll();
    this.removePauseApi();
    if (!b) return;
    this.bout = null;
    try { this.hud.unmount(); } catch (e) { console.warn('[hit-parade] hud.unmount', e); }
    try { b.view.dispose(); } catch (e) { console.warn('[hit-parade] view.dispose', e); }
  }

  /** back to a menu screen (title / main / charselect ...) */
  toMenus(screen: Parameters<Menus['show']>[0], params?: unknown): void {
    const d = this.d;
    this.teardown();
    const ph = d.flow.phase;
    const to = screen === 'title' ? 'title' : 'menu';
    if (ph !== to || to === 'menu') d.flow.go(to, 'to ' + screen);
    d.flow.setScreen(screen);
    d.flow.mode = 'none';
    d.boot.hide();
    try { d.renderer.three.setClearColor(0x140d1f, 1); d.renderer.three.clear(); } catch { /* context lost */ }
    d.menus.show(screen, params);
  }

  /** a thrown error anywhere in the flow: the error card, never a blank canvas */
  crash(e: unknown): void {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    console.error('[hit-parade] crash', e);
    this.loop.simEnabled = false;
    this.d.input.live = false;
    this.d.flow.fail(msg);
    try { this.d.menus.hide(); } catch { /* ignore */ }
    this.d.boot.error('HIT PARADE hit a snag', msg);
  }

  private nameOf(id: string): string {
    const f = this.d.data.fighters[id];
    return (f && typeof f.name === 'string' && f.name) || id.toUpperCase();
  }

  // ───────────────────────────── test surface read-backs + dev hooks ─────────────────────────────
  matchInfo(): Record<string, unknown> | null {
    const b = this.bout;
    if (!b) return null;
    const s = readMatch(b.m);
    return { ...s, simFrame: b.m.frame(), checksum: checksum(b.m) >>> 0, mode: b.cfg.mode, stage: b.cfg.stage, seed: b.cfg.seed,
      p: b.cfg.p, over: b.over, finished: b.finished, online: !!b.online, stalls: b.stalls, stats: { ...b.stats, rounds: b.stats.rounds } };
  }

  fighters(): unknown[] | null {
    const b = this.bout;
    return b ? [readFighter(b.m, 0), readFighter(b.m, 1)] : null;
  }

  events(n: number): LoggedEvent[] { return this.log.slice(-n); }

  /** CONTRACT §18.2 dev writes (hp / showtime / nerve); throws outside a bout */
  devWrite(p: 0 | 1, key: 'hp' | 'showtime' | 'nerve', v: number): void {
    const b = this.bout;
    if (!b) throw new Error('no bout loaded');
    devSet(b.m, p, key, Math.round(v));
  }

  setCpu(p: 0 | 1, level: number): void {
    const b = this.bout;
    if (!b) throw new Error('no bout loaded');
    if (b.online) throw new Error('no CPU in an online bout');
    b.cpus[p] = level >= 0 ? createCpu(clampLevel(level), b.cfg.p[p].fighter, (b.cfg.seed ^ (0x85ebca6b * (p + 1))) >>> 0) : null;
  }

  setFrozen(on: boolean): void {
    this.frozen = on;
    if (this.d.flow.phase === 'bout') this.loop.simEnabled = !on;
  }

  /** dev.startMatch: any partial cfg; defaults johnny vs bruno at the first stage, P2 = CPU 1 */
  devStart(raw: unknown): Promise<void> {
    const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<MatchCfg> & { p?: Array<Partial<MatchCfg['p'][0]>> };
    const ids = Object.keys(this.d.data.fighters);
    const pl = (i: 0 | 1, dflt: string, cpu: number): MatchCfg['p'][0] => {
      const q = (o.p?.[i] ?? {}) as Partial<MatchCfg['p'][0]>;
      return { fighter: typeof q.fighter === 'string' ? q.fighter : dflt, color: typeof q.color === 'number' ? q.color : 0,
        scheme: q.scheme === 1 ? 1 : 0, cpu: typeof q.cpu === 'number' ? q.cpu : cpu };
    };
    const cfg: MatchCfg = {
      mode: (o.mode as MatchCfg['mode']) ?? 'versus', stage: typeof o.stage === 'string' ? o.stage : this.firstStage(),
      seed: typeof o.seed === 'number' ? o.seed >>> 0 : 1,
      p: [pl(0, ids.includes('johnny') ? 'johnny' : ids[0], -1), pl(1, ids.includes('bruno') ? 'bruno' : ids[1] ?? ids[0], 1)],
      ...(typeof o.rounds === 'number' ? { rounds: o.rounds } : {}), ...(typeof o.timer === 'number' ? { timer: o.timer } : {}),
    };
    return this.startBout(cfg, { autostart: true });
  }

  dispose(): void {
    this.teardown();
    this.loop.stop();
    for (const f of this.offs) { try { f(); } catch { /* ignore */ } }
    this.offs.length = 0;
    this.online?.leave();
  }
}
