// HIT PARADE - UI game lab entry (lane UI; dev only: runtime/lab/ui_game.html, never linked from index.html).
//
// Boots the REAL game (../main.ts: the same renderer, sim, view, audio, menus, HUD, touch overlay) after applying the
// CONTRACT 27 SHELL requests to Game.prototype - exactly the lines 27.1 / 27.2 / 27.3 ask game.ts for:
//   27.1  training: a TrainingDriver per training bout (begin after createMatch), pending() + tick() in the tick,
//         frame(projector) after the HUD frame (the fight camera projects the sim's boxes), end() at teardown
//   27.2  online: (already in game.ts: NET P2 wired the Menus.onlineEvent forwards, CONTRACT 29.6)
//   27.3  MatchResult.rounds = BoutStats.rounds
// So the UI lane proves its side against the real modules before SHELL lands the wiring. Every patch is a wrapper that
// calls the original first; nothing else of game.ts changes. window.__UIGAME__ = { trainer() } read-back.

import * as THREE from 'three';
import { Game } from '../game.ts';
import { TrainingDriver, readBoxes } from '../ui/trainer.ts';
import { createMatch, step, readFighter, readMatch, devSet, type Match } from '../core/sim/match.ts';
import { createCpu } from '../core/ai/cpu.ts';
import type { OnlineEventName } from '../ui/types.ts';

interface BoutLike {
  cfg: { mode: string };
  m: Match;
  session: unknown;
  seen: Map<string, number>;
  lastFrame: number;
  view: { cam: { camera: THREE.PerspectiveCamera } };
  stats: { rounds: unknown[] };
  trainer?: TrainingDriver | null;
}
interface GameLike {
  bout: BoutLike | null;
  d: { menus: { training: ConstructorParameters<typeof TrainingDriver>[0]['opts']; onlineEvent(n: OnlineEventName, p?: unknown): void };
    data: ConstructorParameters<typeof TrainingDriver>[0]['data']; input: { sampleAll(w: [number, number]): [number, number] }; renderer: { three: THREE.WebGLRenderer } };
  hud: ConstructorParameters<typeof TrainingDriver>[0]['hud'];
  words: [number, number];
}
type AnyFn = (...a: unknown[]) => unknown;
const P = Game.prototype as unknown as Record<string, AnyFn>;

// 27.1 - startBout: attach the driver to a training bout
const origStart = P.startBout;
P.startBout = async function (this: GameLike, ...args: unknown[]) {
  await origStart.apply(this, args);
  const b = this.bout;
  if (b && b.cfg.mode === 'training' && !b.trainer) {
    b.trainer = new TrainingDriver({ opts: this.d.menus.training, data: this.d.data, hud: this.hud, sim: { createMatch, step, readFighter, readMatch, devSet }, cpu: createCpu });
    b.trainer.begin(b.cfg as Parameters<TrainingDriver['begin']>[0], b.m);
  }
};

// 27.1 - tick: the reset swap, then the driver's words
const origTick = P.tick;
P.tick = function (this: GameLike, ...args: unknown[]) {
  const b = this.bout;
  if (!b || !b.trainer || b.session) return origTick.apply(this, args);
  const nm = b.trainer.pending();
  if (nm) { b.m = nm; b.seen.clear(); b.lastFrame = nm.frame(); }
  const w = this.d.input.sampleAll(this.words);
  const [i1, i2] = b.trainer.tick(b.m, w);
  step(b.m, i1, i2);
  return undefined;
};

// 27.1 - frame: the HITBOX overlay, projected with the fight camera into CSS px of the page
const v3 = new THREE.Vector3();
const origFrame = P.frame;
P.frame = function (this: GameLike, ...args: unknown[]) {
  const r = origFrame.apply(this, args);
  const b = this.bout;
  if (b?.trainer) {
    const cam = b.view.cam.camera;
    const el = this.d.renderer.three.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    b.trainer.frame((x, y, z) => {
      v3.set(x, y, z).project(cam);
      return v3.z > 1 ? null : [((v3.x + 1) / 2) * w, ((1 - v3.y) / 2) * h];
    });
  }
  return r;
};

// 27.1 - teardown
const origTeardown = P.teardown;
P.teardown = function (this: GameLike, ...args: unknown[]) {
  this.bout?.trainer?.end();
  return origTeardown.apply(this, args);
};

// 27.2 - the NET event forwards to Menus.onlineEvent are in game.ts since NET P2 (CONTRACT 29.6): no patch needed

// 27.3 - MatchResult.rounds
const origBuild = P.buildResult;
P.buildResult = function (this: GameLike, ...args: unknown[]) {
  const r = origBuild.apply(this, args) as Record<string, unknown>;
  const b = args[0] as BoutLike | undefined;
  if (b && Array.isArray(b.stats?.rounds)) r.rounds = b.stats.rounds.slice();
  return r;
};

(window as unknown as Record<string, unknown>).__UIGAME__ = {
  patched: true,
  trainer: (): unknown => {
    const g = (window as unknown as { __HP_GAME__?: GameLike }).__HP_GAME__;
    return g?.bout?.trainer?.readback() ?? null;
  },
  /** the sim's boxes right now (world metres) - what the HITBOX overlay projects */
  boxes: (): unknown => {
    const g = (window as unknown as { __HP_GAME__?: GameLike }).__HP_GAME__;
    return g?.bout ? readBoxes(g.bout.m) : null;
  },
};

// capture the Game instance for the read-back (main.ts keeps it in a closure)
const origCtor = P.start;
P.start = function (this: GameLike, ...args: unknown[]) {
  (window as unknown as { __HP_GAME__?: GameLike }).__HP_GAME__ = this;
  return origCtor.apply(this, args);
};

await import('../main.ts');
