// DEV ONLY: window.__WH__ (DebugHook, contracts.ts) + the sound-lab API + the shell's dev extras. Never in a production bundle:
// src/shell/boot.ts imports this module dynamically behind `import.meta.env.DEV` (so Vite drops it from `vite build`), and the node probes
// reach it through src/app.ts. Audit findings 6 / 20: this hook is scripted input, which must not ship once the meter pays squish points.
import type { DebugHook, SoftMetrics, TierName } from '../contracts.ts';
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
  /** meter reading + capsule table state */
  meter(): { fill: number; credits: number; resting: boolean; doneToday: boolean; tableFull: boolean; offline: boolean; onTable: boolean; opening: boolean; holding: boolean; source: string };
  /** add capsule credits directly (practice fallback only) */
  grant(credits: number): boolean;
  /** run the real meter with accelerated pokes until the ring reaches `fill` (practice fallback only) */
  fill(fill: number): boolean;
  /** where the capsule stands, 0..1 over the canvas (like pointerDown) + its radius in CSS px; null while falling / absent */
  capsuleScreen(): { x: number; y: number; rPx: number } | null;
  /** the DOM-twin path: open the next capsule */
  openCapsule(): Promise<void>;
  /** the dev merge entry (MERGE 7 order, result decided here instead of by a server): MERGE_COST parents + a result */
  merge(o?: { parents?: string[]; result?: string; species?: string; tierUp?: boolean; isNew?: boolean }): Promise<{ parents: string[]; result: string; tier: TierName }>;
  /** the ceremony now: kind, elapsed ms, planned duration s */
  ceremony(): { kind: 'capsule' | 'merge' | null; elapsedMs: number; duration: number };
  /** skip like a tap (honours the 350 ms gate); true = consumed */
  skip(): boolean;
  /** identity of the play body */
  identity(): { genomeCode: string; species: string; nickname: string | null; tier: TierName; itemId: string | null };
  pauseReasons(): string[];
  /** the render lane's dev readout when the stage offers one (createStageDev().info): bodies, capsule, calm, ceremony, ... */
  stageInfo(): Record<string, unknown> | null;
  /** lifecycle hooks the harness exercises (context loss without a real GPU) */
  suspend(reason: 'hidden' | 'context' | 'covered'): void;
  unsuspend(reason: 'hidden' | 'context' | 'covered'): void;
}

export type ShellDebugHook = DebugHook & { shell: ShellDevApi };

export interface DebugOptions {
  postShot?: (name: string, dataUrl: string) => Promise<{ ok: boolean; path?: string }>;
}

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

  let mergeSeq = 0;
  const shell: ShellDevApi = {
    meter() {
      const m = game.capsules.reading;
      return { ...m, onTable: game.capsules.onTable, opening: game.capsules.opening, holding: game.capsules.holding, source: game.collection.source };
    },
    grant(n) { if (!game.collection.devGrant) return false; game.collection.devGrant(n); return true; },
    fill(f) { if (!game.collection.devFill) return false; game.collection.devFill(f); return true; },
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
    ceremony: () => ({ kind: game.ceremonies.kind, elapsedMs: game.ceremonies.elapsedMs(), duration: game.ceremonies.duration }),
    skip: () => game.input.skip(),
    identity() {
      const id = game.identity, l = game.label;
      return { genomeCode: encodeGenome(id.genome), species: l.species, nickname: l.nickname, tier: id.tier, itemId: id.itemId };
    },
    pauseReasons: () => [...game.pauseReasons],
    stageInfo() {
      try { const i = (game.stage as unknown as { info?: Record<string, unknown> }).info; return i ? JSON.parse(JSON.stringify(i)) as Record<string, unknown> : null; } catch { return null; }
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
