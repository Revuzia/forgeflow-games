// DYEFIELD — the FFA spawn audit (CONTRACT_FFA_SPAWNS §S6), shared by probe_match (scripted runners) and probe_bots (bots).
// THREE-free, read-only: it never writes the world. Feed it every tick's drained events; it judges every 'spawn' event
// on its own (not by asking the world's chooser):
//   * payload — site = Runner.spawnSite, (x, y, z) at the site, yaw = the site's yaw, the site index inside the pool;
//   * a respawn (Runner.respawns ≥ 1; the construction events are the match-start sites) — the nearest other living runner
//     (3-D, feet to feet; the gate: never within 3 m), a repeat of one of the runner's last 2 sites, spawn protection on
//     (FFA grants it in both rules), and SEEN: a living foe within 30 m whose eye has a clear line to the chest of the
//     runner standing at the site (feet MOVE.skin over the site + half the tall hit height; map collision only, 0.25 m
//     slack at the far end — the canSee ray). No mist rule (skeptic fix 2026-09-30): canSee's mist hides only SLICK
//     targets and a respawned runner is tall. The rate of unseen respawns is the S6 gate (≥ 90 %).
//   * per runner, the sites it used (start included): runners washed ≥ 5 times must have used ≥ 4 distinct sites.

import type { MatchWorld } from '../runtime/src/core/match/world.ts';
import type { SimEvent } from '../runtime/src/core/match/events.ts';
import { COMBAT, HITBOX, MOVE } from '../runtime/src/core/config.ts';

/** the S6 numbers (CONTRACT_FFA_SPAWNS §S6 / §S2) */
export const SPAWN_GATES = { minWashed: 5, minDistinct: 4, clear: 3.0, unseenRate: 0.9, seeRange: 30, recent: 2 } as const;

export interface SpawnAuditSummary {
  /** match-start 'spawn' events (one per runner expected) and respawn 'spawn' events */
  starts: number; respawns: number;
  /** respawns no living foe saw (this audit's own line-of-sight test) and their share (1 when there was no respawn) */
  unseen: number; unseenRate: number;
  /** the smallest 3-D distance from a respawned runner to another living runner at its 'spawn' event, and respawns < 3 m */
  minRunnerDist: number; within3: number;
  /** respawns at one of the runner's last 2 sites */
  repeats: number;
  /** 'spawn' events whose payload disagrees with the runner / the pool; respawns without spawn protection */
  payloadBad: number; unprotected: number;
  /** runners washed ≥ minWashed times, and those among them that used < minDistinct distinct sites */
  heavy: number; fewSites: Array<{ pid: number; washed: number; distinct: number }>;
  /** per runner: distinct sites used, times washed */
  distinct: number[]; washed: number[];
  /** the world's own count of respawn choices that took the fallback set (MatchStats.spawnFallbacks, info) */
  fallbacks: number;
  /** info (MatchStats): choices with no unseen candidate at all; per choice the mean candidates / unseen / safe ones */
  noUnseen: number; meanCands: number; meanUnseen: number; meanSafe: number;
}

export class SpawnAudit {
  private readonly w: MatchWorld;
  private readonly hist: number[][];
  private starts = 0; private respawns = 0; private unseen = 0; private minDist = Infinity; private within3 = 0;
  private repeats = 0; private payloadBad = 0; private unprotected = 0;

  constructor(w: MatchWorld) {
    this.w = w;
    this.hist = w.runners.map(() => []);
  }

  /** one tick's drained events (call after world.step + drainEvents) */
  observe(ev: readonly SimEvent[]): void {
    const w = this.w;
    // protection legitimately ends in its own tick when the runner deals damage (a CLOUDBURST thrown before its wash) or
    // at the horn — those respawns are not counted as unprotected
    const dealt = new Set<number>();
    for (const e of ev) if (e.t === 'hit') dealt.add(e.by);
    for (const e of ev) {
      if (e.t !== 'spawn') continue;
      const r = w.runners[e.pid];
      const site = e.site >= 0 && e.site < w.spawnSites.length ? w.spawnSites[e.site] : null;
      if (!r || !site || e.site !== r.spawnSite || Math.abs(e.x - site.x) > 0.02 || Math.abs(e.z - site.z) > 0.02
        || Math.abs(e.y - site.y) > 0.1 || e.yaw !== site.yaw) this.payloadBad++;
      if (!r || !site) continue;
      const h = this.hist[e.pid];
      if (r.respawns === 0) { this.starts++; h.push(e.site); continue; }
      this.respawns++;
      for (let k = Math.max(0, h.length - SPAWN_GATES.recent); k < h.length; k++) if (h[k] === e.site) { this.repeats++; break; }
      h.push(e.site);
      let near = Infinity;
      for (const o of w.runners) if (o !== r && o.alive) near = Math.min(near, Math.hypot(o.x - e.x, o.y - e.y, o.z - e.z));
      this.minDist = Math.min(this.minDist, near);
      if (near < SPAWN_GATES.clear) this.within3++;
      if (!(r.protectedT > 0) && !dealt.has(e.pid) && w.phase !== 'ended') this.unprotected++;
      if (!this.seen(site.x, site.y, site.z, r.team, e.pid)) this.unseen++;
    }
  }

  /** a living foe of crew `team` within seeRange (eye → chest) with a clear line to a runner standing on site floor
   *  (x, y, z): feet MOVE.skin over it (Runner.respawn), chest half the tall hit height above the feet (canSee's aim) */
  private seen(x: number, y: number, z: number, team: number, pid: number): boolean {
    const w = this.w;
    const cy = y + MOVE.skin + HITBOX.height * 0.5;
    for (const o of w.runners) {
      if (o.id === pid || !o.alive || o.team === team) continue;
      const ey = o.y + (o.slickForm ? COMBAT.slickEyeHeight : COMBAT.eyeHeight);
      const dx = x - o.x, dy = cy - ey, dz = z - o.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > SPAWN_GATES.seeRange) continue;
      if (d < 1e-3) return true;
      const hit = w.physics.raycast(o.x, ey, o.z, dx, dy, dz, d);
      if (!hit || hit.toi >= d - 0.25) return true;
    }
    return false;
  }

  summary(): SpawnAuditSummary {
    const w = this.w;
    const distinct = this.hist.map((h) => new Set(h).size);
    const washed = w.runners.map((r) => r.washedCount);
    const fewSites: SpawnAuditSummary['fewSites'] = [];
    let heavy = 0;
    for (let i = 0; i < w.runners.length; i++) {
      if (washed[i] < SPAWN_GATES.minWashed) continue;
      heavy++;
      if (distinct[i] < SPAWN_GATES.minDistinct) fewSites.push({ pid: i, washed: washed[i], distinct: distinct[i] });
    }
    return {
      starts: this.starts, respawns: this.respawns, unseen: this.unseen, unseenRate: this.respawns ? this.unseen / this.respawns : 1,
      minRunnerDist: this.minDist, within3: this.within3, repeats: this.repeats, payloadBad: this.payloadBad, unprotected: this.unprotected,
      heavy, fewSites, distinct, washed, fallbacks: w.stats.spawnFallbacks,
      noUnseen: w.stats.spawnNoUnseen, meanCands: w.stats.spawnCands / Math.max(1, w.stats.spawns),
      meanUnseen: w.stats.spawnUnseenCands / Math.max(1, w.stats.spawns), meanSafe: w.stats.spawnSafeCands / Math.max(1, w.stats.spawns),
    };
  }
}

/** the S6 site gates of one or more summaries (a failing seed fails the gate): [name, pass, detail]. `unseenGate` false
 *  leaves the unseen-rate line out (probe_bots logs it as INFO via unseenLine: S6 gates the rate in probe_match) */
export function spawnGates(runs: Array<{ label: string; s: SpawnAuditSummary }>, unseenGate = true): Array<[string, boolean, string]> {
  const G = SPAWN_GATES;
  const per = (f: (s: SpawnAuditSummary) => string): string => runs.map((x) => `${x.label ? `${x.label}: ` : ''}${f(x.s)}`).join(' · ');
  const out: Array<[string, boolean, string]> = [
    [`every runner washed ≥ ${G.minWashed} times used ≥ ${G.minDistinct} distinct sites`,
      runs.every((x) => x.s.fewSites.length === 0),
      per((s) => `${s.heavy} runner(s) washed ≥ ${G.minWashed}×, distinct sites ${s.distinct.join('/')} for washed ${s.washed.join('/')}${s.fewSites.length ? ` ✗ ${s.fewSites.map((f) => `pid ${f.pid} ${f.distinct} sites / ${f.washed} washes`).join(', ')}` : ''}`)],
    [`no respawn within ${G.clear} m of another runner, never at one of the runner's last ${G.recent} sites`,
      runs.every((x) => x.s.within3 === 0 && x.s.repeats === 0),
      per((s) => `${s.respawns} respawns, nearest runner min ${Number.isFinite(s.minRunnerDist) ? s.minRunnerDist.toFixed(2) : '-'} m, < ${G.clear} m ${s.within3}, repeats ${s.repeats}`)],
    [`≥ ${G.unseenRate * 100} % of respawns unseen by every foe (the rate is logged)`, runs.every((x) => x.s.unseenRate >= G.unseenRate), per(unseenText)],
    ["every 'spawn' event matches its runner and site; every respawn is spawn-protected; one start site per runner",
      runs.every((x) => x.s.payloadBad === 0 && x.s.unprotected === 0 && x.s.starts === x.s.distinct.length),
      per((s) => `payload faults ${s.payloadBad}, unprotected respawns ${s.unprotected}, start events ${s.starts}`)],
  ];
  return unseenGate ? out : out.filter((g) => !g[0].includes('unseen'));
}

/** one run's unseen-respawn line: the rate and how much choice the pool gave */
export function unseenText(s: SpawnAuditSummary): string {
  return `${s.unseen}/${s.respawns} unseen = ${(s.unseenRate * 100).toFixed(1)} % (fallback choices ${s.fallbacks}, no unseen candidate ${s.noUnseen}; per choice candidates ${s.meanCands.toFixed(1)} / unseen ${s.meanUnseen.toFixed(1)} / safe ${s.meanSafe.toFixed(1)})`;
}
