// HIT PARADE - VIEW lab, SIM mode (dev only; runtime/lab/view.html?sim=1, never in the build).
//
// The REAL sim (core/sim/match.ts) and the REAL data (core/data.ts loadGameData) drive BoutView exactly as game.ts does
// (snapshots + deduped events once per frame), so what the shots show is what the game shows. A "script" is a recorded
// input plan (P1 words per sim frame + dev writes at frames) built by a small policy (wait for FIGHT, fill SHOWTIME, walk
// in, press the Lv3 / special); `goto(F)` replays it deterministically to sim frame F (forward from the current frame, or
// from 0 when going back) and renders. window.__LAB__ = { ready, error, setup, prime, special, goto, run, perf, lineup,
// showcase, info }.

import * as THREE from 'three';
import { Renderer } from '../view/renderer.ts';
import { Assets } from '../view/assets.ts';
import { BoutView } from '../view/bout.ts';
import { FighterView } from '../view/fighters.ts';
import { Showcase } from '../view/showcase.ts';
import { animTableFor } from '../view/animtable.ts';
import { FrameProf } from '../view/frameprof.ts';
import { loadGameData } from '../core/data.ts';
import { createMatch, step, readMatch, readFighter, devSet } from '../core/sim/match.ts';
import { eventsSince, EV } from '../core/sim/events.ts';
import type { GameData, SimEvent } from '../core/types.ts';
import type { MatchCfg, Match } from '../core/sim/state.ts';

const W = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, L: 16, M: 32, H: 64, S: 128, ASSIST: 256 };

interface DevAct { f: number; p: 0 | 1; k: 'hp' | 'showtime' | 'nerve'; v: number }
interface Script { words: number[]; dev: DevAct[]; marks: Record<string, number>; note: string }

interface SimLab {
  ready: boolean; error: string | null;
  setup(p1: string, p2: string, opts?: { stage?: string; mode?: string; c1?: number; c2?: number; rounds?: number }): Promise<Record<string, unknown>>;
  prime(opts?: { phase2?: boolean; walkTo?: number }): Record<string, unknown>;
  special(key: string, opts?: { walkTo?: number; hold?: number; after?: number; phase2?: boolean }): Record<string, unknown>;
  ko(opts?: { key?: string }): Record<string, unknown>;
  idle(frames: number, opts?: { every?: number; word?: number; walk?: boolean }): Record<string, unknown>;
  closeup(i: number, opts?: { dist?: number; y?: number; side?: number }): Record<string, unknown>;
  view(pos: [number, number, number], look: [number, number, number], fov?: number, frames?: number): Record<string, unknown>;
  /** re-render the current picture and return it as a PNG data URL (no compositor round trip: works on a starved GPU) */
  snap(): string;
  goto(frame: number, opts?: { gore?: 'splatter' | 'sparks' | 'confetti'; cam?: 'full' | 'short' }): Record<string, unknown>;
  run(frames: number): Record<string, unknown>;
  perf(seconds: number, from: number, to: number): Promise<Record<string, unknown>>;
  lineup(ids: string[], opts?: { color?: number }): Promise<Record<string, unknown>>;
  showcase(id: string, color: number, pose: 'idle' | 'intro' | 'win', t: number, rect?: { x: number; y: number; w: number; h: number }): Promise<Record<string, unknown>>;
  info(): Record<string, unknown>;
  data: GameData | null;
}

export async function simMain(fail: (e: unknown) => void): Promise<void> {
  const Q = new URLSearchParams(location.search);
  const hudEl = document.getElementById('hud')!;
  if (Q.get('hud') === '0') hudEl.style.display = 'none';
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const q = Q.get('quality');
  const r = new Renderer(canvas, { quality: q === 'low' || q === 'med' ? q : 'high', touch: false });
  const assets = new Assets();
  const data = loadGameData();
  const prof = Q.get('prof') === '1' ? new FrameProf(r.three) : null;
  let bout: BoutView | null = null;
  let cfg: MatchCfg | null = null;
  let m: Match | null = null;
  let script: Script = { words: [], dev: [], marks: {}, note: '' };
  let cur = -1;                      // steps applied to `m`
  const seen = new Set<string>();
  const evBuf: SimEvent[] = [];
  let lastFrame = 0;
  let lineupExtra: FighterView[] = [];
  let show: Showcase | null = null;
  let showActive = false;

  const lab: SimLab = {
    ready: false, error: null, data,
    setup: async () => ({}), prime: () => ({}), special: () => ({}), ko: () => ({}), idle: () => ({}), closeup: () => ({}), view: () => ({}), snap: () => '', goto: () => ({}), run: () => ({}),
    perf: async () => ({}), lineup: async () => ({}), showcase: async () => ({}), info: () => ({}),
  };
  (window as unknown as { __LAB__: SimLab }).__LAB__ = lab;

  const fresh = (): Match => {
    const mm = createMatch(cfg!, data);
    seen.clear(); lastFrame = 0; cur = 0;
    return mm;
  };
  const newEvents = (mm: Match): SimEvent[] => {
    evBuf.length = 0;
    eventsSince(mm.events, Math.max(0, lastFrame - 16), evBuf);
    const out: SimEvent[] = [];
    for (const e of evBuf) { const k = `${e.frame}:${e.type}:${e.a}:${e.b}`; if (!seen.has(k)) { seen.add(k); out.push(e); } }
    lastFrame = Math.max(lastFrame, mm.frame());
    return out;
  };
  /** one sim step of the script + one view frame */
  const tick = (mm: Match, i: number, view: boolean, dt = 1 / 60): void => {
    for (const d of script.dev) if (d.f === i) devSet(mm, d.p, d.k, d.v);
    step(mm, script.words[i] ?? 0, 0);
    cur = i + 1;
    const ev = newEvents(mm);
    if (view && bout) bout.frame(readMatch(mm), [readFighter(mm, 0), readFighter(mm, 1)], ev, dt);
  };
  const hud = (extra = '') => {
    if (!bout) return;
    const i = bout.info() as { camera: { mode: string; dist: number } };
    hudEl.textContent = `VIEW LAB (sim) ${cfg?.p[0].fighter} vs ${cfg?.p[1].fighter} step ${cur} cam ${i.camera.mode} d=${i.camera.dist.toFixed(2)}${extra}`;
  };

  lab.setup = async (p1, p2, opts = {}) => {
    const stage = opts.stage ?? 'rust_theater';
    const mode = (opts.mode ?? 'versus') as MatchCfg['mode'];
    const want: MatchCfg = { mode, stage, seed: 1, timer: mode === 'brawl' || mode === 'heckler' ? undefined : 0, rounds: opts.rounds, p: [{ fighter: p1, color: opts.c1 ?? 0, scheme: 0, cpu: -1 }, { fighter: p2, color: opts.c2 ?? 0, scheme: 0, cpu: -1 }] };
    const same = cfg && bout && cfg.stage === stage && cfg.mode === mode && cfg.rounds === opts.rounds && cfg.p[0].fighter === p1 && cfg.p[1].fighter === p2
      && cfg.p[0].color === want.p[0].color && cfg.p[1].color === want.p[1].color;
    cfg = want;
    const t0 = performance.now();
    for (const f of lineupExtra) f.dispose();
    lineupExtra = [];
    if (!same) {
      bout?.dispose();
      bout = null;
      bout = await BoutView.create(r, assets, cfg, data, { warm: Q.get('nowarm') !== '1' });
      (lab as unknown as { bout: BoutView }).bout = bout;
    }
    m = fresh();
    script = { words: [], dev: [], marks: {}, note: '' };
    bout!.resetPresentation();
    return { createMs: Math.round(performance.now() - t0), reused: !!same, ...bout!.info() };
  };

  /** record a script with a policy; returns the marks */
  const record = (policy: (mm: Match, i: number, s: Script) => number | null, maxF: number): Script => {
    const s: Script = { words: [], dev: [], marks: {}, note: '' };
    const mm = createMatch(cfg!, data);
    for (let i = 0; i < maxF; i++) {
      const w = policy(mm, i, s);
      if (w === null) break;
      s.words[i] = w;
      for (const d of s.dev) if (d.f === i) devSet(mm, d.p, d.k, d.v);
      step(mm, w, 0);
    }
    return s;
  };

  const gapOf = (mm: Match) => Math.abs(readFighter(mm, 1).x - readFighter(mm, 0).x);

  lab.prime = (opts = {}) => {
    const walkTo = opts.walkTo ?? 0.95;
    let stage = 0, t0 = 0, cineAt = -1, lockAt = -1, endAt = -1, pressAt = -1, fightAt = -1;
    const lv3 = W.DOWN | W.S | W.H;
    script = record((mm, i, s) => {
      const ms = readMatch(mm);
      const f0 = readFighter(mm, 0);
      if (stage === 0) { if (ms.phase === 'fight') { stage = opts.phase2 ? 5 : 1; fightAt = i; s.dev.push({ f: i, p: 0, k: 'showtime', v: 30000 }); if (opts.phase2) s.dev.push({ f: i, p: 0, k: 'hp', v: Math.floor(f0.hpMax * 0.4) }); t0 = i; } return 0; }
      if (stage === 5) { if (i - t0 > 4 && (ms.freeze ?? 0) === 0) { stage = 1; t0 = i; } return 0; }
      if (stage === 1) { if (gapOf(mm) > walkTo && i - t0 < 150) return W.RIGHT; stage = 2; t0 = i; return 0; }
      if (stage === 2) { if (i - t0 < 3) return 0; stage = 3; t0 = i; pressAt = i; return lv3; }
      if (stage === 3) { if (i - t0 < 2) return lv3; stage = 4; t0 = i; return 0; }
      // stage 4: wait for the cinematic (or the grab-super lock), then run it out + 30 frames
      const ci = ms.cinematic;
      if (ci.active && cineAt < 0) cineAt = i;
      const t = readFighter(mm, 0);
      if (lockAt < 0 && t.moveKind === 'super3' && t.animId >= 34 + Object.keys(data.fighters[cfg!.p[0].fighter].moves).length) lockAt = i;
      if (cineAt >= 0 && !ci.active && endAt < 0) endAt = i;
      if (lockAt >= 0 && cineAt < 0 && t.moveKind !== 'super3' && endAt < 0) endAt = i;
      if (endAt >= 0 && i - endAt > 30) return null;
      if (cineAt < 0 && lockAt < 0 && i - t0 > 150) return null;
      return 0;
    }, 900);
    script.marks = { fightAt, pressAt, cineAt, lockAt, endAt };
    const def = data.fighters[cfg!.p[0].fighter];
    const mk = def.simple?.[opts.phase2 ? 'S+H+2' : 'S+H+2'] ?? '';
    const start = cineAt >= 0 ? cineAt : lockAt;
    script.note = start >= 0 ? (cineAt >= 0 ? 'cinematic' : 'grab-lock') : 'NO CINEMATIC';
    return { ...script.marks, steps: script.words.length, note: script.note, simpleLv3: mk };
  };

  const specialWord = (key: string): number => {
    switch (key) {
      case '5S': return W.S;
      case '6S': return W.RIGHT | W.S;
      case '4S': return W.LEFT | W.S;
      case '2S': return W.DOWN | W.S;
      case 'S+H': return W.S | W.H;
      case 'S+H+2': return W.DOWN | W.S | W.H;
      default: return W.S;
    }
  };

  lab.special = (key, opts = {}) => {
    let stage = 0, t0 = 0, spawnAt = -1, pressAt = -1;
    const word = specialWord(key);
    const hold = opts.hold ?? 2;
    const after = opts.after ?? 90;
    script = record((mm, i, s) => {
      const ms = readMatch(mm);
      if (stage === 0) {
        if (ms.phase === 'fight') {
          stage = opts.phase2 ? 5 : 1; t0 = i; s.dev.push({ f: i, p: 0, k: 'showtime', v: 30000 });
          if (opts.phase2) s.dev.push({ f: i, p: 0, k: 'hp', v: Math.floor(readFighter(mm, 0).hpMax * 0.4) });
        }
        return 0;
      }
      if (stage === 5) { if (i - t0 > 4 && (ms.freeze ?? 0) === 0) { stage = 1; t0 = i; } return 0; }
      if (stage === 1) { if (opts.walkTo !== undefined && gapOf(mm) > opts.walkTo && i - t0 < 150) return W.RIGHT; stage = 2; t0 = i; return 0; }
      if (stage === 2) { if (i - t0 < 4) return 0; stage = 3; t0 = i; pressAt = i; return word; }
      if (stage === 3) { if (i - t0 < hold) return word; stage = 4; t0 = i; return 0; }
      if (spawnAt < 0 && (ms.proj?.length ?? 0) > 0) spawnAt = i;
      if (i - t0 > after) return null;
      return 0;
    }, 900);
    script.marks = { pressAt, spawnAt };
    return { ...script.marks, steps: script.words.length };
  };

  // a match-deciding KO (setup with rounds: 1): P2 at 1 HP, walk in, one heavy
  lab.ko = (opts = {}) => {
    let stage = 0, t0 = 0, koAt = -1, pressAt = -1;
    const word = opts.key === 'L' ? W.L : opts.key === 'M' ? W.M : W.H;
    script = record((mm, i, s) => {
      const ms = readMatch(mm);
      if (stage === 0) { if (ms.phase === 'fight') { stage = 1; t0 = i; s.dev.push({ f: i, p: 1, k: 'hp', v: 1 }); } return 0; }
      if (stage === 1) { if (gapOf(mm) > 1.0 && i - t0 < 150) return W.RIGHT; stage = 2; t0 = i; return 0; }
      if (stage === 2) { if (i - t0 < 3) return 0; stage = 3; t0 = i; pressAt = i; return word; }
      if (stage === 3) { stage = 4; return 0; }
      if (koAt < 0 && (ms.phase === 'ko' || ms.phase === 'matchEnd' || ms.phase === 'roundEnd')) koAt = i;
      if (koAt < 0 && i - t0 > 120) { stage = 2; t0 = i; return 0; }
      if (koAt >= 0 && i - koAt > 280) return null;
      return 0;
    }, 1200);
    script.marks = { pressAt, koAt };
    return { ...script.marks, steps: script.words.length };
  };

  // wait for FIGHT, then N frames (optionally pressing `word` every `every` frames, walking toward the action)
  lab.idle = (frames, opts = {}) => {
    let stage = 0, t0 = 0;
    script = record((mm, i) => {
      const ms = readMatch(mm);
      if (stage === 0) { if (ms.phase === 'fight') { stage = 1; t0 = i; } return 0; }
      if (i - t0 >= frames) return null;
      let w = 0;
      if (opts.every && (i - t0) % opts.every < 2) w |= opts.word ?? W.L;
      if (opts.walk && (i - t0) % 90 < 20) w |= W.RIGHT;
      return w;
    }, frames + 400);
    script.marks = { fightAt: t0 };
    return { ...script.marks, steps: script.words.length };
  };

  // a close camera on fighter i (props / face check): a fixed pose in front of its chest
  lab.closeup = (i, opts = {}) => {
    if (!bout) throw new Error('setup first');
    const f = bout.fighters[i === 1 ? 1 : 0];
    const c = f.chest(new THREE.Vector3());
    const side = opts.side ?? 1;
    const d = opts.dist ?? 1.9;
    bout.cam.setCinematic({ pos: new THREE.Vector3(c.x + side * 0.55, (opts.y ?? c.y) + 0.05, d), look: new THREE.Vector3(c.x, opts.y ?? c.y - 0.1, 0), fov: 34, roll: 0 });
    bout.cam.update(1 / 60, [{ x: -1, y: 0, head: 1.8 }, { x: 1, y: 0, head: 1.8 }], r.css.x / Math.max(1, r.css.y), 0);
    bout.render();
    return { chest: [c.x, c.y, c.z], props: f.propInfo() };
  };

  // a fixed camera (stage dressing views); `frames` more sim steps are played under it so animated dressing moves
  lab.view = (pos, look, fov = 40, frames = 0) => {
    if (!bout || !m) throw new Error('setup first');
    const pose = { pos: new THREE.Vector3(pos[0], pos[1], pos[2]), look: new THREE.Vector3(look[0], look[1], look[2]), fov, roll: 0 };
    for (let i = 0; i < frames && cur < script.words.length; i++) { tick(m, cur, true); bout.cam.setCinematic(pose); }
    bout.cam.setCinematic(pose);
    bout.cam.update(1 / 60, [{ x: -1, y: 0, head: 1.8 }, { x: 1, y: 0, head: 1.8 }], r.css.x / Math.max(1, r.css.y), 0);
    bout.render();
    return { step: cur, stage: (bout.info() as { stage?: unknown }).stage };
  };

  lab.snap = () => {
    if (bout) bout.render();
    if (showActive && show) show.render();
    return canvas.toDataURL('image/png');
  };

  lab.goto = (frame, opts = {}) => {
    if (!bout || !cfg) throw new Error('setup first');
    showActive = false;
    if (opts.gore) bout.setSettings({ splatter: opts.gore });
    if (opts.cam) bout.setSettings({ cinematicCamera: opts.cam });
    const F = Math.max(0, Math.min(frame, script.words.length));
    if (!m || F < cur) { m = fresh(); bout.resetPresentation(); }
    for (let i = cur; i < F; i++) tick(m, i, true);
    bout.render();
    hud();
    const ms = readMatch(m);
    return { step: cur, simFrame: m.frame(), phase: ms.phase, cinematic: ms.cinematic, simProj: ms.proj, f: [readFighter(m, 0), readFighter(m, 1)].map((x) => ({ x: +x.x.toFixed(3), y: +x.y.toFixed(3), hp: x.hp, animId: x.animId, animFrame: x.animFrame, moveName: x.moveName, moveKind: x.moveKind })), ...bout.info() };
  };

  lab.run = (frames) => lab.goto(cur + frames);

  // real-time replay of a window (G9): script frames [from, to) looped, one sim step + one view frame per rAF
  lab.perf = async (seconds, from, to) => {
    if (!bout || !cfg) throw new Error('setup first');
    lab.goto(from);
    const d: number[] = [];
    let last = performance.now();
    const t0 = last;
    prof?.reset();
    await new Promise<void>((res) => {
      const loop = (now: number) => {
        const raw = now - last; last = now;
        prof?.begin();
        if (cur >= to) { m = fresh(); bout!.resetPresentation(); for (let i = 0; i < from; i++) tick(m, i, false); }
        tick(m!, cur, true, Math.min(0.1, raw / 1000));
        prof?.mark('frame');
        prof?.gpuBegin();
        bout!.render();
        prof?.gpuEnd();
        prof?.mark('render');
        prof?.end(raw, 1, 0, r.three.info, 'perf');
        r.frameTime(raw, true);
        d.push(raw);
        if (now - t0 < seconds * 1000 + 1500) requestAnimationFrame(loop); else res();
      };
      requestAnimationFrame(loop);
    });
    const warm = Math.min(d.length, Math.round(90));
    const s = d.slice(warm).sort((a, b) => a - b);
    const pct = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : 0);
    const inf = r.info();
    return { frames: s.length, p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: s[s.length - 1] ?? 0,
      avgFps: s.length ? 1000 * s.length / s.reduce((a, b) => a + b, 0) : 0, calls: inf.calls, triangles: inf.triangles, programs: inf.programs,
      gpu: inf.gpu, buffer: (inf as { buffer?: unknown }).buffer, scale: inf.scale, prof: prof ? prof.dump() : null };
  };

  // the roster standing in a row on the set (G5 lineup): extra FighterViews in the bout scene, a fixed wide camera
  lab.lineup = async (ids, opts = {}) => {
    if (!bout || !cfg) throw new Error('setup first');
    for (const f of lineupExtra) f.dispose();
    lineupExtra = [];
    const n = ids.length;
    const span = Math.min(14.5, n * 1.25);
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const a = await assets.fighter(id);
      const fv = new FighterView(assets, a, animTableFor(data, id), data.fighters[id], opts.color ?? 0, true);
      bout.scene.add(fv.root);
      lineupExtra.push(fv);
      const x = -span / 2 + (i + 0.5) * (span / n);
      fv.update({ x, y: 0, facing: x < 0 ? 1 : -1, animId: 0, animFrame: 20 + i * 7, prevAnimId: 0, prevAnimFrame: 0, blendT: 1 }, 0, 0);
      fv.root.rotation.y = x < 0 ? 0.45 : -0.45;         // 3/4 toward the camera and the centre, never mirrored
      fv.root.scale.x = 1;
    }
    bout.fighters[0].root.visible = false; bout.fighters[1].root.visible = false;
    const cam = bout.cam.camera;
    bout.cam.setCinematic({ pos: new THREE.Vector3(0, 1.6, 11.8), look: new THREE.Vector3(0, 1.05, 0), fov: 35, roll: 0 });
    bout.cam.update(1 / 60, [{ x: -1, y: 0, head: 1.8 }, { x: 1, y: 0, head: 1.8 }], r.css.x / Math.max(1, r.css.y), 0);
    void cam;
    bout.render();
    return { lineup: ids, heights: lineupExtra.map((f) => +f.heightM.toFixed(2)) };
  };

  lab.showcase = async (id, color, pose, t, rect) => {
    if (!show) show = new Showcase(r, assets, data);
    showActive = true;
    show.spin = 0;
    await show.show(id, color, pose);
    show.frame(t);
    if (bout) bout.render();
    show.setRect(rect ?? { x: 1060, y: 80, w: 460, h: 740 });
    show.render();
    return { id, color, pose, t };
  };

  lab.info = () => ({ ...(bout ? bout.info() : {}), step: cur, steps: script.words.length, marks: script.marks, note: script.note, bytes: assets.bytes });

  // default pair
  try {
    await lab.setup(Q.get('p1') ?? 'johnny', Q.get('p2') ?? 'bruno', { stage: Q.get('stage') ?? 'rust_theater', mode: Q.get('mode') ?? 'versus' });
    lab.goto(1);
    lab.ready = true;
  } catch (e) { fail(e); }
  void EV;
}
