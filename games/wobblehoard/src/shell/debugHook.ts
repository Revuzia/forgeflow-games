// DEV ONLY: window.__WH__ (DebugHook, contracts.ts) + the sound-lab API + the shell's dev extras. Never in a production bundle:
// src/shell/boot.ts imports this module dynamically behind `import.meta.env.DEV` (so Vite drops it from `vite build`), and the node probes
// reach it through src/app.ts. Audit findings 6 / 20: this hook is scripted input, which must not ship once the meter pays squish points.
import type { DebugHook, SoftEvent, SoftMetrics, TierName } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { decodeGenome, encodeGenome, genomeFromParam, pitchRatio } from '../core/genome.ts';
import { MERGE_COST } from '../core/merge.ts';
import { TIERS, tierIndex } from '../core/rarity.ts';
import { SPECIES_BY_TIER, getSpecies, speciesBaseGenome, tierOf } from '../data/catalog.ts';
import type { SpeciesId } from '../data/catalog.ts';
import type { Game } from './game.ts';
import { TUNING } from './feel.ts';

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
  /** SHELL-2b: the practice shelf as the harness checks it */
  hoardState(): { owned: number; items: Array<{ id: string; species: string; name: string; tier: string; seen: boolean; fav: boolean; locked: boolean; origin: string }>; restockClaimed: boolean; tasks: Array<{ id: string; text: string; progress: number; target: number; done: boolean; claimed: boolean }>; mergesToday: number; credits: number; tidyPairs: number; tidyPairsAll: number };
  /** the toy tray and the Cut tool: the tool in hand, whether the physics can cut, the pieces and their shares of the whole */
  tools(): { tool: string; cutSupported: boolean; pieces: number; fracs: number[]; busy: boolean; maxPieces: number; extras: number; pieceViews: number; body: { x: number; y: number; z: number; r: number; frac: number }; cam: { x: number; y: number; z: number } | null };
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
}

export type ShellDebugHook = DebugHook & { shell: ShellDevApi };

export interface DebugOptions {
  postShot?: (name: string, dataUrl: string) => Promise<{ ok: boolean; path?: string }>;
  /** the dev clock skew the collection's epoch clock adds (boot.ts / app.ts pass `now: () => Date.now() + skew.ms`): the meter accelerator */
  skew?: { ms: number };
}

const POKE: SoftEvent = { kind: 'poke', at: { x: 0, y: 0.5, z: 0.5 }, normal: { x: 0, y: 0, z: 1 }, intensity: 0.5, heldFor: 0, finger: 0 };

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
  const postShot = o.postShot ?? (async (name: string, dataUrl: string) => {
    const r = await fetch(`./__shot/${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: dataUrl });
    return (await r.json()) as { ok: boolean; path?: string };
  });

  let mergeSeq = 0, revealSeq = 0;
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
        skew.ms += 2000;   // 2 s between pokes: full freshness, under the 40 SP/min valve
        game.collection.feed(POKE, Date.now() + skew.ms);
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
        body: { x: c.x, y: c.y, z: c.z, r: b.restRadius, frac: b.frac ?? 1 }, cam: cam ? { x: cam.x, y: cam.y, z: cam.z } : null,
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
    bodyScreen() {
      const d = game.host.bodyScreen();
      return d ? { x: d.x / vp().w, y: d.y / vp().h, rPx: d.r } : null;
    },
    shell,
  };
  return { debug, lab };
}
