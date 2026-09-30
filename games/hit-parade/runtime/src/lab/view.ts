// HIT PARADE - VIEW lab (dev only; runtime/lab/view.html is never linked from index.html, so never in the build).
//
// Drives BoutView with SCRIPTED snapshots + events (no sim) to prove pose-from-state, the camera, FX and the toon look:
//   ?scene=idle|walk|jump|attack|knockdown|wallsplat|super|ko|parry|fx|lineup   ?sep=<m> (idle / lineup separation)
//   ?frame=<n> (render exactly that scripted frame after stepping 0..n at 1/60 s)  ?play=1 (loop in real time)
//   ?gore=splatter|sparks|confetti  ?crowd=0  ?outline=0  ?post=0  ?bloom=0|1  ?quality=low|med|high  ?prof=1  ?hud=0
//   ?stage=<id> (default rust_theater; the stand-in set when its GLB is not there yet)  ?real=1 (art/gltf fighters)
// Fighters: runtime/lab/assets/{johnny,bruno}.glb (Ch42 realistic body / Brute painted body, 14 Mixamo clips each,
// built by lab/assets/build_lab_glb.py) unless ?real=1 and art/gltf/fighters/<id>.glb exist.
// The script is a tiny deterministic "sim": per-fighter anim segments, a global time-warp list (hitstop / super
// freeze = rate 0, KO slow-mo = rate 1/4 - sim frames advance every 4th frame), events at frames. animFrame never
// advances inside a rate-0 window, exactly like the sim (CONTRACT §17 rule 3).
// window.__LAB__: { ready, error, run(scene, frame, opts), play(scene), stop(), perf(seconds), info(), profDump() }.

import { Renderer } from '../view/renderer.ts';
import { Assets } from '../view/assets.ts';
import { BoutView } from '../view/bout.ts';
import { FrameProf } from '../view/frameprof.ts';
import { EV } from '../view/ev.ts';
import { Showcase } from '../view/showcase.ts';
import STAGES from '../../../data/stages.json' with { type: 'json' };
import SYSTEM from '../../../data/system.json' with { type: 'json' };
import type { ViewEvent, ViewFighterSnap, ViewGameData, ViewMatchSnap } from '../view/types.ts';

// G0 guard: SIM's real snapshot / data / event types must stay assignable to the view's structural types
// (a type-only check - erased at runtime; breaks `npm run typecheck` if the shapes drift apart).
import type { FighterSnap, MatchSnap, GameData, SimEvent } from '../core/types.ts';
import type { ViewFighterSnap as VF, ViewMatchSnap as VM, ViewGameData as VG, ViewEvent as VE } from '../view/types.ts';
type Assignable<A, B> = A extends B ? true : false;
export const VIEW_TYPES_OK: [Assignable<FighterSnap, VF>, Assignable<MatchSnap, VM>, Assignable<GameData, VG>, Assignable<SimEvent, VE>] =
  [true, true, true, true];

const Q = new URLSearchParams(location.search);
const hudEl = document.getElementById('hud')!;
const errEl = document.getElementById('err')!;
if (Q.get('hud') === '0') hudEl.style.display = 'none';

// ───────────────────────────── lab data (the fighter JSON subset the view reads) ─────────────────────────────

const MOVES = {
  hook_h: { kind: 'normal', startup: 8, active: 3, recovery: 23, anim: { clip: 'lab_hook', warp: [[0, 0], [8, 0.30], [11, 0.40], [34, 1.1]] } },
  kick_h: { kind: 'normal', startup: 12, active: 3, recovery: 25, anim: { clip: 'lab_kick', warp: [[0, 0], [12, 0.70], [15, 0.80], [40, 1.87]] } },
  prime_time: {
    kind: 'super3', startup: 10, active: 2, recovery: 30, cinematic: { frames: 150, cue: 'generic_prime_time' },
    anim: { clip: 'lab_super', warp: [[0, 0], [5, 0.7], [10, 1.0], [160, 2.97]] },
  },
};
const DATA: ViewGameData = {
  fighters: {
    johnny: { id: 'johnny', body: 'Ch42_nonPBR', heightM: 1.80, colors: [{ name: 'Headliner', tint: null }, { name: 'Alt', tint: '#2f7bff' }], moves: MOVES, win: ['win1'] },
    bruno: { id: 'bruno', body: 'Brute', heightM: 1.95, colors: [{ name: 'Fridge', tint: null }, { name: 'Alt', tint: '#35d07f' }], moves: MOVES, win: ['win1'] },
  },
  clips: {},
  stages: STAGES,          // lane STAGES' stages.json: light pool, environment, fog, crowd atlas
  system: SYSTEM,          // lane SIM's system.json: super freeze frames
};
// §17 anim ids for this table: system 0..33, moves 34.., extras after
const A = { idle: 0, walk_f: 1, walk_b: 2, jump_up: 5, block: 11, hit_s: 13, hit_l: 14, kd_fall_b: 19, wake_b: 23, ko_fall: 29, hook: 34, kick: 35, prime: 36, win: 38 };   // 37 = intro ('' -> idle), 38 = win1, 39 = taunt
const MOVE_ID = { hook_h: 0, kick_h: 1, prime_time: 2 };

// ───────────────────────────── the scripted "sim" ─────────────────────────────

interface Seg { at: number; anim: number; x?: number | ((simT: number, F: number) => number); y?: (simT: number) => number; facing?: number }
interface Warp { start: number; end: number; rate: number }
interface Script {
  frames: number;
  p: [Seg[], Seg[]];
  warps: Warp[];
  ev: Array<[number, keyof typeof EV, number, number, number, number]>;
  cine?: { start: number; frames: number; fighter: number; cueId: number };
  showtime?: [number, number];
}

function simT(s: Script, F: number): number {
  // sim frames elapsed at real frame F (hitstop / freeze = 0 per frame, slow-mo = 1/4)
  let t = 0;
  for (let f = 0; f < F; f++) {
    let r = 1;
    for (const w of s.warps) if (f >= w.start && f < w.end) r = Math.min(r, w.rate);
    t += r;
  }
  return Math.floor(t + 1e-6);
}

function hitstopAt(s: Script, F: number): number {
  for (const w of s.warps) if (w.rate === 0 && F >= w.start && F < w.end) return w.end - F;
  return 0;
}

function fighterAt(s: Script, i: number, F: number, sep: number): ViewFighterSnap {
  const segs = s.p[i];
  let k = 0;
  while (k + 1 < segs.length && segs[k + 1].at <= F) k++;
  const cur = segs[k], prev = k > 0 ? segs[k - 1] : cur;
  const tNow = simT(s, F);
  const animFrame = tNow - simT(s, cur.at);
  const prevFrame = tNow - simT(s, prev.at);
  const blendT = k > 0 ? Math.min(1, (tNow - simT(s, cur.at)) / 6) : 1;
  let x = i === 0 ? -sep / 2 : sep / 2;
  for (let j = 0; j <= k; j++) { const sx = segs[j].x; if (sx !== undefined) x = typeof sx === 'number' ? sx : sx(tNow - simT(s, segs[j].at), F); }
  let facing = i === 0 ? 1 : -1;
  for (let j = 0; j <= k; j++) if (segs[j].facing !== undefined) facing = segs[j].facing!;
  const y = cur.y ? Math.max(0, cur.y(animFrame)) : 0;
  return {
    x, y, facing, animId: cur.anim, animFrame, prevAnimId: prev.anim, prevAnimFrame: prevFrame, blendT,
    hitstop: hitstopAt(s, F), showtime: s.showtime ? s.showtime[i] : 12000, hp: 10000, hpMax: 10000, flags: {},
  };
}

function matchAt(s: Script, F: number): ViewMatchSnap {
  const c = s.cine;
  const slow = s.warps.some((w) => w.rate > 0 && w.rate < 1 && F >= w.start && F < w.end);
  const active = !!c && F >= c.start && F < c.start + c.frames;
  return {
    frame: F, round: 1, phase: 'fight', slowmo: slow,
    cinematic: { active, fighter: c ? c.fighter : 0, cueId: c ? c.cueId : -1, frame: active && c ? F - c.start : 0 },
  };
}

function eventsAt(s: Script, F: number): ViewEvent[] {
  const out: ViewEvent[] = [];
  for (const e of s.ev) if (e[0] === F) out.push({ frame: F, type: EV[e[1]], a: e[2], b: e[3], c: e[4], d: e[5] });
  return out;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

function makeScript(name: string, sep: number): Script {
  const idle = (i: number): Seg[] => [{ at: 0, anim: A.idle }];
  switch (name) {
    case 'walk': return {
      frames: 180, warps: [], ev: [],
      p: [[{ at: 0, anim: A.idle }, { at: 10, anim: A.walk_f, x: (t) => -sep / 2 + t * 2.12 / 60 },
        { at: 70, anim: A.walk_b, x: (t) => -sep / 2 + 60 * 2.12 / 60 - t * 1.44 / 60 }, { at: 150, anim: A.idle, x: -sep / 2 + 60 * 2.12 / 60 - 80 * 1.44 / 60 }], idle(1)],
    };
    case 'jump': return {
      frames: 90, warps: [], ev: [],
      p: [[{ at: 0, anim: A.idle }, { at: 10, anim: A.jump_up, y: (t) => (t < 4 ? 0 : 1.59 * Math.sin(Math.PI * Math.min(1, (t - 4) / 38))) }, { at: 56, anim: A.idle }], idle(1)],
    };
    case 'attack': return {
      frames: 130, showtime: [15000, 9000],
      warps: [{ start: 28, end: 43, rate: 0 }, { start: 82, end: 95, rate: 0 }],
      ev: [[28, 'HIT', 0, 1, 2, 150], [28, 'COUNTER', 0, 1, 2, 150], [82, 'BLOCK', 0, 1, 2, 110]],
      p: [
        [{ at: 0, anim: A.idle, x: -0.65 }, { at: 20, anim: A.hook }, { at: 60, anim: A.idle }, { at: 70, anim: A.kick }, { at: 120, anim: A.idle }],
        [{ at: 0, anim: A.idle, x: 0.65 }, { at: 28, anim: A.hit_l, x: (t) => lerp(0.65, 0.95, (t - 0) / 10) }, { at: 66, anim: A.block, x: 0.95 }, { at: 110, anim: A.idle }],
      ],
    };
    case 'knockdown': return {
      frames: 320, warps: [{ start: 32, end: 45, rate: 0 }],
      ev: [[32, 'HIT', 0, 1, 2, 120], [32, 'KNOCKDOWN', 1, 0, 0, 0], [100, 'GROUND_BOUNCE', 1, 0, 0, 0]],
      p: [
        [{ at: 0, anim: A.idle, x: -0.6 }, { at: 20, anim: A.kick }, { at: 75, anim: A.idle }],
        [{ at: 0, anim: A.idle, x: 0.75 }, { at: 32, anim: A.kd_fall_b, x: (t) => lerp(0.75, 2.1, t / 45) }, { at: 200, anim: A.wake_b }, { at: 300, anim: A.idle }],
      ],
    };
    case 'wallsplat': return {
      frames: 150, warps: [{ start: 32, end: 50, rate: 0 }],
      ev: [[32, 'HIT', 0, 1, 2, 130], [34, 'WALL_SPLAT', 1, 1, 0, 0]],
      p: [
        [{ at: 0, anim: A.idle, x: 6.2 }, { at: 20, anim: A.kick }, { at: 75, anim: A.idle }],
        [{ at: 0, anim: A.idle, x: 7.35 }, { at: 32, anim: A.hit_l, x: 7.55 }, { at: 120, anim: A.idle }],
      ],
    };
    case 'super': return {
      frames: 260, showtime: [30000, 8000],
      warps: [{ start: 25, end: 70, rate: 0 }],
      ev: [[25, 'SUPER_FREEZE', 0, 3, 0, 0], [75, 'CINEMATIC_START', 0, 2, 0, 0], [105, 'SUPER_HIT', 0, 1, 4, 140], [135, 'SUPER_HIT', 0, 1, 4, 150],
        [165, 'SUPER_HIT', 0, 1, 4, 130], [205, 'SUPER_HIT', 0, 1, 4, 150], [225, 'CINEMATIC_END', 0, 2, 0, 0]],
      cine: { start: 75, frames: 150, fighter: 0, cueId: MOVE_ID.prime_time },
      p: [
        [{ at: 0, anim: A.idle, x: -0.8 }, { at: 20, anim: A.prime }, { at: 240, anim: A.idle }],
        [{ at: 0, anim: A.idle, x: 0.8 }, { at: 105, anim: A.hit_s }, { at: 135, anim: A.hit_l }, { at: 165, anim: A.hit_s },
          { at: 205, anim: A.kd_fall_b, x: (t) => lerp(0.8, 1.9, t / 40) }],
      ],
    };
    case 'ko': return {
      frames: 260, showtime: [26000, 20000],
      warps: [{ start: 32, end: 62, rate: 0 }, { start: 62, end: 107, rate: 0.25 }],
      ev: [[32, 'HIT', 0, 1, 2, 150], [32, 'KO', 0, 1, 1, 0]],
      p: [
        [{ at: 0, anim: A.idle, x: -0.6 }, { at: 20, anim: A.kick }, { at: 150, anim: A.win }],
        [{ at: 0, anim: A.idle, x: 0.8 }, { at: 32, anim: A.ko_fall, x: (t) => lerp(0.8, 2.3, t / 50) }],
      ],
    };
    case 'parry': return {
      frames: 150,
      warps: [{ start: 28, end: 88, rate: 0 }, { start: 103, end: 120, rate: 0 }],
      ev: [[28, 'PERFECT_PARRY', 1, 0, 2, 150], [103, 'HIT', 0, 1, 2, 150], [103, 'PUNISH', 0, 1, 2, 150]],
      p: [
        [{ at: 0, anim: A.idle, x: -0.65 }, { at: 22, anim: A.block }, { at: 90, anim: A.idle }, { at: 95, anim: A.hook }, { at: 135, anim: A.idle }],
        [{ at: 0, anim: A.idle, x: 0.65 }, { at: 20, anim: A.hook }, { at: 60, anim: A.idle }, { at: 103, anim: A.hit_l, x: (t) => lerp(0.65, 1.0, t / 10) }, { at: 140, anim: A.idle }],
      ],
    };
    case 'fx': return {
      frames: 330, showtime: [20000, 20000],
      warps: [],
      ev: [[10, 'HIT', 0, 1, 0, 140], [40, 'HIT', 0, 1, 1, 130], [70, 'HIT', 0, 1, 2, 150], [100, 'COUNTER', 0, 1, 2, 150], [130, 'PUNISH', 0, 1, 2, 150],
        [160, 'BLOCK', 0, 1, 2, 120], [190, 'PARRY', 0, 1, 1, 140], [220, 'IMPACT_START', 0, 0, 0, 0], [226, 'IMPACT_ARMOR', 0, 1, 5, 0],
        [250, 'THROW', 0, 1, 7, 110], [280, 'WALL_SPLAT', 1, 1, 0, 0], [300, 'SUPER_FREEZE', 0, 1, 0, 0]],
      p: [[{ at: 0, anim: A.idle, x: -0.7 }], [{ at: 0, anim: A.idle, x: 0.7 }]],
    };
    case 'lineup':
    case 'idle':
    default: return { frames: 120, warps: [], ev: [], p: [[{ at: 0, anim: A.idle, x: -sep / 2 }], [{ at: 0, anim: A.idle, x: sep / 2 }]] };
  }
}

// ───────────────────────────── page ─────────────────────────────

interface LabApi {
  ready: boolean; error: string | null; scene: string; frame: number;
  run(scene: string, frame: number, opts?: { sep?: number; gore?: 'splatter' | 'sparks' | 'confetti' }): Record<string, unknown>;
  play(scene: string, sep?: number): void;
  stop(): void;
  perf(seconds: number, scene?: string): Promise<Record<string, unknown>>;
  info(): Record<string, unknown>;
  profDump(): unknown;
}
declare global { interface Window { __LAB__: LabApi } }

const lab: LabApi = {
  ready: false, error: null, scene: '', frame: 0,
  run: () => ({}), play: () => {}, stop: () => {}, perf: async () => ({}), info: () => ({}), profDump: () => null,
};
window.__LAB__ = lab;

function fail(e: unknown): void {
  const msg = e instanceof Error ? (e.stack || e.message) : String(e);
  lab.error = msg;
  errEl.style.display = 'block';
  errEl.textContent = 'VIEW LAB FAILED\n' + msg;
  console.error(e);
}

async function main(): Promise<void> {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const q = Q.get('quality');
  const r = new Renderer(canvas, { quality: q === 'low' || q === 'med' ? q : 'high', touch: false });
  if (Q.get('shadow') === '0') r.three.shadowMap.enabled = false;
  const assets = new Assets();
  const real = Q.get('real') === '1';
  if (!real) {
    assets.setUrl('fighter', 'johnny', new URL('./assets/johnny.glb', location.href).href);
    assets.setUrl('fighter', 'bruno', new URL('./assets/bruno.glb', location.href).href);
  } else {
    // ASSETS' shipping GLBs carry the 34 shared clips only (move clips come per kit): stand the lab moves in on
    // shared strike-like clips so the scripts still animate
    const remap: Record<string, string> = { lab_hook: 'shove', lab_kick: 'impact_windup', lab_super: 'impact_windup' };
    for (const f of Object.values(DATA.fighters)) {
      for (const m of Object.values(f.moves)) if (m.anim && remap[m.anim.clip]) (m.anim as { clip: string }).clip = remap[m.anim.clip];
      (f as { win?: string[] }).win = ['idle'];
    }
  }
  // clip facts (dur / loop) from the GLBs, as ASSETS' clips.json would carry them
  const [ja, ba] = await Promise.all([assets.fighter('johnny'), assets.fighter('bruno')]);
  const facts = (m: Map<string, { duration: number }>) => {
    const o: Record<string, { dur: number; loop: boolean }> = {};
    for (const [k, c] of m) o[k] = { dur: c.duration, loop: /^(idle|walk_f|walk_b|block_high)$/.test(k) };
    return { clips: o };
  };
  (DATA as { clips: Record<string, unknown> }).clips = { johnny: facts(ja.clips), bruno: facts(ba.clips) };
  const color = Number(Q.get('color') ?? 0) | 0;
  const cfg = { mode: Q.get('mode') === 'brawl' ? 'brawl' : 'versus', stage: Q.get('stage') ?? 'rust_theater',
    p: [{ fighter: 'johnny', color }, { fighter: 'bruno', color }] };
  const t0 = performance.now();
  const bout = await BoutView.create(r, assets, cfg, DATA, { crowd: Q.get('crowd') !== '0', outline: Q.get('outline') !== '0', warm: Q.get('nowarm') !== '1' });
  // debug: per-object first-draw cost (with ?nowarm=1 this is each program's compile + link time)
  (lab as unknown as { progTimes: () => unknown }).progTimes = () => {
    const out: Array<[string, string, number]> = [];
    const objs: import('three').Object3D[] = [];
    bout.scene.traverse((o) => { if ((o as import('three').Mesh).material) objs.push(o); });
    const vis = objs.map((o) => o.visible);
    const gl = r.three.getContext();
    const px = new Uint8Array(4);
    for (const o of objs) {
      for (const x of objs) x.visible = false;
      let p = o.parent; while (p) { p.visible = true; p = p.parent; }
      o.visible = true;
      const t0 = performance.now();
      r.three.render(bout.scene, bout.cam.camera);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const m = (o as import('three').Mesh).material as import('three').Material | import('three').Material[];
      out.push([o.name || o.type, (Array.isArray(m) ? m.map((x) => x.name || x.type).join('+') : (m.name || m.type)), Math.round(performance.now() - t0)]);
    }
    objs.forEach((o, i) => { o.visible = vis[i]; });
    return out.sort((a, b) => b[2] - a[2]).slice(0, 40);
  };
  const createMs = performance.now() - t0;
  (lab as unknown as { bout: BoutView; renderer: Renderer }).bout = bout;          // dev lab: diagnostics handle
  (lab as unknown as { bout: BoutView; renderer: Renderer }).renderer = r;
  if (Q.get('post') === '0') bout.post.enabled = false;
  const gore = Q.get('gore');
  bout.setSettings({ splatter: gore === 'sparks' || gore === 'confetti' ? gore : 'splatter', bloom: Q.get('bloom') === '1' });
  const prof = Q.get('prof') === '1' ? new FrameProf(r.three) : null;

  let script = makeScript('idle', 1.6);
  let sep = Number(Q.get('sep') ?? 1.6) || 1.6;
  let playing = false;
  let playF = 0;
  let lineupYaw = false;

  const applyLineup = () => {
    if (!lineupYaw) return;
    bout.fighters[0].root.rotation.y = 0.45;
    bout.fighters[1].root.rotation.y = -0.45;
  };

  const step = (F: number, dt: number) => {
    const f: [ViewFighterSnap, ViewFighterSnap] = [fighterAt(script, 0, F, sep), fighterAt(script, 1, F, sep)];
    bout.frame(matchAt(script, F), f, eventsAt(script, F), dt);
    applyLineup();
  };

  const hud = (extra = '') => {
    const i = bout.info() as { camera: { mode: string; dist: number; sep: number; fill: number } };
    hudEl.textContent = `VIEW LAB  ${lab.scene}  frame ${lab.frame}  cam ${i.camera.mode} d=${i.camera.dist.toFixed(2)} m sep=${i.camera.sep.toFixed(2)} m fill=${(i.camera.fill * 100).toFixed(0)}%${extra}`;
  };

  lab.run = (scene, frame, opts = {}) => {
    playing = false;
    if (opts.sep !== undefined) sep = opts.sep;
    if (opts.gore) bout.setSettings({ splatter: opts.gore });
    script = makeScript(scene, sep);
    lineupYaw = scene === 'lineup';
    lab.scene = scene;
    bout.resetPresentation();
    const n = Math.max(0, Math.min(frame, script.frames * 4));
    for (let F = 0; F <= n; F++) step(F, 1 / 60);
    lab.frame = n;
    bout.render();
    hud();
    return bout.info();
  };

  lab.play = (scene, s) => {
    if (s !== undefined) sep = s;
    script = makeScript(scene, sep);
    lineupYaw = scene === 'lineup';
    lab.scene = scene;
    bout.resetPresentation();
    playF = 0;
    playing = true;
  };
  lab.stop = () => { playing = false; };
  lab.info = () => ({ ...bout.info(), createMs: Math.round(createMs), scene: lab.scene, frame: lab.frame, bytes: assets.bytes });
  lab.profDump = () => (prof ? prof.dump() : null);
  // char-select turntable in a canvas region over the bout frame (Showcase check)
  let show: Showcase | null = null;
  (lab as unknown as { showcase: (id: string, color: number, pose: 'idle' | 'intro' | 'win', t: number) => Promise<unknown> }).showcase =
    async (id, color, pose, t) => {
      if (!show) show = new Showcase(r, assets, DATA);
      show.spin = 0;
      await show.show(id, color, pose);
      show.frame(t);
      bout.render();
      show.setRect({ x: 1060, y: 80, w: 460, h: 740 });
      show.render();
      return { id, color, pose, t };
    };

  // real-time loop (play mode + perf sampling)
  let last = performance.now();
  let rec: number[] | null = null;
  let loopScene = '';
  const tick = (now: number) => {
    const raw = now - last;
    last = now;
    if (playing) {
      prof?.begin();
      if (playF >= script.frames) { script = makeScript(loopScene || lab.scene, sep); bout.resetPresentation(); playF = 0; }
      step(playF, Math.min(0.1, raw / 1000));
      lab.frame = playF;
      playF++;
      prof?.mark('frame');
      prof?.gpuBegin();
      bout.render();
      prof?.gpuEnd();
      prof?.mark('render');
      prof?.end(raw, 1, 0, r.three.info, 'play');
      r.frameTime(raw, false);
      if (rec) rec.push(raw);
      if (playF % 15 === 0) hud(`  ${(1000 / Math.max(1, raw)).toFixed(0)} fps`);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  lab.perf = async (seconds, scene = 'super') => {
    loopScene = scene;
    lab.play(scene);
    await new Promise((res) => setTimeout(res, 1500));      // settle
    prof?.reset();
    rec = [];
    await new Promise((res) => setTimeout(res, seconds * 1000));
    const d = rec.slice(1);
    rec = null;
    const s = d.slice().sort((a, b) => a - b);
    const pct = (p: number) => (s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] : 0);
    const inf = r.info();
    return { scene, frames: d.length, seconds, p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: s[s.length - 1] ?? 0,
      avgFps: d.length ? 1000 * d.length / d.reduce((a, b) => a + b, 0) : 0, calls: inf.calls, triangles: inf.triangles,
      programs: inf.programs, gpu: inf.gpu, buffer: inf.buffer, scale: inf.scale, prof: prof ? prof.dump() : null };
  };

  const scene0 = Q.get('scene') ?? 'idle';
  if (Q.get('play') === '1') lab.play(scene0);
  else lab.run(scene0, Number(Q.get('frame') ?? 60) | 0);
  lab.ready = true;
}

// ?sim=1: the real sim + real data drive the view (lab/viewsim.ts); otherwise the scripted-snapshot lab above
if (Q.get('sim') === '1') import('./viewsim.ts').then((mod) => mod.simMain(fail)).catch(fail);
else main().catch(fail);
