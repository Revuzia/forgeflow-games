// HIT PARADE - the TRAINING driver (lane UI; CONTRACT 8 "Training: dummy menu ... record-playback 3 s", 27.1).
//
// The ONE place the TRAINING OPTIONS (ui/training.ts TrainingState, edited on the pause card's TRAINING OPTIONS screen)
// become dummy behaviour. It is DOM-free (the Hud draws what it hands over), offline only (training never runs online),
// and it never writes the sim state itself except through the sim's own API (createMatch / step / devSet), so the sim
// stays the single authority. game.ts (SHELL) wires it with the lines in CONTRACT 27.1:
//
//   begin(cfg, m)      a training bout mounted
//   pending()          before each tick: a RESET POSITION request comes back as a fresh, positioned Match to swap in
//   tick(m, w)         each sim tick: w = the sampled input words [P1, P2]; returns the words to step with
//   frame(project)     each rendered frame: the HITBOX overlay (projected with the fight camera) -> hud.setBoxes()
//   end()              teardown
//
// Per tick, in order:  METER FULL refill (devSet) -> RECORD (P1's word drives the dummy, P1 idles) | PLAYBACK | a P2
// device held (manual dummy) | DUMMY: CPU | STAND / CROUCH / JUMP with the GUARD mode on top:
//   guard ALL          back (away from P1 = against the dummy's facing, as a player presses it) while a threat is live:
//                      the attacker's move running (first visible move frame on), a P1 projectile coming, or the dummy
//                      in blockstun; plus DOWN (crouch guard) unless the attack is an overhead (move `guard` 'H') or the
//                      attacker is airborne (jump-ins are blocked standing)
//   guard FIRST        the same, armed by a hit on the dummy, disarmed after 40 free frames with no threat
//   guard RANDOM       a seeded 50 % roll per attack instance (a new move start of P1)
// RECORD stores the words relative to the dummy's facing (forward / back), so PLAYBACK from either side replays the same
// motions. The input display gets P1's word (facing-relative, 6 = forward) every tick.

import type { FighterSnap, GameData, MatchSnap } from '../core/types.ts';
import type { Match, MatchCfg } from '../core/sim/match.ts';
import { hurtRects, hitRect, pushExt } from '../core/sim/boxes.ts';
import { F, P, PROJ_CAP, ST, projBase } from '../core/sim/layout.ts';
import { EV, eventsSince } from '../core/sim/events.ts';
import type { SimEvent } from '../core/types.ts';
import { fb } from '../core/sim/state.ts';
import { M as METRE } from '../core/sim/units.ts';
import { RECORD_TICKS, type ResetWhere, type TrainingOpts, type TrainingState, type ScreenBox } from './trainopts.ts';

/** the sim functions game.ts passes (core/sim/match.ts), structurally */
export interface TrainerSim {
  createMatch(cfg: MatchCfg, data: GameData): Match;
  step(m: Match, in1: number, in2: number): void;
  readFighter(m: Match, i: number): FighterSnap;
  readMatch(m: Match): MatchSnap;
  devSet?(m: Match, p: 0 | 1, key: 'hp' | 'showtime' | 'nerve', v: number): void;
}
export interface TrainerCpu { input(m: Match, p: number): number }
export type TrainerCpuFactory = (level: number, fighter: string, seed: number) => TrainerCpu;
/** the Hud surface the driver feeds (ui/hud.ts Hud satisfies it) */
export interface TrainerHud {
  pushInputs(word: number, frame: number): void;
  setBoxes(list: ReadonlyArray<ScreenBox> | null): void;
  setTraining(o: Partial<TrainingOpts> | null): void;
  setRecordState(s: 'off' | 'record' | 'play'): void;
  /** optional: exact per-tick frame data (Hud.setReadout) */
  setReadout?(r: Readout): void;
}
export interface Readout { adv: number | null; block: boolean; startup: number; damage: number; combo: number }
export type Projector = (x: number, y: number, z: number) => [number, number] | null;

export const BIT = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 } as const;
const WORD = 0x1fff;
const FREE_STATES = new Set(['idle', 'crouch', 'walk_f', 'walk_b', 'land', 'dash_f', 'dash_b']);
const HURT_STATES = new Set(['hitstun', 'juggle', 'knockdown', 'crumple', 'wall_splat', 'thrown', 'dizzy']);
const FIRST_DISARM_F = 40;
const PLAYBACK_GAP_F = 30;
const CORNER_GAP_M = 2.2;
const SETTLE_F = 30;

/** swap LEFT / RIGHT when facing -x: screen word <-> facing-relative word (an involution) */
export function relWord(w: number, facing: number): number {
  if (facing >= 0) return w & WORD;
  const l = w & BIT.LEFT, r = w & BIT.RIGHT;
  return ((w & ~(BIT.LEFT | BIT.RIGHT)) | (l ? BIT.RIGHT : 0) | (r ? BIT.LEFT : 0)) & WORD;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TrainingDriverDeps {
  opts: TrainingState;
  data: GameData;
  sim: TrainerSim;
  cpu?: TrainerCpuFactory;
  hud?: TrainerHud | null;
}

export class TrainingDriver {
  readonly opts: TrainingState;
  private readonly data: GameData;
  private readonly sim: TrainerSim;
  private readonly cpuFactory: TrainerCpuFactory | null;
  private readonly hud: TrainerHud | null;
  private cfg: MatchCfg | null = null;
  private m: Match | null = null;
  private off: (() => void) | null = null;
  private cpu: TrainerCpu | null = null;
  private cpuLevel = -1;
  private rng: () => number = mulberry32(1);
  // guard state
  private firstArmed = false;
  private freeCalm = 0;
  private lastAtkKey = '';
  private lastAtkFrame = 0;
  private randomBlock = false;
  private lastHp = -1;
  // record / playback
  private readonly rec = new Int32Array(RECORD_TICKS);
  private recLen = 0;
  private recording = false;
  private playIdx = 0;
  private playGap = 0;
  private lastRecordMode: TrainingOpts['record'] = 'off';
  // frame data, measured per tick: the contact event, then the first tick each side is actionable again
  private lastEvFrame = -1;
  private readonly evBuf: SimEvent[] = [];
  private watch: { atk: 0 | 1; block: boolean; t0: number; tA: number; tD: number; startup: number; damage: number } | null = null;
  /** read-back: the last exact measurement */
  lastReadout: Readout | null = null;
  // reset
  private resetWhere: ResetWhere | null = null;
  private boxesOn = false;
  /** read-back counters (harness / lab) */
  readonly stats = { ticks: 0, guardTicks: 0, recTicks: 0, playTicks: 0, cpuTicks: 0, manualTicks: 0, resets: 0, refills: 0, lastWord: 0, lastReset: '' as string };

  constructor(d: TrainingDriverDeps) {
    this.opts = d.opts;
    this.data = d.data;
    this.sim = d.sim;
    this.cpuFactory = d.cpu ?? null;
    this.hud = d.hud ?? null;
  }

  begin(cfg: MatchCfg, m: Match): void {
    this.cfg = cfg;
    this.m = m;
    this.rng = mulberry32((cfg.seed ^ 0x51ed270b) >>> 0);
    this.firstArmed = false; this.freeCalm = 0; this.lastAtkKey = ''; this.randomBlock = false; this.lastHp = -1;
    this.recording = false; this.playIdx = 0; this.playGap = 0; this.resetWhere = null;
    this.lastEvFrame = this.sim.readMatch(m).frame; this.watch = null; this.lastReadout = null;
    // a deep link with a CPU on P2 (?cpu2=n) starts in DUMMY: CPU at that level
    const lv = cfg.p[1].cpu;
    if (typeof lv === 'number' && lv >= 0) this.opts.set({ dummy: 'cpu', cpuLevel: Math.max(1, lv) });
    this.lastRecordMode = this.opts.get().record;
    this.off?.();
    this.off = this.opts.on((o, action, where) => {
      if (action === 'reset') { this.resetWhere = where; return; }
      this.applyOverlays(o);
    });
    this.applyOverlays(this.opts.get());
  }

  end(): void {
    this.off?.();
    this.off = null;
    this.hud?.setBoxes(null);
    this.hud?.setRecordState('off');
    this.m = null;
    this.cfg = null;
    this.cpu = null;
    this.cpuLevel = -1;
  }

  private applyOverlays(o: TrainingOpts): void {
    this.hud?.setTraining({ inputs: o.inputs, frames: o.frames });
    if (!o.hitboxes && this.boxesOn) { this.boxesOn = false; this.hud?.setBoxes(null); }
    this.hud?.setRecordState(o.record === 'record' ? 'record' : o.record === 'play' && this.recLen > 0 ? 'play' : 'off');
  }

  /** a RESET POSITION request as a fresh Match (null when none is pending); game.ts swaps it in before the tick */
  pending(): Match | null {
    const where = this.resetWhere;
    if (!where || !this.cfg) return null;
    this.resetWhere = null;
    const m = this.build(where);
    this.m = m;
    this.lastEvFrame = this.sim.readMatch(m).frame;
    this.watch = null;
    this.stats.resets++;
    this.stats.lastReset = where;
    this.playIdx = 0; this.playGap = 0; this.firstArmed = false; this.freeCalm = 0; this.lastHp = -1;
    return m;
  }

  /** a fresh Match stepped to live play at the asked spacing (the sim's own walk moves the fighters: no state pokes) */
  build(where: ResetWhere): Match {
    const cfg = this.cfg as MatchCfg;
    const s = this.sim;
    const m = s.createMatch(cfg, this.data);
    for (let k = 0; k < 900 && s.readMatch(m).phase !== 'fight'; k++) s.step(m, 0, 0);
    if (where !== 'mid') {
      // corner = the dummy (P2, right of P1 at the start) walks back into its wall while P1 follows;
      // cornered = P1 walks back into its own wall while the dummy follows
      const dir = where === 'corner' ? BIT.RIGHT : BIT.LEFT;
      const wall = where === 'corner' ? 1 : 0;
      let lastX = Number.NaN;
      let still = 0;
      for (let k = 0; k < 900; k++) {
        const a = s.readFighter(m, 0), b = s.readFighter(m, 1);
        const w = wall === 1 ? b : a;
        still = Math.abs(w.x - lastX) < 0.0005 ? still + 1 : 0;
        lastX = w.x;
        const gap = Math.abs(b.x - a.x);
        const stuck = still >= 3;
        if (stuck && gap <= CORNER_GAP_M + 0.05) break;
        const wallWord = stuck ? 0 : dir;
        const followWord = gap > CORNER_GAP_M ? dir : 0;
        if (wall === 1) s.step(m, followWord, wallWord); else s.step(m, wallWord, followWord);
      }
    }
    for (let k = 0; k < SETTLE_F; k++) s.step(m, 0, 0);
    return m;
  }

  /** one sim tick: the words to step with ([P1, P2]) */
  tick(m: Match, w: readonly [number, number]): [number, number] {
    this.m = m;
    const s = this.sim;
    const f0 = s.readFighter(m, 0), f1 = s.readFighter(m, 1);
    const ms = s.readMatch(m);
    const o = this.opts.get();
    this.stats.ticks++;
    this.measure(m, f0, f1, ms);
    if (o.meter === 'full' && s.devSet && ms.phase === 'fight' && !ms.cinematic.active) this.refill(m, f0, f1);
    if (o.record !== this.lastRecordMode) this.onRecordMode(o.record);
    const p1 = w[0] & WORD;
    let in1 = p1;
    let in2 = 0;
    if (o.record === 'record') {
      // RECORD: P1's controls drive the dummy for 3 s; P1 stands still
      if (this.recLen < RECORD_TICKS) {
        in2 = p1;
        this.rec[this.recLen++] = relWord(p1, f1.facing);
        this.stats.recTicks++;
      }
      in1 = 0;
      if (this.recLen >= RECORD_TICKS) {
        this.recording = false;
        this.opts.recorded = this.recLen;
        this.opts.set({ record: 'off' });
        this.lastRecordMode = 'off';
        this.hud?.setRecordState('off');
      }
    } else if (o.record === 'play' && this.recLen > 0) {
      in2 = this.playback(f1);
    } else if (w[1] & WORD) {
      in2 = w[1] & WORD;
      this.stats.manualTicks++;
    } else {
      in2 = this.dummyWord(m, o, f0, f1, ms);
    }
    this.hud?.pushInputs(relWord(o.record === 'record' ? p1 : in1, o.record === 'record' ? f1.facing : f0.facing), ms.frame);
    this.stats.lastWord = in2;
    return [in1, in2];
  }

  /**
   * Frame data per SIM TICK (the render-frame readout can be a frame off): a HIT / BLOCK between the fighters starts a
   * watch; advantage = (first tick the defender is actionable) - (first tick the attacker is), SF6 convention (+ = the
   * attacker acts first); damage = the victim's `lastDamage`, combo = the attacker's `comboDamage` (CONTRACT 19.7).
   */
  private measure(m: Match, f0: FighterSnap, f1: FighterSnap, ms: MatchSnap): void {
    const buf = this.evBuf;
    buf.length = 0;
    eventsSince(m.events, this.lastEvFrame + 1, buf);
    const f = [f0, f1] as const;
    for (const e of buf) {
      if (e.frame > this.lastEvFrame) this.lastEvFrame = e.frame;
      if (e.type !== EV.HIT && e.type !== EV.BLOCK) continue;
      if ((e.a !== 0 && e.a !== 1) || e.b !== 1 - e.a) continue;
      const atk = e.a as 0 | 1;
      this.watch = { atk, block: e.type === EV.BLOCK, t0: e.frame, tA: -1, tD: -1, startup: f[atk].moveFrame, damage: e.type === EV.BLOCK ? 0 : f[1 - atk].lastDamage };
      this.publish(null);
    }
    const w = this.watch;
    if (!w || ms.frame <= w.t0) return;
    const act = (x: FighterSnap): boolean => (typeof x.actionable === 'boolean' ? x.actionable : FREE_STATES.has(x.stateName) && x.hitstop <= 0);
    if (w.tA < 0 && act(f[w.atk])) w.tA = ms.frame;
    if (w.tD < 0 && act(f[1 - w.atk])) w.tD = ms.frame;
    if (w.tA >= 0 && w.tD >= 0) { this.publish(w.tD - w.tA); this.watch = null; }
    else if (ms.frame - w.t0 > 300) this.watch = null;
  }

  private publish(adv: number | null): void {
    const w = this.watch;
    if (!w) return;
    const m = this.m;
    const atkSnap = m ? this.sim.readFighter(m, w.atk) : null;
    const r: Readout = { adv, block: w.block, startup: w.startup, damage: w.damage, combo: atkSnap ? Math.max(atkSnap.comboDamage, w.damage) : w.damage };
    if (adv !== null) this.lastReadout = r;
    this.hud?.setReadout?.(r);
  }

  private onRecordMode(mode: TrainingOpts['record']): void {
    this.lastRecordMode = mode;
    if (mode === 'record') { this.recLen = 0; this.recording = true; this.opts.recorded = 0; }
    else this.recording = false;
    if (mode === 'play') { this.playIdx = 0; this.playGap = 0; }
    this.hud?.setRecordState(mode === 'record' ? 'record' : mode === 'play' && this.recLen > 0 ? 'play' : 'off');
  }

  private playback(f1: FighterSnap): number {
    if (this.playIdx < this.recLen) {
      this.stats.playTicks++;
      return relWord(this.rec[this.playIdx++], f1.facing);
    }
    // the loop restarts once the dummy has been free a moment
    if (FREE_STATES.has(f1.stateName)) this.playGap++;
    if (this.playGap >= PLAYBACK_GAP_F) { this.playIdx = 0; this.playGap = 0; }
    return 0;
  }

  private refill(m: Match, f0: FighterSnap, f1: FighterSnap): void {
    const set = this.sim.devSet;
    if (!set) return;
    const sys = this.data.system as unknown as { showtime?: { bar?: number; bars?: number }; nerve?: { bar?: number; bars?: number } };
    const stMax = (sys.showtime?.bar ?? 10000) * (sys.showtime?.bars ?? 3);
    const nvMax = (sys.nerve?.bar ?? 10000) * (sys.nerve?.bars ?? 6);
    let did = false;
    for (const [i, f] of [[0, f0], [1, f1]] as const) {
      // refill once the fighter is free again (never mid-move: a super that spends the gauge keeps its cost visible)
      if (!FREE_STATES.has(f.stateName)) continue;
      if (f.showtime < stMax) { set(m, i, 'showtime', stMax); did = true; }
      if (f.nerve < nvMax) { set(m, i, 'nerve', nvMax); did = true; }
    }
    if (did) this.stats.refills++;
  }

  /** STAND / CROUCH / JUMP / CPU with the GUARD mode on top */
  private dummyWord(m: Match, o: TrainingOpts, f0: FighterSnap, f1: FighterSnap, ms: MatchSnap): number {
    if (o.dummy === 'cpu') {
      if (this.cpuFactory && (!this.cpu || this.cpuLevel !== o.cpuLevel)) {
        this.cpu = this.cpuFactory(o.cpuLevel, (this.cfg as MatchCfg).p[1].fighter, ((this.cfg as MatchCfg).seed ^ 0x2545f491) >>> 0);
        this.cpuLevel = o.cpuLevel;
      }
      this.stats.cpuTicks++;
      return this.cpu ? this.cpu.input(m, 1) & WORD : 0;
    }
    const base = o.dummy === 'crouch' ? BIT.DOWN : o.dummy === 'jump' ? BIT.UP : 0;
    const th = this.threat(f0, f1, ms);
    // AFTER FIRST HIT: armed by a hit on the dummy, disarmed after a calm spell
    const hurt = HURT_STATES.has(f1.stateName) || (this.lastHp >= 0 && f1.hp < this.lastHp);
    this.lastHp = f1.hp;
    if (hurt) { this.firstArmed = true; this.freeCalm = 0; }
    else if (this.firstArmed) {
      if (!th.any && FREE_STATES.has(f1.stateName)) { if (++this.freeCalm >= FIRST_DISARM_F) this.firstArmed = false; }
      else this.freeCalm = 0;
    }
    const guard = o.guard === 'all' || (o.guard === 'first' && this.firstArmed && !hurt) || (o.guard === 'random' && this.randomBlock);
    if (guard && th.any) {
      this.stats.guardTicks++;
      const back = f1.facing >= 0 ? BIT.LEFT : BIT.RIGHT;
      return back | (th.high ? 0 : BIT.DOWN);
    }
    return base;
  }

  /** is P1 threatening the dummy right now, and must it be blocked standing */
  private threat(f0: FighterSnap, f1: FighterSnap, ms: MatchSnap): { any: boolean; high: boolean } {
    const attacking = f0.stateName === 'attack' && (f0.moveId >= 0 || !!f0.moveName);
    if (attacking) {
      const key = `${f0.moveName}:${f0.moveId}`;
      if (key !== this.lastAtkKey || f0.moveFrame < this.lastAtkFrame) this.randomBlock = this.rng() < 0.5;
      this.lastAtkKey = key;
      this.lastAtkFrame = f0.moveFrame;
    } else { this.lastAtkKey = ''; this.lastAtkFrame = 0; }
    let proj = false;
    for (const p of ms.proj ?? []) {
      if (p.owner !== 0 || p.alive === false) continue;
      const toward = (f1.x - p.x) * (p.vx ?? 0) > 0 || Math.abs(f1.x - p.x) < 1.2;
      if (toward) { proj = true; break; }
    }
    if (proj && !attacking && this.lastAtkKey === '') { this.lastAtkKey = 'proj'; this.randomBlock = this.rng() < 0.5; }
    const blockstun = f1.stateName === 'blockstun';
    const any = attacking || proj || blockstun;
    let high = false;
    if (attacking) {
      const mv = this.data.fighters[(this.cfg as MatchCfg).p[0].fighter]?.moves?.[f0.moveName] as { guard?: string } | undefined;
      high = f0.airborne || mv?.guard === 'H';
    }
    return { any, high };
  }

  // ─────────────────────────── HITBOX overlay ───────────────────────────
  /** per rendered frame: hurt / hit / push / projectile boxes, projected with the fight camera, into the Hud */
  frame(project: Projector | null): void {
    const o = this.opts.get();
    if (!o.hitboxes || !this.m || !project) {
      if (this.boxesOn) { this.boxesOn = false; this.hud?.setBoxes(null); }
      return;
    }
    const out: ScreenBox[] = [];
    for (const r of readBoxes(this.m)) {
      const a = project(r.x0, r.y0, 0), b = project(r.x1, r.y1, 0);
      if (!a || !b) continue;
      out.push({ kind: r.kind, x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    }
    this.boxesOn = true;
    this.hud?.setBoxes(out);
  }

  readback(): Record<string, unknown> {
    return { opts: this.opts.get(), recLen: this.recLen, recording: this.recording, playIdx: this.playIdx, firstArmed: this.firstArmed, cpuLevel: this.cpuLevel, boxes: this.boxesOn, ...this.stats };
  }
}

/** world boxes in metres (x = the fight line, y = up): hurt, active hit, push, projectile - read from the sim state */
export interface WorldBox { kind: ScreenBox['kind']; x0: number; y0: number; x1: number; y1: number }
const HR = new Int32Array(24);
const BX = new Int32Array(4);
export function readBoxes(m: Match): WorldBox[] {
  const s = m.s;
  const out: WorldBox[] = [];
  const u = (v: number): number => v / METRE;
  for (let i = 0; i < 2; i++) {
    const b = fb(i);
    const x = s[b + F.x], y = s[b + F.y];
    const n = hurtRects(m, i, HR);
    for (let k = 0; k < n; k++) out.push({ kind: 'hurt', x0: u(HR[k * 4]), x1: u(HR[k * 4 + 1]), y0: u(HR[k * 4 + 2]), y1: u(HR[k * 4 + 3]) });
    // push box: the asymmetric front / back extents (CHANGED(fixer) D2) over the posture box's height
    const top = n > 0 ? HR[3] : y;
    out.push({ kind: 'push', x0: u(x - pushExt(m, i, -1)), x1: u(x + pushExt(m, i, 1)), y0: u(y), y1: u(top) });
    const k = s[b + F.mv];
    if (k >= 0 && s[b + F.st] === ST.ATTACK) {
      const mv = m.cf[i].moves[k];
      const f = s[b + F.mvF];
      for (let j = 0; j < mv.nBox; j++) {
        const o = j * 7;
        if (f < mv.boxes[o] || f > mv.boxes[o + 1]) continue;
        hitRect(m, i, mv, j, BX, 0);
        out.push({ kind: 'hit', x0: u(BX[0]), x1: u(BX[1]), y0: u(BX[2]), y1: u(BX[3]) });
      }
    }
  }
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (s[pb + P.act] === 0) continue;
    const px = s[pb + P.x], py = s[pb + P.y], w2 = s[pb + P.w] >> 1, h2 = s[pb + P.h] >> 1;
    out.push({ kind: 'proj', x0: u(px - w2), x1: u(px + w2), y0: u(py - h2), y1: u(py + h2) });
  }
  return out;
}
