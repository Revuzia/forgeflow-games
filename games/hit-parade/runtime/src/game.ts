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
import type { TouchControls } from './touch/controls.ts';
import { hasAssets, playableStage } from './ui/data.ts';
import type { PortraitQueue } from './app/portraits.ts';
// CHANGED(integrator) P2: the TRAINING driver (UI §27.1) and the fight camera's projection for its HITBOX overlay
import { TrainingDriver } from './ui/trainer.ts';
import { Vector3 } from 'three';

/** after MATCH_END the KO slow-mo + win pose play this long (real ms) before the results card */
export const RESULTS_DELAY_MS = 2600;
/**
 * CHANGED(integrator) P2: the sim runs BRAWL BREAK / HECKLER TOSS (SIM §28.4, core/sim/brawl.ts; probe_brawl 52/52,
 * probe_season S3 12/12 fighters), so THE SEASON plays its bonus slots: BRAWL BREAK after bout 3 and HECKLER TOSS after
 * bout 6 (PILOT: BRAWL BREAK after bout 2), as data/ladder.json lays them out. (P1: false = the slots were skipped.)
 */
export const BONUS_ROUNDS_IN_SIM = true;
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
  /** CHANGED(integrator): the touch overlay (lane UI touch/controls.ts, CONTRACT_MOBILE M2); shown in touch mode while a
   *  bout steps, fed the local player's meters each frame. Optional (labs / kbm-only pages pass nothing). */
  touch?: TouchControls | null;
  /** CHANGED(integrator): fighter portraits for the HUD / menus (app/portraits.ts over VIEW's Showcase.portrait) */
  portraits?: PortraitQueue | null;
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
  /** CHANGED(fixer) D8: the round's winner + PERFECT, captured on the KO / TIME OVER frame (the sim decides the round
   *  there). ROUND_END is one sim frame before the next ROUND_INTRO resets MatchSnap.roundWinner and refills HP, and a
   *  rendered frame often holds both, so reading them at ROUND_END recorded KO rounds as {winner: -1, how: 'draw'}. */
  private pending: { winner: 0 | 1 | -1; perfect: boolean } | null = null;

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
      case EV.KO: case EV.TIMEOVER: {
        if (e.type === EV.KO) { if (this.roundKo) break; this.roundKo = e.a < 0 && e.b < 0 ? 'double' : 'ko'; }
        else this.roundTime = true;
        // MatchSnap.roundWinner is set on this frame (0 | 1, 2 = draw); the event payload is the fallback
        const rw = m.roundWinner === 0 || m.roundWinner === 1 || m.roundWinner === 2 ? m.roundWinner : e.a;
        const w: 0 | 1 | -1 = rw === 0 || rw === 1 ? rw : -1;
        const wf = w === 0 || w === 1 ? f[w] : null;
        this.pending = { winner: w, perfect: !!wf && wf.hpMax > 0 && wf.hp >= wf.hpMax };
        break;
      }
      case EV.ROUND_END: {
        // ROUND_END a = the round winner (0 | 1, 2 = draw) straight from the sim state (rounds.ts roundEndStep)
        const wEv: 0 | 1 | -1 = e.a === 0 || e.a === 1 ? e.a : -1;
        const w = this.pending ? this.pending.winner : wEv;
        let how: 'ko' | 'time' | 'perfect' | 'double' | 'draw' = this.roundKo === 'double' ? 'double' : this.roundTime ? 'time' : 'ko';
        if (w < 0 && how !== 'double') how = 'draw';
        if (w >= 0 && how === 'ko' && this.pending?.perfect) how = 'perfect';
        this.rounds.push({ winner: w, how });
        this.roundKo = null;
        this.roundTime = false;
        this.pending = null;
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
  /** CHANGED(integrator) P2 (UI §27.1): the TRAINING driver of a training bout (dummy, record / playback, resets,
   *  frame data, hitboxes); null in every other mode */
  trainer: TrainingDriver | null;
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
    // CHANGED(integrator): a pause key that pauses CONSUMES its event (preventDefault). Input listens in the capture
    // phase, so without this the same ESC keydown reached the menus' bubble-phase handler right after showPause() had
    // rendered the card, and ESC-on-the-card = resume: the bout never stayed paused (measured: phase stayed 'bout').
    this.offs.push(d.input.onUi((a, p, e) => { if (a === 'pause' && this.onPauseKey(p)) e?.preventDefault(); }));
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
      if (keys.includes('gore')) { try { d.audio.setSplatter(s.gore); } catch { /* audio is optional */ } }
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
    // CHANGED(integrator): a `todo` stage (no GLB yet, §21.1) plays on the first built stage - never the view's stand-in set
    const stage = playableStage(d.data as unknown as Parameters<typeof playableStage>[0], cfg.stage);
    if (stage !== cfg.stage) cfg = { ...cfg, stage };
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
    d.portraits?.need(cfg.p[0].fighter);                  // HUD portraits (both GLBs are loaded now)
    d.portraits?.need(cfg.p[1].fighter);
    const m = createMatch(cfg, d.data);
    const local: 0 | 1 = ctx.local ?? 0;
    // CHANGED(integrator) P2: a training bout's dummy (incl. DUMMY: CPU) belongs to the TrainingDriver (UI §27.1)
    const training = cfg.mode === 'training' && !ctx.online;
    const cpus: [Cpu | null, Cpu | null] = [null, null];
    for (const p of [0, 1] as const) {
      const lv = cfg.p[p].cpu;
      if (!ctx.online && !training && typeof lv === 'number' && lv >= 0) cpus[p] = createCpu(clampLevel(lv), cfg.p[p].fighter, (cfg.seed ^ (0x9e3779b9 * (p + 1))) >>> 0);
    }
    const session = ctx.online ? ctx.online.attach(m) : null;
    this.hud.mount(cfg);
    this.hud.setNames([this.nameOf(cfg.p[0].fighter), this.nameOf(cfg.p[1].fighter)]);
    d.menus.setMoveList(cfg.p[local].fighter, cfg.p[local].scheme);
    this.bout = {
      epoch: my, cfg, m, view, cpus, online: ctx.online ?? null, session, local, season: ctx.season ?? null, stats: new BoutStats(),
      seen: new Map(), lastFrame: 0, over: false, finished: false, pausedBy: local, pauseSeq: 0, lastSnap: null, lastFighters: null, stalls: 0,
      trainer: null,
    };
    // CHANGED(integrator) P2 (UI §27.1, the lines runtime/lab/ui_game.ts proved): the driver begins after hud.mount
    // (mount resets the training overlays; begin() applies the TRAINING OPTIONS on top)
    if (training) {
      const b = this.bout;
      b.trainer = new TrainingDriver({ opts: d.menus.training, data: d.data, hud: this.hud,
        sim: { createMatch, step, readFighter, readMatch, devSet }, cpu: createCpu });
      b.trainer.begin(cfg, m);
    }
    // CHANGED(integrator) P2 (UI §27.4 HUD hooks): THE SEASON's bouts show the season score banked so far and the
    // EPISODE line on the broadcast bug; bonus rounds keep the sim's running SCORE (Hud reads MatchSnap.brawl.score)
    if (ctx.season && cfg.mode === 'arcade') this.seasonHud(ctx.season, cfg);
    this.installPauseApi();
    this.audioBout(cfg, m, ctx, local, cpus);
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

  /**
   * CHANGED(integrator): AUDIO §9.1 wiring - bout() mounts the voices / stage music / crowd bed, preload() with no ids
   * fetches the bout set (sfx + crowd sprites), music('stage') resolves boss / miniboss / the stage track, and the gore
   * setting drives the splatter sounds. (Was: preload([stage, fighters]) - fighter ids are not audio ids - and no bout().)
   */
  private audioBout(cfg: MatchCfg, m: Match, ctx: BoutCtx, local: 0 | 1, cpus: [Cpu | null, Cpu | null]): void {
    const a = this.d.audio;
    const humans = (cfg.p[0].cpu < 0 ? 1 : 0) + (cfg.p[1].cpu < 0 ? 1 : 0);
    // CHANGED(integrator) P2: training = player 1 vs the driver's dummy (its cfg says cpu -1 for the dummy, §27.1)
    const who = ctx.online ? local : cfg.mode === 'training' ? 0 : humans === 2 ? -1 : cpus[0] && !cpus[1] ? 1 : 0;
    try {
      a.bout({ fighters: [cfg.p[0].fighter, cfg.p[1].fighter], stage: cfg.stage, mode: cfg.mode, local: who, sfxNames: m.tab.sfx });
      a.setSplatter(this.d.settings.get().gore);
      a.setPaused(false);
      a.preload();
      a.music('stage');
    } catch (e) { console.warn('[hit-parade] audio bout', e); }
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
      // CHANGED(NET) P2: online the local player is THIS screen's player-1 controls (key set 1, pad slot 0, touch) on BOTH
      // peers. The guest is sim slot 1, but Input feeds touch and pad 0 into word 0 only - w[b.local] made the guest play
      // with the P2 key set (arrows / numpad) and ignored its touch overlay and first pad.
      const r = b.session.tick(w[0]);
      if (r.stalled) b.stalls++;
      return;
    }
    // CHANGED(integrator) P2 (UI §27.1): TRAINING - a RESET POSITION swaps in the driver's fresh, positioned Match (the
    // view / HUD read snapshots only, so only the event reader restarts), then the driver turns the sampled words into
    // [P1, dummy] (dummy / CPU / playback; P1 idles while recording)
    if (b.trainer) {
      const nm = b.trainer.pending();
      if (nm) { b.m = nm; b.seen.clear(); b.lastFrame = nm.frame(); }
      const [i1, i2] = b.trainer.tick(b.m, w);
      step(b.m, i1, i2);
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
      if (e.type === EV.MATCH_END) this.onMatchEnd(b, snap, e.frame);   // CHANGED(NET) P2: + the event's own frame
    }
    b.lastSnap = snap;
    b.lastFighters = f;
    // CHANGED(fixer) D4: the camera keeps airborne heads below the HUD band (Hud.safeTop() is cached, measured on layout change)
    b.view.setSafeArea(this.hud.safeTop());
    b.view.frame(snap, f, evs, dt);
    this.hud.frame(snap, f, evs);
    // CHANGED(integrator) P2 (UI §27.1): the HITBOX overlay, the sim's boxes projected with the fight camera to CSS px
    if (b.trainer) b.trainer.frame(this.projector(b));
    this.touchFrame(b, f);
    try { d.audio.events(evs, snap, f); } catch (e) { console.warn('[hit-parade] audio.events', e); }
    b.view.render();
  }

  private readonly projV = new Vector3();
  /** world metres -> CSS px of the page through the bout's fight camera (null behind the camera) */
  private projector(b: Bout): (x: number, y: number, z: number) => [number, number] | null {
    const cam = b.view.cam.camera;
    const el = this.d.renderer.three.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    const v = this.projV;
    return (x, y, z) => {
      v.set(x, y, z).project(cam);
      return v.z > 1 ? null : [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    };
  }

  /** the touch overlay: visible only while the bout steps in touch mode (hidden on pause / results / menus) */
  private touchFrame(b: Bout, f: readonly [FighterSnap, FighterSnap]): void {
    const t = this.d.touch;
    if (!t) return;
    const on = this.d.input.mode === 'touch' && this.d.flow.phase === 'bout' && !b.finished;
    t.setVisible(on);
    if (on) { const me = f[b.local]; t.setMeters({ showtime: me.showtime, nerve: me.nerve, stageFright: !!me.stageFright }); }
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

  private onMatchEnd(b: Bout, snap: MatchSnap, endFrame = snap.frame): void {
    if (b.over) return;
    b.over = true;
    const winner: -1 | 0 | 1 = snap.winner === 0 || snap.winner === 1 ? snap.winner : -1;
    if (b.online) {
      // online: RESULT agreement first (online 'matchEnd' calls finish); the session keeps ticking meanwhile.
      // CHANGED(NET) P2: this MATCH_END is never a misprediction: the sim emits it koOutroFrames (90) / timeoverOutroFrames
      // (120) after the deciding frame and the session never runs more than W (8 / 12) frames past its last confirmed input,
      // so the KO / time-over that caused it is final. The flow still sends RESULT only once this frame is confirmed.
      // It is reported at the EVENT's frame: snap.frame is the render-time frame, which differs between the peers (measured:
      // 2288 vs 2287 -> the RESULT agreement failed although both checksums at frame 2280 were identical).
      this.onlineEndSeen.set(b, performance.now());
      b.online.finish({ winner, frame: endFrame, checksum: checksum(b.m) });
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
      // CHANGED(integrator) P2 (UI §27.3): the per-round winners / how, recorded on each KO / TIME OVER frame
      rounds: s.rounds.slice(),
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
    // CHANGED(NET) P2: RATED = both peers agreed on the sim result, both are signed in (NET 'matchEnd'.rated) AND the ratings
    // RPC answered (online.info().ratings; it is missing on the live project today -> UNRATED). Was always false.
    if (b.online) {
      r.rated = !!b.online.lastMatch?.rated && b.online.info().ratings != null && reason !== 'forfeit';
      r.disconnect = reason === 'disconnect';
    }
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
    const snap = b.lastSnap ?? readMatch(b.m);
    // CHANGED(integrator) P2: a bonus round scores the sim's running total (MatchSnap.brawl.score = SCORE `c`, §28.4). The
    // P1 sum of positive SCORE `b` deltas over-counted a HECKLER TOSS: a heckle hit's negative delta was dropped.
    if (slot && (slot.kind === 'brawl' || slot.kind === 'heckler')) return snap.brawl ? Math.max(0, snap.brawl.score) : s.score[0];
    return (snap.wins[0] ?? 0) * 1000 + s.damage[0] + 100 * s.maxCombo[0] + 300 * (s.counters[0] + s.punishes[0]) + 500 * s.perfectParries[0]
      + (winner === 0 ? 5000 : 0) + s.score[0];
  }

  private async afterResults(b: Bout, r: MatchResult, choice: 'rematch' | 'charselect' | 'menu' | 'next'): Promise<void> {
    if (b.online) {
      // CHANGED(NET) P2: REMATCH keeps the results card up (UI §27.2: it becomes the waiting panel) until 'select' opens the
      // blind select; if the opponent declines / leaves meanwhile, 'end' takes this player to the ONLINE lobby with the
      // reason (never a dead card). A session that already ended (opponent left / declined, disconnect or forfeit win:
      // nobody to rematch) goes straight back to the ONLINE lobby.
      const o = b.online;
      if (choice === 'rematch' && o.phase === 'result' && o.lastMatch?.rematch !== false) {
        this.onlineRematchWait = true;
        o.rematch(true);
        return;
      }
      if (choice === 'rematch') {
        // nobody to rematch: the opponent left / declined (endCode) or lost by disconnect / forfeit; a player who forfeited
        // themselves just gets the idle lobby
        const code = o.info().endCode || (o.lastMatch && !o.lastMatch.rematch ? 'net.opponent_left' : '');
        o.leave();
        this.onlineLobby(code);
        return;
      }
      o.rematch(false);
      o.leave();
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
  /** true when the key paused the bout (the caller then consumes the key event) */
  private onPauseKey(p: 0 | 1): boolean {
    const ph = this.d.flow.phase;
    if (ph === 'bout' && this.bout && !this.bout.finished) { this.pause('key', p); return this.d.flow.phase === 'paused'; }
    return false;
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
    try { d.audio.setPaused(true); } catch { /* audio is optional */ }
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
    // CHANGED(integrator): in TRAINING the button is EXIT TRAINING (UI §22.2, no confirm): straight back to the main menu,
    // no results card for a practice session (the UI lab's flow; before, a "BY FORFEIT" results card appeared)
    if (choice === 'forfeit' && b.cfg.mode === 'training') { this.toMenus('main'); return; }
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
    try { d.audio.setPaused(false); } catch { /* audio is optional */ }
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
    // CHANGED(integrator): only fighters whose baked assets are in the build (ui/data.ts hasAssets) enter the ladder
    const ids = Object.keys(f).filter((id) => hasAssets(this.d.data as unknown as Parameters<typeof hasAssets>[0], id));
    return {
      playable: ids.filter((id) => id !== 'freak' && id !== 'ricky'),
      miniboss: 'freak', boss: 'ricky',
      rival: (id) => {
        const r = f[id]?.rival;
        return typeof r === 'string' && r && r !== '-' && f[r] && ids.includes(r) ? r : null;
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

  /** CHANGED(integrator) P2: a bonus round's length (s) = system.json brawl / heckler `seconds` (the sim's default timer) */
  private bonusSeconds(kind: 'brawl' | 'heckler'): number {
    const sys = this.d.data.system;
    const s = kind === 'brawl' ? sys.brawl?.seconds : sys.heckler?.seconds;
    return typeof s === 'number' && s > 0 ? s : kind === 'brawl' ? 45 : 40;
  }

  /**
   * CHANGED(integrator) P2 (UI §27.4 HUD hooks): a SEASON bout's score box shows the season score banked before this
   * bout, and the broadcast bug reads "EPISODE n - <STAGE>" (strings vs.episode + stage.<id>.name; the Hud's own
   * default is the stage name alone).
   */
  private seasonHud(run: SeasonRun, cfg: MatchCfg): void {
    const slot = run.current();
    if (!slot) return;
    this.hud.setScore(this.seasonScore(run));
    const str = this.d.data.strings;
    const ep = (str['vs.episode'] ?? 'EPISODE {n}').replace('{n}', String(slot.episode));
    const st = str[`stage.${cfg.stage}.name`];
    this.hud.setEpisodeLine(st ? `${ep} - ${st}` : ep);
  }

  private async seasonSlot(run: SeasonRun): Promise<void> {
    const d = this.d;
    const my = ++this.epoch;
    this.teardown(false);
    const slot = run.current();
    if (!slot) { await this.seasonCleared(run); return; }
    const bonus = slot.kind === 'brawl' || slot.kind === 'heckler';
    if (!BONUS_ROUNDS_IN_SIM && bonus) {
      console.info(`[hit-parade] season: ${slot.kind} bonus round skipped (not in the sim yet)`);
      run.record(true);
      await this.seasonSlot(run);
      return;
    }
    if (d.flow.phase !== 'menu') d.flow.go('menu', 'season ladder');
    d.flow.setScreen('ladder');
    d.boot.hide();
    const init = run.init;
    // CHANGED(integrator) P2 (UI §27.4): the ladder marks the slot a CONTINUE is replaying as lost and shows the continues
    const lv: LadderView = {
      fighter: init.fighter, color: init.color, length: init.length,
      bouts: run.slots.map((s, k) => ({ kind: s.kind, opponent: s.opponent ?? undefined,
        result: k < run.index ? 'won' : run.outcomes[k] === 'loss' ? 'lost' : null })),
      current: run.index, score: this.seasonScore(run), continues: run.continues,
    };
    const go = await d.menus.showLadder(lv);
    if (my !== this.epoch) return;
    if (go === 'quit') { this.season = null; this.toMenus('main'); return; }
    if (slot.kind !== 'bout') {
      // CHANGED(integrator) P2: a bonus card carries the round's length from the sim's own numbers (system.json
      // brawl.seconds 45 / heckler.seconds 40 = what the sim runs when cfg.timer is absent)
      const card: CardView = { kind: slot.kind as Exclude<SlotKind, 'bout'>, a: init.fighter, b: slot.opponent ?? undefined,
        ...(bonus ? { seconds: this.bonusSeconds(slot.kind as 'brawl' | 'heckler') } : {}) };
      await d.menus.showCard(card);
      if (my !== this.epoch) return;
    }
    const opp = slot.opponent ?? init.fighter;
    // CHANGED(integrator) P2: a bonus round plays on the PLAYER's home stage (as probe_season S3 stages it); a bout on
    // the slot's own stage, else the opponent's home stage (THE FREAK butcher_block, RICKY control_room)
    const home = bonus ? this.stageFor(init.fighter, this.firstStage()) : this.stageFor(slot.opponent, this.firstStage());
    const stage = playableStage(this.d.data as unknown as Parameters<typeof playableStage>[0], slot.stage ?? home);
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
      const n = await d.menus.showNameEntry({ score, fighter: init.fighter, length: init.length });  // CHANGED(orchestrator): §35.22 SHELL request - rank on the run's own board
      if (typeof n === 'string' && n.trim()) name = n;
    } catch (e) { console.warn('[hit-parade] name entry', e); }
    if (my !== this.epoch) return;
    const res = d.save.recordClear({ fighter: init.fighter, length: init.length, difficulty: init.difficulty, score, name });
    this.season = null;
    // CHANGED(integrator) P2 (UI §27.4): the ending's RATINGS TOTAL card says how many continues the run used
    try { await d.menus.showEnding({ fighter: init.fighter, score, unlocked: res.unlocked, length: init.length, continues: run.continues }); } catch (e) { console.warn('[hit-parade] ending', e); }
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

  /** CHANGED(NET) P2: MATCH_END seen (real ms) per online bout: the results card keeps the offline pacing (RESULTS_DELAY_MS) */
  private readonly onlineEndSeen = new WeakMap<Bout, number>();
  /** CHANGED(NET) P2: REMATCH pressed, waiting for the opponent's answer (the results card stays up, UI §27.2) */
  private onlineRematchWait = false;

  /** CHANGED(NET) P2: the ONLINE lobby screen with a NET status code (opponent left, waiting for the rematch, ...) */
  private onlineLobby(code: string): void {
    // via MAIN so the menus' back stack is title > main > online (BACK must never land on a dead character select)
    this.toMenus('main');
    this.d.flow.setScreen('online');
    this.d.menus.show('online', { status: code ? { code, phase: this.online?.phase ?? 'ended', room: this.online?.room ?? '' } : { st: 'idle' } });
  }

  /** NET §19.4 events -> menus / bouts (the one adapter for the online flow) */
  private onlineWire(o: Online): void {
    const d = this.d;
    type UiStatus = Parameters<Menus['setOnlineStatus']>[0];
    // CHANGED(NET) P2: status / error payloads carry the room code as `room` (UI §27: menus fill {code} from it)
    o.on('status', (s) => d.menus.setOnlineStatus(s as unknown as UiStatus));
    o.on('error', (e) => d.menus.setOnlineStatus(e as unknown as UiStatus));
    // CHANGED(NET) P2: every blind select (first match and each rematch) opens from a clean slate: the previous bout (its
    // results card / frozen last frame) is torn down first; the app phase is 'menu', mode 'online'.
    o.on('select', (() => {
      this.onlineRematchWait = false;
      this.toMenus('charselect', { mode: 'online', opponent: 'human' });
      d.flow.mode = 'online';
    }) as (p: never) => void);
    o.on('reveal', ((p: { picks?: Array<{ fighter: string; color: number; scheme: 0 | 1 }> }) => {
      const other = p?.picks?.[o.local === 0 ? 1 : 0];
      if (other) d.menus.revealOpponent({ fighter: other.fighter, color: other.color, scheme: other.scheme });
    }) as unknown as (p: never) => void);
    o.on('matchStart', (cfg, local) => { void this.startBout(cfg, { online: o, local, autostart: true }).catch((e) => this.crash(e)); });
    // CHANGED(NET) P2: the results card follows RESULT agreement but keeps the offline pacing (KO / win pose for
    // RESULTS_DELAY_MS after MATCH_END); once it shows, this peer stops ticking the session (agreement means the peer
    // already holds every input it needs; on the relay a ticking session costs 10 Supabase sends/s for nothing).
    o.on('matchEnd', (r) => {
      const b = this.bout;
      if (!b || b.online !== o || b.finished) return;
      const seen = this.onlineEndSeen.get(b);
      const wait = r.reason === 'ko' && seen !== undefined ? Math.max(0, RESULTS_DELAY_MS - (performance.now() - seen)) : 0;
      const my = b.epoch;
      window.setTimeout(() => {
        if (my !== this.epoch || this.bout !== b || b.finished) return;
        void this.finish(r.winner, r.reason === 'disconnect' ? 'disconnect' : null, -1);
        this.loop.simEnabled = false;
      }, wait);
    });
    // CHANGED(NET) P2: an opponent's FORFEIT (BYE mid-match) reads "by forfeit" (forfeit = the leaver), a vanished opponent
    // (presence gone for the 5 s grace) "by disconnect"; either way the stayer wins.
    o.on('disconnect', (r) => {
      const b = this.bout;
      if (!b || b.online !== o || b.finished) return;
      if (r.reason === 'forfeit') void this.finish(r.winner, 'forfeit', r.winner === 0 ? 1 : 0);
      else void this.finish(r.winner, 'disconnect', -1);
      this.loop.simEnabled = false;
    });
    // CHANGED(NET) P2: the session ended for a reason this player did not choose (opponent left / declined the rematch /
    // timed out, version mismatch, no opponent, relay busy ...) while they wait for it (blind select, the rematch wait,
    // the lobby): back to the ONLINE screen with the reason. A live bout ends through 'matchEnd' / 'disconnect'; a
    // results card still showing keeps showing (its REMATCH then lands here too, via afterResults).
    o.on('end', (e) => {
      if (e.reason === 'leave' || e.reason === 'no-rematch') return;
      const b = this.bout;
      // a bout that never started (still waiting for GO: the session ended while the peers loaded) goes to the lobby too;
      // one that runs ends only through 'matchEnd' / 'disconnect'
      const notStarted = !!b && b.online === o && !b.finished && (!b.session || b.session.currentFrame() === 0);
      if (b && b.online === o && !b.finished && !notStarted) return;
      if (b && b.finished && !this.onlineRematchWait) return;
      const mr = d.menus.readback() as { screen?: string | null; visible?: boolean };
      const onSelect = mr.screen === 'charselect' && d.flow.mode === 'online';
      // still loading the bout (this.bout is null until BoutView.create resolves): the lobby bumps the epoch, so the
      // pending startBout disposes its view instead of mounting a bout for a finished session
      const loading = d.flow.phase === 'loading' && d.flow.mode === 'online';
      if (b || onSelect || loading || this.onlineRematchWait || mr.screen === 'online') {
        this.onlineRematchWait = false;
        this.onlineLobby(e.code || 'net.opponent_left');
      }
    });
    // CHANGED(NET) P2: UI §27.2 request - the other NET events reach the lobby / select / results screens as they are
    // (registered last: the screens this adapter opens above exist when the menus hear the event)
    const menusEv = d.menus as unknown as { onlineEvent?: (name: string, payload?: unknown) => void };
    for (const ev of ['paired', 'select', 'opponentLocked', 'reveal', 'rematch', 'matchEnd', 'disconnect', 'end', 'ratings'] as const) {
      o.on(ev as 'paired', ((p: unknown) => { try { menusEv.onlineEvent?.(ev, p); } catch (e) { console.warn('[hit-parade] menus.onlineEvent', ev, e); } }) as (p: never) => void);
    }
  }

  private async onlineAction(action: 'quick' | 'create' | 'join' | 'cancel', code?: string, name?: string): Promise<void> {
    if (action === 'cancel') { this.onlineRematchWait = false; this.online?.leave(); return; }
    if (name) this.d.save.setOnlineName(name);
    const o = this.ensureOnline();
    // CHANGED(NET) P2: the display name typed on the ONLINE screen reaches the opponent (was: the name at first use only)
    const nm = name || this.d.save.get().onlineName;
    if (nm) o.setName(nm);
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
    try { this.d.touch?.setVisible(false); } catch { /* ignore */ }
    if (!b) return;
    this.bout = null;
    // CHANGED(integrator) P2 (UI §27.1): the driver drops its option listener and clears the HUD overlays
    try { b.trainer?.end(); } catch (e) { console.warn('[hit-parade] trainer.end', e); }
    try { this.d.audio.setPaused(false); this.d.audio.bout(null); } catch (e) { console.warn('[hit-parade] audio.bout(null)', e); }
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
