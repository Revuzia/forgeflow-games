// DEV ONLY: window.__WH__ (DebugHook, contracts.ts) + the sound-lab API + the shell's dev extras. Never in a production bundle:
// src/shell/boot.ts imports this module dynamically behind `import.meta.env.DEV` (so Vite drops it from `vite build`), and the node probes
// reach it through src/app.ts. Audit findings 6 / 20: this hook is scripted input, which must not ship once the meter pays squish points.
import type { DebugHook, SoftEvent, SoftMetrics, TierName, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { decodeGenome, encodeGenome, genomeFromParam, pitchRatio } from '../core/genome.ts';
import { MERGE_COST } from '../core/merge.ts';
import { TIERS, tierIndex } from '../core/rarity.ts';
import { SPECIES_BY_TIER, getSpecies, speciesBaseGenome, tierOf } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import type { Game } from './game.ts';
import { TUNING } from './feel.ts';
import { bestMultiSwipe, tipSwipe, toPx } from './cutProbe.ts';
import type { LifeHostApi } from './lifeLink.ts';

export interface LabApi {
  play(kind: 'poke' | 'squish' | 'release' | 'land' | 'pop' | 'blend'): void;
  holdStart(): void;
  holdEnd(): void;
}

/** The shell's dev extras on window.__WH__ (the harness drives the capsule loop and the merge entry with them). */
export interface ShellDevApi {
  /** meter reading + capsule table state + where the meter comes from */
  meter(): { fill: number; credits: number; resting: boolean; doneToday: boolean; tableFull: boolean; offline: boolean; onTable: boolean; opening: boolean; holding: boolean; ledger: string; load: string };
  /** earn `credits` capsules through the REAL meter path, accelerated (see fill); false when the clock cannot be accelerated */
  grant(credits: number): boolean;
  /** run the REAL meter (collection.feed -> meter.ts) with synthetic pokes 2 s apart on a clock pushed ahead of the wall clock, until the
   *  ring reaches `fill` or a capsule is earned; false when the clock cannot be accelerated */
  fill(fill: number): boolean;
  /** where the capsule stands, 0..1 over the canvas (like pointerDown) + its radius in CSS px; null while falling / absent */
  capsuleScreen(): { x: number; y: number; rPx: number } | null;
  /** the DOM-twin path: open the next capsule */
  openCapsule(): Promise<void>;
  /** the dev merge entry (MERGE 7 order, result decided here instead of by a server): MERGE_COST parents + a result */
  merge(o?: { parents?: string[]; result?: string; species?: string; tierUp?: boolean; isNew?: boolean }): Promise<{ parents: string[]; result: string; tier: TierName }>;
  /** the dev reveal entry: play the capsule reveal of a chosen item (a catalog species of `tier`; decides and stores nothing: no
   *  collection draw, so no rollCapsule). quick: a repeat Common's quick pop. Queued like any ceremony (burst spacing). */
  reveal(o?: { tier?: TierName; species?: string; isNew?: boolean; quick?: boolean }): Promise<{ genome: string; tier: TierName }>;
  /** the ceremony now: kind, elapsed ms, planned duration s, a request queued behind it / the burst spacing */
  ceremony(): { kind: 'capsule' | 'merge' | null; elapsedMs: number; duration: number; pending: boolean };
  /** the last ceremony beats with their game-clock times in ms (the flash-safety spacing check reads it) */
  beats(): Array<{ kind: 'capsule' | 'merge'; beat: string; t: number }>;
  /** skip like a tap (honours the 350 ms gate); true = consumed */
  skip(): boolean;
  /** identity of the play body */
  identity(): { genomeCode: string; species: string; nickname: string | null; tier: TierName; itemId: string | null };
  pauseReasons(): string[];
  /** the frame loop is paused by DebugHook.pause() (stepping) */
  paused(): boolean;
  /** the render lane's dev readout when the stage offers one (createStageDev().info): bodies, capsule, calm, ceremony, ... */
  stageInfo(): Record<string, unknown> | null;
  /** PLAYGROUND (PG_SHELL round 4, dev only): the stage object itself (its dev members: scene, homeKit), for a harness's look at what is drawn */
  stageObj(): unknown;
  /** round 7 (R7_SHELL, dev only): a world point's screen position in CSS px through the stage camera (null behind it): the harness aims a press at a flush thing
   *  (Lanternroof's Vane Disc has no prop to report a centre) without the life chunk carrying the code */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** SHELL-2b: the practice shelf as the harness checks it */
  hoardState(): { owned: number; items: Array<{ id: string; species: string; name: string; tier: string; seen: boolean; fav: boolean; locked: boolean; origin: string }>; restockClaimed: boolean; tasks: Array<{ id: string; text: string; progress: number; target: number; done: boolean; claimed: boolean }>; mergesToday: number; credits: number; tidyPairs: number; tidyPairsAll: number };
  /** the toy tray and the Cut tool: the tool in hand, whether the physics can cut, the pieces and their shares of the whole */
  tools(): { tool: string; cutSupported: boolean; pieces: number; fracs: number[]; busy: boolean; maxPieces: number; extras: number; pieceViews: number; body: { x: number; y: number; z: number; r: number; frac: number; top: number }; cam: { x: number; y: number; z: number } | null };
  /** a Cut-tool swipe from (x0, y0) to (x1, y1), 0..1 over the canvas like pointerDown (the result: 'cut', 'miss', 'small', ...) */
  cutSwipe(x0: number, y0: number, x1: number, y1: number): string;
  /** the play mat's frame-time guard in ms (mat.ts FRAME_BUSY_MS by default); the harness lifts it on SwiftShader */
  matBusyMs(ms: number): void;
  /** move the collection's epoch clock one day ahead (the dev skew): a new UTC day for the meter's daily cap, the gift, tasks and merges */
  nextDay(): boolean;
  /** feed synthetic touches through the REAL collection.feed path until today's task `id` is done (clock pushed ahead like fill) */
  doTask(id: string): boolean;
  /** the next collection.merge answers this refusal (test seam for the pad's refusal handling, e.g. 'odds_changed') */
  failNextMerge(code: string): void;
  /** every body on the mat: the play body first, then the extras, with where it is drawn on screen (CSS px) and its touch metrics */
  matInfo(): { count: number; limit: number; bodies: Array<{ itemId: string | null; x: number; y: number; r: number; fingers: number; compression: number; press: number; active: boolean; carried: boolean; w: [number, number, number] }> };
  /** physics cost per frame (ms) for the bodies now on the mat: bodies.step(1/60) x n, timed */
  matStepCost(steps?: number): { bodies: number; msPerFrame: number; msPerBody: number };
  /** U07 test seam: the collection's meter reads `offline` (a signed-in player lost the connection); false = back. The practice ledger
   *  itself is never offline, so the harness fakes the server state here (dev only). */
  forceOffline(on: boolean): void;
  /** visible XP: where the pending figure comes from (the collection's preview or the published constants) and the pending fill now */
  xp(): { source: 'collection' | 'constants'; pending: number };
  /** lifecycle hooks the harness exercises (context loss without a real GPU) */
  suspend(reason: 'hidden' | 'context' | 'covered'): void;
  unsuspend(reason: 'hidden' | 'context' | 'covered'): void;
  /** SHELL-4: call-through spies on the REAL audio engine's methods (lift, toss, bump, cut, rejoin, ...) and the REAL haptics wrapper: every call
   *  still reaches the engine. `spyReset()` zeroes the counts; `spyCalls()` reads them (a count and the last argument of each). */
  spyStart(): void;
  spyReset(): void;
  spyCalls(): { audio: Record<string, { n: number; last: unknown }>; haptics: Record<string, number> };
  /** SHELL-4: the cut pieces as the physics sees them: per piece its share, centre, radius and the SURFACE gap to the play body (piece 0, the anchor) along the line
   *  between the centres (negative = overlapping); the play body first, `anchor` marks it (every piece is a peer: there is no chunk). Empty when nothing is cut. */
  /** the stage's dev views: how many bodies are drawn, how many carry a face and how many the stage flags as the legacy eyeless chunk (none in the true cut: pieces are peers; the count stays so a regression shows) */
  stageViews(): { total: number; faces: number; chunks: number } | null;
  pieceGaps(at?: { x: number; y: number; z: number } | null): Array<{ frac: number; anchor: boolean; x: number; y: number; z: number; r: number; gap: number | null; top: number; near: number }>;
  /** CUT3 (join rows): the cut tree as the Cutter keeps it: per piece its share, the literals of its cell (the path from the root), whether it is the anchor, and its world centre. Empty when whole. */
  cutRegions(): Array<{ frac: number; cells: number[]; anchor: boolean; x: number; y: number; z: number; part: number }>;
  /** CUT3 (U02 / U04 / U06): Split in two on the largest piece, like the button ('cut', 'limit', 'busy', ...) */
  cutSplit(): string;
  /** CUT3 (U04, browser): lower the safety ceiling to n pieces (null restores 64), so the kind line is reached without 63 cuts */
  setCutCeiling(n: number | null): void;
  /** D-103 (several squishies cut at once): every squishy out (the play squishy first) with its pieces now, whether a cut or a join of ITS plays, and its bodies on screen (CSS px over the canvas, the
   *  anchor first; `w` the world centre); the party's piece budget (null: one squishy out) and the pieces of all cut squishies */
  cutSets(): { budget: number | null; total: number; out: Array<{ key: string; play: boolean; name: string; pieces: number; busy: boolean; bodies: Array<{ x: number; y: number; r: number; w: [number, number, number] }> }> };
  /** D-103: the Cut bar's chip: just this squishy back together */
  cutReconnect(key: string, animated: boolean): boolean;
  /** CUT3 (the harness reports to the owner, nothing is hidden): the safety ceiling, how many times its kind line was said, how many pieces the last cut made, the last result of a swipe or Split in two,
   *  the pieces now, and the physics' load: particles of every piece, of the awake ones (a sleeping piece takes no solver steps), and how many pieces sleep */
  cutInfo(): { ceiling: number; ceilingHits: number; lastParts: number; lastResult: string | null; pieces: number; particles: number; awakeParticles: number; sleeping: number; contact: { bodies: number; awake: number; pairs: number; skippedAsleep: number; naivePairs: number; tests: number } };
  /** CUT3 (U02 / U03, the browser rows): a screen swipe (CSS px over the canvas) across the tip of the LARGEST piece in rest direction `dir` (a species recipe's feature direction), perpendicular to its axis as the camera
   *  sees it, `f` (0.4) of the way from the body's radius to the apex; null when it is no tip or points at the camera. */
  tipSwipe(dir: V3, f?: number): { x0: number; y0: number; x1: number; y1: number } | null;
  /** CUT3 (U03): the screen swipe whose plane leaves the most separate parts on the LARGEST piece (a grid search on its mesh), and that count by an independent connected-parts count; null when none leaves three */
  multiSwipe(): { x0: number; y0: number; x1: number; y1: number; parts: number } | null;
  /** CUT3 (U02 / U06): every piece, the play body first: share, particles, whether it sleeps, centre, lowest and highest point (world y), and its position among the separate parts one side of a cut made (-1: alone on its side) */
  pieceStates(): Array<{ frac: number; particles: number; sleeping: boolean; x: number; y: number; z: number; low: number; top: number; part: number; sx: number; sy: number }>;
  /** CUT-B S4: the cut style of the Cutter ('clean' | 'minis'); false and no change while the squishy is cut (the harness switches to Minis for the low-quality limit rows) */
  setCutStyle(style: 'clean' | 'minis'): boolean;
  /** CUT-A gate (S5a): every drawn view, the play body first: whether it is a true cut piece and the eyes it draws (world centre, the share of the eye
   *  this view holds, the screen position in CSS px). Dev only (the stage's dev `eyeCentres`); null when the stage offers none. */
  eyeViews(): Array<{ id: number; piece: boolean; eyes: Array<{ x: number; y: number; z: number; share: number; sx: number; sy: number }> }> | null;
}

export type ShellDebugHook = DebugHook & { shell: ShellDevApi };

export interface DebugOptions {
  postShot?: (name: string, dataUrl: string) => Promise<{ ok: boolean; path?: string }>;
  /** the dev clock skew the collection's epoch clock adds (boot.ts / app.ts pass `now: () => Date.now() + skew.ms`): the meter accelerator */
  skew?: { ms: number };
}

/** The highest particle of a body (world y). */
const topOf = (b: { positions: ArrayLike<number>; vertexCount: number }): number => { let m = -Infinity; for (let i = 0; i < b.vertexCount; i++) m = Math.max(m, b.positions[i * 3 + 1]); return m; };

/** A squeeze held 1.2 s and released: what the dev meter accelerator feeds. (It fed a poke until the owner decision of 2026-10-06: a tap pays nothing now, so a poke cannot fill the meter.) */
const SQUEEZE: SoftEvent = { kind: 'release', at: { x: 0, y: 0.5, z: 0.5 }, normal: { x: 0, y: 0, z: 1 }, intensity: 0.5, heldFor: 1.2, finger: 0 };

export function createDebugTools(game: Game, o: DebugOptions = {}): { debug: ShellDebugHook; lab: LabApi } {
  const { audio } = game;
  let labHold: { handle: ReturnType<typeof audio.squishStart>; t0: number } | null = null;
  let labEndAt = -1;

  game.onStep((_dt, t) => {
    if (labHold) {
      const k = Math.min(1, Math.max(0, (t - labHold.t0) / 1.2));
      try { labHold.handle.update({ compression: 0.15 + 0.8 * k, rate: 2.2 * (1 - k) + 0.3 * Math.sin(t * 18), pan: 0 }); } catch { /* ignore */ }
      if (labEndAt >= 0 && t >= labEndAt) { labEndAt = -1; lab.holdEnd(); }
    }
  });
  game.onRelease(() => { lab.holdEnd(); labEndAt = -1; });

  const lab: LabApi = {
    play(kind) {
      const I = 0.75;
      const p = pitchRatio(game.genome);
      switch (kind) {
        case 'poke': audio.poke({ intensity: I, pitch: p }); break;
        case 'release': audio.release({ compression: 0.8, pitch: p }); break;
        case 'land': audio.land({ intensity: I, pitch: p }); break;
        case 'pop': audio.pop({ size: 0.6, pitch: p }); break;
        case 'blend': audio.blend({ durationS: 3 }); break;
        case 'squish': lab.holdStart(); labEndAt = game.simTime + 1.4; break;
      }
    },
    holdStart() {
      if (labHold) return;
      const handle = audio.squishStart({ pitch: pitchRatio(game.genome) });
      if (handle) labHold = { handle, t0: game.simTime };
    },
    holdEnd() {
      if (!labHold) return;
      const h = labHold.handle;
      labHold = null;
      try { h.end(); } catch { /* ignore */ }
    },
  };

  const vp = (): { w: number; h: number } => game.viewport;
  const px = (x: number, y: number): { x: number; y: number } => ({ x: x * vp().w, y: y * vp().h });
  const debugId = (id: number): number => -1 - id;
  const lastDebugPx: Record<number, { x: number; y: number }> = {};
  /** the largest piece of the play squishy (the play body when whole) */
  const largestPiece = (): typeof game.bodies.body => { let b = game.bodies.body; for (const x of game.bodies.extras) if (x.piece && (x.body.frac ?? 1) > (b.frac ?? 1) + 1e-9) b = x.body; return b; };
  const postShot = o.postShot ?? (async (name: string, dataUrl: string) => {
    const r = await fetch(`./__shot/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataUrl });
    return (await r.json()) as { ok: boolean; path?: string };
  });

  let mergeSeq = 0, revealSeq = 0;
  let spyOn = false;
  const spied: { audio: Record<string, { n: number; last: unknown }>; haptics: Record<string, number> } = { audio: {}, haptics: {} };
  const shell: ShellDevApi = {
    meter() {
      const m = game.capsules.reading;
      return { ...m, onTable: game.capsules.onTable, opening: game.capsules.opening, holding: game.capsules.holding, ledger: game.hoard.ledger, load: game.hoard.storage().load };
    },
    grant(n) {
      if (!o.skew) return false;
      const target = game.collection.meter().credits + Math.max(0, Math.floor(n));
      for (let k = 0; k < n && game.collection.meter().credits < target && !game.collection.meter().tableFull; k++) shell.fill(1);
      return true;
    },
    fill(f) {
      const skew = o.skew;
      if (!skew) return false;
      const goal = Math.min(1, Math.max(0, f));
      const c0 = game.collection.meter().credits;
      for (let i = 0; i < 600; i++) {
        const m = game.collection.meter();
        if (m.credits > c0 || m.tableFull || m.fill >= goal) break;
        skew.ms += 3000;   // 3 s between squeezes (held 1.2 s): full freshness (tau 2.4 s), about 28 SP/min, under the 40 SP/min valve
        game.collection.feed(SQUEEZE, Date.now() + skew.ms);
      }
      return true;
    },
    capsuleScreen() {
      const s = game.capsules.screenPoint();
      return s ? { x: s.x / vp().w, y: s.y / vp().h, rPx: s.r } : null;
    },
    openCapsule: () => game.capsules.openNext(),
    async merge(opt = {}) {
      const cur = game.genome;
      const species = (getSpecies(opt.species) ? opt.species : cur.species) as SpeciesId;
      const pTier = tierOf(species);
      const parents: Genome[] = (opt.parents ?? []).map((c) => decodeGenome(c)).filter((g): g is Genome => !!g);
      for (let i = parents.length; i < MERGE_COST; i++) parents.push(speciesBaseGenome(species, 0x6d65 + 977 * (++mergeSeq) + i));
      let result = opt.result ? decodeGenome(opt.result) : null;
      const tierUp = !!opt.tierUp && pTier !== 'mythic';
      if (!result) {
        const outTier = tierUp ? TIERS[Math.min(TIERS.length - 1, tierIndex(pTier) + 1)] : pTier;
        const pool = SPECIES_BY_TIER[tierIndex(outTier)].filter((s) => s.id !== species);
        const pick = pool[(mergeSeq * 7) % Math.max(1, pool.length)] ?? SPECIES_BY_TIER[tierIndex(outTier)][0];
        result = speciesBaseGenome(pick.id, 0x7e57 + mergeSeq);
      }
      const tier = tierOf(result.species);
      await game.playMerge(parents.map((g) => ({ genome: g, tier: tierOf(g.species) })), {
        itemId: `dev-merge-${mergeSeq}`, genome: result, tier, isNew: opt.isNew ?? true, copies: 1, nickname: null, tierUp: tierUp || tierIndex(tier) > tierIndex(pTier),
      });
      return { parents: parents.map((g) => encodeGenome(g)), result: encodeGenome(result), tier };
    },
    async reveal(opt = {}) {
      const want = opt.tier ?? 'common';
      const species = (opt.species && getSpecies(opt.species) ? opt.species : SPECIES_BY_TIER[tierIndex(want)][0].id) as SpeciesId;
      const genome = speciesBaseGenome(species, 0x5e7 + 131 * (++revealSeq));
      const tier = tierOf(species);
      const isNew = opt.quick ? false : (opt.isNew ?? true);
      await game.ceremonies.playReveal({ itemId: `dev-reveal-${revealSeq}`, genome, tier, isNew, copies: isNew ? 1 : 2, nickname: null, quickEligible: opt.quick ? true : undefined });
      return { genome: encodeGenome(genome), tier };
    },
    ceremony: () => ({ kind: game.ceremonies.kind, elapsedMs: game.ceremonies.elapsedMs(), duration: game.ceremonies.duration, pending: game.ceremonies.pending }),
    beats: () => game.ceremonies.recentBeats().map((b) => ({ kind: b.kind, beat: b.beat, t: b.t })),
    skip: () => game.input.skip(),
    identity() {
      const id = game.identity, l = game.label;
      return { genomeCode: encodeGenome(id.genome), species: l.species, nickname: l.nickname, tier: id.tier, itemId: id.itemId };
    },
    pauseReasons: () => [...game.pauseReasons],
    paused: () => game.paused,
    stageObj: () => game.stage,
    project(x, y, z) {
      const cam = game.stage.camera;
      try { cam.updateMatrixWorld(); } catch { /* ignore */ }
      const e = cam.matrixWorldInverse.elements, m = cam.projectionMatrix.elements, v = vp();
      const vx = e[0] * x + e[4] * y + e[8] * z + e[12], vy = e[1] * x + e[5] * y + e[9] * z + e[13], vz = e[2] * x + e[6] * y + e[10] * z + e[14];
      const cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12], cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13], cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
      return cw > 1e-6 ? { x: (cx / cw * 0.5 + 0.5) * v.w, y: (0.5 - cy / cw * 0.5) * v.h } : null;
    },
    stageInfo() {
      try { const i = (game.stage as unknown as { info?: Record<string, unknown> }).info; return i ? JSON.parse(JSON.stringify(i)) as Record<string, unknown> : null; } catch { return null; }
    },
    hoardState() {
      const c = game.hoard;
      const now = game.epochNow();
      return {
        owned: c.stacks().filter((st) => st.copies > 0).length,
        items: c.items().map((it) => ({ id: it.id, species: it.species, name: it.name, tier: it.tier, seen: it.seen, fav: it.fav, locked: it.lockedUntil !== null && it.lockedUntil > now, origin: it.origin })),
        restockClaimed: c.restock().claimed,
        tasks: c.tasks().map((t) => ({ id: t.def.id, text: t.def.text, progress: t.progress, target: t.target, done: t.done, claimed: t.claimed })),
        mergesToday: c.practice().mergesToday,
        credits: c.meter().credits,
        tidyPairs: c.tidyPlan({ includeRare: false }).length,
        tidyPairsAll: c.tidyPlan({ includeRare: true }).length,
      };
    },
    matBusyMs: (ms) => game.mat.setBusyLimit(ms),
    tools: () => {
      const b = game.bodies.body, c = b.center, cam = (game.stage.camera as unknown as { position?: { x: number; y: number; z: number } } | null)?.position;
      return {
        tool: game.tool, cutSupported: game.cut.supported, pieces: game.cut.pieces, fracs: game.cut.fracs(), busy: game.cut.busy, maxPieces: game.cut.maxPieces,
        extras: game.bodies.extras.length, pieceViews: game.bodies.extras.filter((x) => x.piece).length,
        body: { x: c.x, y: c.y, z: c.z, r: b.restRadius, frac: b.frac ?? 1, top: topOf(b) }, cam: cam ? { x: cam.x, y: cam.y, z: cam.z } : null,
      };
    },
    cutSwipe: (x0, y0, x1, y1) => { const v = vp(); return game.cut.swipe(x0 * v.w, y0 * v.h, x1 * v.w, y1 * v.h); },
    nextDay() {
      if (!o.skew) return false;
      o.skew.ms += 86_400_000;
      game.capsules.sync();
      return true;
    },
    doTask(id) {
      const skew = o.skew;
      if (!skew) return false;
      const row = () => game.hoard.tasks().find((t) => t.def.id === id);
      const t0 = row();
      if (!t0) return false;
      const ev = (kind: SoftEvent['kind'], intensity: number, heldFor: number): SoftEvent => ({ kind, at: { x: 0, y: 0.5, z: 0.5 }, normal: { x: 0, y: 0, z: 1 }, intensity, heldFor, finger: 0 });
      const m = t0.def.metric, param = t0.def.param ?? 0;
      for (let i = 0; i < 80 && !row()!.done; i++) {
        skew.ms += 2500;
        const t = Date.now() + skew.ms;
        if (m === 'pokes') game.hoard.feed(ev('poke', 0.5, 0), t);
        else if (m === 'squeezes') game.hoard.feed(ev('release', 0.5, Math.max(0.5, param) + 0.6), t);
        else if (m === 'softPops') game.hoard.feed(ev('release', 0.5, 2.2), t);
        else if (m === 'snaps') game.hoard.feed(ev('snap', 0.6, 0.5), t);
        else if (m === 'stretch') game.hoard.feed(ev('snap', 1, 0.8), t);
        else if (m === 'medleys') { game.hoard.feed(ev('poke', 0.5, 0), t); game.hoard.feed(ev('release', 0.5, 1.2), t + 2000); game.hoard.feed(ev('snap', 0.6, 0.5), t + 4000); skew.ms += 4000; }
      }
      return !!row()?.done;
    },
    failNextMerge(code) {
      const c = game.hoard as unknown as { merge: (ids: readonly string[], d: string) => Promise<unknown> };
      const orig = c.merge;
      c.merge = (ids, d) => {
        c.merge = orig;
        const pv = game.hoard.previewMerge(ids);
        return Promise.resolve({ ok: false, ledger: 'practice', error: code, preview: pv.ok ? pv.preview : undefined, digest: pv.ok ? pv.digest : undefined, message: undefined });
      };
    },
    matInfo() {
      const list: Array<{ itemId: string | null; x: number; y: number; r: number; fingers: number; compression: number; press: number; active: boolean; carried: boolean; w: [number, number, number] }> = [];
      const cam = game.stage.camera;
      try { cam.updateMatrixWorld(); } catch { /* ignore */ }
      const vpx = vp();
      const proj = (p: { x: number; y: number; z: number }): { x: number; y: number } | null => {
        const v = p as unknown as { x: number; y: number; z: number };
        const w = { x: v.x, y: v.y, z: v.z };
        const e = cam.matrixWorldInverse.elements, m = cam.projectionMatrix.elements;
        const vx = e[0] * w.x + e[4] * w.y + e[8] * w.z + e[12], vy = e[1] * w.x + e[5] * w.y + e[9] * w.z + e[13], vz = e[2] * w.x + e[6] * w.y + e[10] * w.z + e[14];
        const cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12], cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13], cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
        if (!(cw > 1e-6)) return null;
        return { x: (cx / cw * 0.5 + 0.5) * vpx.w, y: (0.5 - cy / cw * 0.5) * vpx.h };
      };
      const add = (b: typeof game.body, off: { x: number; y: number; z: number }, itemId: string | null, isActive: boolean): void => {
        const c0 = b.center;
        const pc = proj({ x: c0.x + off.x, y: c0.y + off.y, z: c0.z + off.z });
        const pe = proj({ x: c0.x + off.x + b.restRadius, y: c0.y + off.y, z: c0.z + off.z });
        list.push({ itemId, x: pc ? pc.x : -1, y: pc ? pc.y : -1, r: pc && pe ? Math.abs(pe.x - pc.x) : 0, fingers: b.metrics.fingers, compression: b.metrics.compression, press: b.metrics.press ?? 0, active: isActive, carried: b.metrics.carried === true, w: [c0.x + off.x, c0.y + off.y, c0.z + off.z] });
      };
      const extras = game.bodies.extras;
      const activeBody = game.host.bodyScreen();
      void activeBody;
      add(game.body, { x: 0, y: 0, z: 0 }, game.identity.itemId, false);
      for (const xb of extras) add(xb.body, xb.position, xb.itemId, false);
      return { count: game.mat.count, limit: game.mat.limit, bodies: list };
    },
    matStepCost(steps = 120) {
      const n = game.bodies.extras.length + 1;
      const t0 = performance.now();
      for (let i = 0; i < steps; i++) game.bodies.step(1 / 60);
      const ms = (performance.now() - t0) / steps;
      return { bodies: n, msPerFrame: ms, msPerBody: ms / n };
    },
    xp: () => ({ source: game.pendingSource, pending: game.pendingFill() }),
    forceOffline(on) {
      const c = game.hoard as unknown as { meter: () => ReturnType<typeof game.hoard.meter>; __meter?: () => ReturnType<typeof game.hoard.meter> };
      if (!c.__meter) c.__meter = c.meter;
      const orig = c.__meter;
      c.meter = on ? () => ({ ...orig.call(game.hoard), offline: true }) : orig;
      game.capsules.sync();
    },
    suspend: (r) => game.suspend(r),
    unsuspend: (r) => game.unsuspend(r),
    spyStart() {
      if (spyOn) return;
      spyOn = true;
      const wrap = (obj: unknown, names: readonly string[], into: (name: string, args: unknown[]) => void): void => {
        const o = obj as Record<string, unknown>;
        for (const name of names) {
          const orig = o[name];
          if (typeof orig !== 'function') continue;
          o[name] = (...args: unknown[]): unknown => { into(name, args); return (orig as (...a: unknown[]) => unknown).apply(obj, args); };
        }
      };
      wrap(game.audio, ['lift', 'toss', 'bump', 'cut', 'rejoin', 'strand', 'land', 'pop', 'poke', 'release'], (n, a) => { const r = spied.audio[n] ?? (spied.audio[n] = { n: 0, last: null }); r.n++; r.last = a[0] ?? null; });
      wrap(game.haptics, ['poke', 'release', 'pop', 'squeeze', 'cancel', 'pattern'], (n) => { spied.haptics[n] = (spied.haptics[n] ?? 0) + 1; });
    },
    spyReset() { spied.audio = {}; spied.haptics = {}; },
    spyCalls: () => JSON.parse(JSON.stringify(spied)) as { audio: Record<string, { n: number; last: unknown }>; haptics: Record<string, number> },
    stageViews() {
      const vs = (game.stage as unknown as { views?: Array<{ chunk?: boolean }> }).views;
      return vs ? { total: vs.length, faces: vs.filter((v) => !v.chunk).length, chunks: vs.filter((v) => !!v.chunk).length } : null;
    },
    setCutStyle: (style) => game.cut.setStyle(style),
    cutSplit: () => game.cut.splitInTwo(),
    setCutCeiling: (n) => game.cut.setCeilingForTest(n),
    cutSets() {
      const xs = game.bodies.extras, playKey = game.identity.itemId ?? '', rows = game.cut.sets;
      const mi = shell.matInfo().bodies;   // (the play body, then the extras in order)
      const ownerOf = (i: number): string => (i === 0 ? playKey : xs[i - 1].of ?? (xs[i - 1].piece ? playKey : xs[i - 1].itemId ?? ''));
      const keys = [playKey, ...xs.filter((x) => !x.piece).map((x) => x.itemId ?? '')];
      return {
        budget: game.cut.budget ?? null, total: game.cut.pieces,
        out: keys.map((key, k) => {
          const row = rows ? (k === 0 ? rows[0] : rows.find((r, i) => i > 0 && r.key === key)) : undefined;
          const bodies = mi.filter((_b, i) => ownerOf(i) === key).map((b) => ({ x: b.x, y: b.y, r: b.r, w: b.w }));
          return { key, play: k === 0, name: row?.name ?? '', pieces: row ? row.pieces : k === 0 ? game.cut.pieces : 1, busy: row ? row.busy : k === 0 ? game.cut.busy : false, bodies };
        }),
      };
    },
    cutReconnect: (key, animated) => game.cut.reconnect?.(key, animated) ?? false,
    tipSwipe(dir, f) {
      const b = largestPiece(); const cam = game.stage.camera;
      try { cam.updateMatrixWorld(); } catch { /* ignore */ }
      const t = tipSwipe(b, cam as never, vp(), dir, f);
      return t ? { x0: t.x0, y0: t.y0, x1: t.x1, y1: t.y1 } : null;
    },
    multiSwipe() {
      const b = largestPiece(); const cam = game.stage.camera;
      try { cam.updateMatrixWorld(); } catch { /* ignore */ }
      // only lines a finger can draw: every sampled point is over the stage canvas (not the wordmark, the HUD or the Cut bar)
      const ok = (x: number, y: number): boolean => { try { const el = document.elementFromPoint(x, y); return !!el && el.tagName === 'CANVAS'; } catch { return true; } };
      return bestMultiSwipe(b, cam as never, vp(), ok);
    },
    cutInfo() {
      const all = [game.bodies.body, ...game.bodies.extras.filter((x) => x.piece).map((x) => x.body)] as Array<typeof game.bodies.body & { sleeping?: boolean; awakeParticles?: number }>;
      let particles = 0, awake = 0, sleeping = 0;
      for (const b of all) { particles += b.vertexCount; if (b.sleeping === true) sleeping++; else awake += typeof b.awakeParticles === 'number' ? b.awakeParticles : b.vertexCount; }
      const cs = game.bodies.contactStats;   // the contact planner's last step: pairs handed to collide against the pairs a pairwise loop would test
      return { ...game.cut.info, pieces: game.cut.pieces, particles, awakeParticles: awake, sleeping, contact: { bodies: cs.bodies, awake: cs.awake, pairs: cs.pairs, skippedAsleep: cs.skippedAsleep, naivePairs: cs.naivePairs, tests: cs.tests } };
    },
    pieceStates() {
      const all = [game.bodies.body, ...game.bodies.extras.filter((x) => x.piece).map((x) => x.body)] as Array<typeof game.bodies.body & { sleeping?: boolean }>;
      const parts = game.cut.regions().map((r) => r.part);
      return all.map((b, i) => {
        let low = Infinity;
        for (let k = 0; k < b.vertexCount; k++) low = Math.min(low, b.positions[k * 3 + 1]);
        const c = b.center;
        const sp = toPx(game.stage.camera as never, vp(), c);   // where its centre is on the screen (CSS px over the canvas; -1: behind the camera)
        return { frac: b.frac ?? 1, particles: b.vertexCount, sleeping: b.sleeping === true, x: c.x, y: c.y, z: c.z, low, top: topOf(b), part: parts[i] ?? -1, sx: sp ? sp.x : -1, sy: sp ? sp.y : -1 };
      });
    },
    eyeViews() {
      const st = game.stage as unknown as { views?: Array<{ id: number; isPiece?: boolean }>; eyeCentres?: (id: number) => Array<{ x: number; y: number; z: number; share: number }> };
      if (!st.views || !st.eyeCentres) return null;
      const cam = game.stage.camera, v = vp();
      try { cam.updateMatrixWorld(); } catch { /* ignore */ }
      const e = cam.matrixWorldInverse.elements, m = cam.projectionMatrix.elements;
      const proj = (p: { x: number; y: number; z: number }): { x: number; y: number } => {
        const vx = e[0] * p.x + e[4] * p.y + e[8] * p.z + e[12], vy = e[1] * p.x + e[5] * p.y + e[9] * p.z + e[13], vz = e[2] * p.x + e[6] * p.y + e[10] * p.z + e[14];
        const cx = m[0] * vx + m[4] * vy + m[8] * vz + m[12], cy = m[1] * vx + m[5] * vy + m[9] * vz + m[13], cw = m[3] * vx + m[7] * vy + m[11] * vz + m[15];
        return cw > 1e-6 ? { x: (cx / cw * 0.5 + 0.5) * v.w, y: (0.5 - cy / cw * 0.5) * v.h } : { x: -1, y: -1 };
      };
      return st.views.map((x) => ({ id: x.id, piece: !!x.isPiece, eyes: st.eyeCentres!(x.id).map((c) => ({ ...c, ...(() => { const s = proj(c); return { sx: s.x, sy: s.y }; })() })) }));
    },
    cutRegions: () => (typeof game.cut.regions === 'function' ? game.cut.regions() : []),
    pieceGaps(at) {
      const face = game.bodies.body;
      const all = [face, ...game.bodies.extras.filter((x) => x.piece).map((x) => x.body)];
      if (all.length < 2) return [];
      const support = (b: typeof face, ux: number, uy: number, uz: number): number => {
        const P = b.positions, c = b.center;
        let m = -Infinity;
        for (let i = 0; i < b.vertexCount; i++) m = Math.max(m, (P[i * 3] - c.x) * ux + (P[i * 3 + 1] - c.y) * uy + (P[i * 3 + 2] - c.z) * uz);
        return m;
      };
      const nearest = (b: typeof face, p: { x: number; y: number; z: number }): number => { let m = Infinity; for (let i = 0; i < b.vertexCount; i++) m = Math.min(m, Math.hypot(b.positions[i * 3] - p.x, b.positions[i * 3 + 1] - p.y, b.positions[i * 3 + 2] - p.z)); return m; };
      return all.map((b, i) => {
        const c = b.center, f = face.center;
        let gap: number | null = null;
        if (i > 0) {
          const dx = c.x - f.x, dy = c.y - f.y, dz = c.z - f.z, d = Math.hypot(dx, dy, dz);
          if (d > 1e-9) { const ux = dx / d, uy = dy / d, uz = dz / d; gap = d - support(face, ux, uy, uz) - support(b, -ux, -uy, -uz); }
        }
        return { frac: b.frac ?? 1, anchor: i === 0, x: c.x, y: c.y, z: c.z, r: b.restRadius * Math.cbrt(b.frac ?? 1), gap, top: topOf(b), near: at ? nearest(b, at) : 0 };
      });
    },
  };

  const debug: ShellDebugHook = {
    version: 1,
    state() {
      const m: SoftMetrics = { ...game.body.metrics };
      return {
        phase: game.phase, metrics: m, settings: { ...game.settings }, genome: game.genome, genomeCode: encodeGenome(game.genome), fps: Math.round(game.fps * 10) / 10,
        stage: game.stage.stats(), audio: game.audio.stats(), events: game.recentEvents(), stateHash: game.body.stateHash(),
      };
    },
    pause: () => game.pause(),
    resume: () => game.resume(),
    step(dt = 1 / 60, n = 1) {
      if (!game.paused) game.pause();
      const steps = Math.max(0, Math.floor(n));
      const h = Number.isFinite(dt) && dt > 0 ? Math.min(dt, TUNING.maxDt) : 1 / 60;
      let acc = 0;
      for (let i = 0; i < steps; i++) {
        game.clock.advance(h * 1000);
        game.stepOnce(h);
        acc += h;
        if (acc >= 0.05) { game.stageUpdate(acc, false); acc = 0; }
      }
      game.stageUpdate(acc, true);
    },
    pointerDown(x, y, id = 0) {
      const p = px(x, y), gid = debugId(id);
      lastDebugPx[gid] = p;
      game.input.pointerDown({ id: gid, x: p.x, y: p.y, type: 'touch' });
    },
    pointerMove(x, y, id = 0) {
      const p = px(x, y), gid = debugId(id);
      lastDebugPx[gid] = p;
      game.input.pointerMove({ id: gid, x: p.x, y: p.y, type: 'touch' });
    },
    pointerUp(id = 0) {
      const gid = debugId(id);
      const p = lastDebugPx[gid];
      if (!p) return;
      game.input.pointerUp({ id: gid, x: p.x, y: p.y, type: 'touch' });
      delete lastDebugPx[gid];
    },
    setGenome(seedOrCode) { game.setGenome(genomeFromParam(String(seedOrCode))); },
    setSetting(key, value) { game.setSetting(key, value); },
    async shot(name) {
      try {
        game.stage.render();
        const url = game.stage.canvas.toDataURL('image/png');
        return await postShot(name, url);
      } catch { return { ok: false }; }
    },
    playSound(kind) { lab.play(kind); },
    // PLAYGROUND (contracts.ts DebugHook; dev only): the LIFE host's state, the journal, a trip by the Travel sheet's own path
    life: () => (game.life ? game.life.debug() : null),
    quests: () => { const h = game.life as LifeHostApi | null; const v = h ? h.journal() : null; return v ? { stamps: v.stamps, places: v.places, firstWish: v.firstWish, wisher: v.wisher, keepsakes: v.keepsakes, quests: v.quests.filter((q) => q.shown).map((q) => ({ id: q.id, done: q.done, open: q.open, have: q.have, need: q.need })), wishes: v.wishes, gifts: v.gifts } : null; },
    travel: (place, any) => { const h = game.life as LifeHostApi | null; return h ? h.travel(String(place), any === true) : Promise.resolve(false); },
    bodyScreen() {
      const d = game.host.bodyScreen();
      return d ? { x: d.x / vp().w, y: d.y / vp().h, rPx: d.r } : null;
    },
    shell,
  };
  return { debug, lab };
}
