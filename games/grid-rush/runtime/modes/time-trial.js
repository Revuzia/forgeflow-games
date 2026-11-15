/* Grid Rush — modes/time-trial.js
 * Solo TIME TRIAL vs a GHOST of your best run for this circuit.
 * Registry contract (adapted to the shipped factory pattern, see grand-prix.js):
 *   rivalCount = 0                       → startRace spawns no AI (solo)
 *   onRaceStart(game)                    → per-race: load ghost, spawn translucent
 *                                          kart, reset recorder, set banner + HUD
 *   update / onRacerFinish / hudExtra    → record, replay, save-on-PB, paint delta
 *   results(game)                        → own the results panel (time vs ghost)
 *   teardown(game)                       → remove/dispose ghost, restore HUD chrome
 * The ghost is a pure visual (never a Racer), so it is invisible to collisions,
 * ranking, checkpoints, hazards and the item world.
 */
import * as THREE from 'three';
import { VEHICLES, LAPS } from '../config.js';
import { buildVehicleMesh } from '../vehicles.js';
import { clamp, lerp, wrapAngle, formatTime } from '../math.js';

const SAMPLE_HZ = 10;
const SAMPLE_DT = 1 / SAMPLE_HZ; // 0.1 s between ghost samples
const STRIDE = 5; // floats/sample: x, y, z, yaw, s
const MAX_SAMPLES = 6000; // ~600 s hard bound
const GHOST_OPACITY = 0.32;
const SCHEMA = 2;

const keyGhost = (c) => `gridrush_ghost_${c}`;
const KEY_RECORDS = 'gridrush_tt_records'; // { circuitId: bestSeconds } — menu badges

// ── storage ──────────────────────────────────────────────────────────────
function loadRecords() {
  try {
    return JSON.parse(localStorage.getItem(KEY_RECORDS) || '{}');
  } catch {
    return {};
  }
}
export function bestTimeFor(circuitId) {
  const r = loadRecords();
  return typeof r[circuitId] === 'number' ? r[circuitId] : null;
}
function packFloats(f32) {
  // Float32Array → base64
  const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
  let bin = '';
  const CH = 0x8000; // chunk to dodge String.fromCharCode arg limits
  for (let i = 0; i < u8.length; i += CH) bin += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(bin);
}
function unpackFloats(b64) {
  // base64 → Float32Array
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}
function loadGhost(circuit) {
  let raw;
  try {
    raw = JSON.parse(localStorage.getItem(keyGhost(circuit)) || 'null');
  } catch {
    raw = null;
  }
  if (!raw || raw.v !== SCHEMA || !raw.data) return null;
  let flat;
  try {
    flat = unpackFloats(raw.data);
  } catch {
    return null;
  }
  const n = raw.n || Math.floor(flat.length / STRIDE);
  if (n < 2) return null;
  return { time: raw.time, dt: raw.dt || SAMPLE_DT, n, vehicle: raw.vehicle || 'prism', flat };
}
function saveGhost(circuit, g) {
  const payload = { v: SCHEMA, circuit, time: g.time, dt: SAMPLE_DT, n: g.n, vehicle: g.vehicle, data: packFloats(g.flat) };
  try {
    localStorage.setItem(keyGhost(circuit), JSON.stringify(payload));
    const rec = loadRecords();
    rec[circuit] = g.time;
    localStorage.setItem(KEY_RECORDS, JSON.stringify(rec));
  } catch {
    /* quota — keep in-memory best, skip persist */
  }
}

// ── translucent ghost kart (fresh materials per build → safe to mutate) ────
function buildGhostMesh(vehicleId) {
  const mesh = buildVehicleMesh(VEHICLES[vehicleId] || VEHICLES.prism);
  mesh.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      m.transparent = true;
      m.opacity = (m.opacity == null ? 1 : m.opacity) * GHOST_OPACITY;
      m.depthWrite = false;
    }
    o.renderOrder = 3;
  });
  return mesh;
}

// ── HUD injection ──────────────────────────────────────────────────────────
function injectHudStyle() {
  if (document.getElementById('gr-tt-style')) return;
  const s = document.createElement('style');
  s.id = 'gr-tt-style';
  s.textContent = `
  #gr-tt-hud{display:contents;}
  #gr-tt-delta{font-family:var(--font-display,"Orbitron",sans-serif);font-weight:800;
    font-size:1.15rem;letter-spacing:.02em;color:#ffe566;}
  #gr-tt-delta.ahead{color:#39ff88;} #gr-tt-delta.behind{color:#ff5a7a;}
  .gr-tt-row{display:flex;justify-content:space-between;gap:1.4rem;padding:.3rem 0;
    font-family:var(--font-mono,"Share Tech Mono",monospace);letter-spacing:.06em;color:#c8dcff;}
  .gr-tt-row b{font-family:var(--font-display,"Orbitron",sans-serif);color:#fff;}
  .gr-tt-row.big{font-size:1.15rem;} .gr-tt-row.note{color:#8fd;justify-content:center;}
  .gr-tt-row.ahead,.gr-tt-row.ahead b{color:#39ff88;}
  .gr-tt-row.behind,.gr-tt-row.behind b{color:#ff5a7a;}`;
  document.head.appendChild(s);
}

export function createTimeTrial() {
  return {
    id: 'time_trial',
    label: 'TIME TRIAL',
    rivalCount: 0,

    // per-race state (all reset in onRaceStart)
    ghost: null,
    ghostMesh: null,
    rec: null,
    _acc: 0,
    _cursor: 0,
    _delta: null,
    _summary: null,
    _hud: null,

    menuMeta(game) {
      const b = bestTimeFor(game.trackId);
      return b != null ? `SOLO · BEST ${formatTime(b)}` : 'SOLO · NO GHOST YET';
    },

    // Per-race init — called from startRace AFTER the track/scene/player exist.
    onRaceStart(game) {
      this.rec = [];
      this._acc = SAMPLE_DT; // force a sample on the first racing frame (t≈0)
      this._cursor = 0;
      this._delta = null;
      this._summary = null;

      this.ghost = loadGhost(game.trackId);
      if (this.ghost) {
        this.ghostMesh = buildGhostMesh(this.ghost.vehicle);
        this._poseGhost(game, 0); // park at sample 0 for the countdown
        game.scene.add(this.ghostMesh);
      } else {
        this.ghostMesh = null;
      }

      this._ensureHud();
      this._chrome(game, true);

      if (game.els.banner) {
        game.els.banner.textContent = this.ghost
          ? `TIME TRIAL · ${LAPS} LAPS · GHOST ${formatTime(this.ghost.time)}`
          : `TIME TRIAL · ${LAPS} LAPS · SET A GHOST`;
      }
    },

    update(game, dt) {
      const p = game.player;
      if (!p) return;

      // 1) record player at a fixed rate while actually racing
      if (game.phase === 'racing' && !p.finished && this.rec.length < MAX_SAMPLES * STRIDE) {
        this._acc += dt;
        while (this._acc >= SAMPLE_DT && this.rec.length < MAX_SAMPLES * STRIDE) {
          this._acc -= SAMPLE_DT;
          this.rec.push(p.position.x, p.position.y, p.position.z, p.yaw, p.trackS);
        }
      }
      // 2) drive the ghost by the race clock
      if (this.ghostMesh) this._poseGhost(game, game.raceTime);
      // 3) live delta at the player's current distance
      this._delta = this.ghost ? this._deltaAt(game, p.trackS) : null;
    },

    onRacerFinish(game, racer) {
      if (!racer.isPlayer) return;
      const time = racer.finishTime;
      const prev = bestTimeFor(game.trackId);
      const improved = prev == null || time < prev;
      if (improved && this.rec && this.rec.length >= 2 * STRIDE) {
        const flat = Float32Array.from(this.rec);
        saveGhost(game.trackId, { time, n: flat.length / STRIDE, dt: SAMPLE_DT, vehicle: game.vehicleId, flat });
      }
      this._summary = { time, prev, improved };
    },

    hudExtra(game) {
      if (!this._hud) return;
      const b = bestTimeFor(game.trackId);
      this._hud.best.textContent = b != null ? formatTime(b) : '—:—.—';
      const d = this._delta,
        el = this._hud.delta;
      if (d == null || game.phase !== 'racing') {
        el.textContent = this.ghost ? '+0.00' : 'NO GHOST';
        el.className = '';
      } else {
        el.textContent = (d < 0 ? '-' : '+') + Math.abs(d).toFixed(2);
        el.className = d < 0 ? 'ahead' : 'behind';
      }
    },

    results(game) {
      const s = this._summary || { time: game.player?.finishTime ?? 0, prev: bestTimeFor(game.trackId), improved: false };
      if (game.els.resultsTitle) game.els.resultsTitle.textContent = s.improved ? 'NEW GHOST RECORD' : 'RUN COMPLETE';
      const host = game.els.resultsStats;
      if (!host) return;
      const rows = [`<div class="gr-tt-row big">YOUR TIME <b>${formatTime(s.time)}</b></div>`];
      if (s.prev != null) {
        const best = Math.min(s.time, s.prev);
        const dvs = s.time - s.prev;
        rows.push(`<div class="gr-tt-row">BEST <b>${formatTime(best)}</b></div>`);
        rows.push(
          `<div class="gr-tt-row ${dvs <= 0 ? 'ahead' : 'behind'}">VS GHOST <b>${dvs <= 0 ? '-' : '+'}${Math.abs(dvs).toFixed(2)}s</b></div>`
        );
      } else {
        rows.push(`<div class="gr-tt-row note">FIRST GHOST SET — race again to chase it</div>`);
      }
      host.innerHTML = rows.join('');
    },

    teardown(game) {
      if (this.ghostMesh) {
        game.scene.remove(this.ghostMesh);
        this.ghostMesh.traverse((o) => {
          if (o.geometry) o.geometry.dispose();
          if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
        });
        this.ghostMesh = null;
      }
      this.ghost = null;
      this.rec = null;
      this._delta = null;
      this._chrome(game, false);
    },

    // ── internals ────────────────────────────────────────────────────────────
    _poseGhost(game, t) {
      const g = this.ghost,
        mesh = this.ghostMesh;
      if (!g || !mesh) return;
      mesh.rotation.order = 'YXZ';
      const f = t / g.dt;
      let i = Math.floor(f);
      if (i >= g.n - 1) {
        // run complete → hold final pose
        const o = (g.n - 1) * STRIDE;
        mesh.position.set(g.flat[o], g.flat[o + 1], g.flat[o + 2]);
        mesh.rotation.y = g.flat[o + 3];
        return;
      }
      if (i < 0) i = 0;
      const frac = f - i,
        a = i * STRIDE,
        b = (i + 1) * STRIDE;
      mesh.position.set(
        lerp(g.flat[a], g.flat[b], frac),
        lerp(g.flat[a + 1], g.flat[b + 1], frac),
        lerp(g.flat[a + 2], g.flat[b + 2], frac)
      );
      mesh.rotation.y = g.flat[a + 3] + wrapAngle(g.flat[b + 3] - g.flat[a + 3]) * frac;
    },

    _deltaAt(game, playerS) {
      const g = this.ghost;
      const sIdx = (k) => g.flat[k * STRIDE + 4];
      if (playerS <= sIdx(0)) return game.raceTime;
      if (playerS >= sIdx(g.n - 1)) return game.raceTime - g.time;
      let c = clamp(this._cursor, 0, g.n - 2);
      while (c < g.n - 2 && sIdx(c + 1) < playerS) c++; // advance
      while (c > 0 && sIdx(c) > playerS) c--; // retreat (spin/knockback)
      this._cursor = c;
      const s0 = sIdx(c),
        s1 = sIdx(c + 1),
        seg = s1 - s0;
      const frac = seg > 1e-4 ? (playerS - s0) / seg : 0;
      return game.raceTime - (c + frac) * g.dt;
    },

    _ensureHud() {
      if (this._hud) return;
      injectHudStyle();
      // Reuse an existing panel — createTimeTrial() makes a fresh object per race,
      // so guard against injecting duplicate #gr-tt-hud nodes across races.
      let wrap = document.getElementById('gr-tt-hud');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'gr-tt-hud';
        wrap.innerHTML =
          `<div class="inst"><div class="inst-label">BEST</div><div id="gr-tt-best" class="inst-value">—:—.—</div></div>` +
          `<div class="inst"><div class="inst-label">VS GHOST</div><div id="gr-tt-delta">NO GHOST</div></div>`;
        (document.getElementById('bottom-cluster') || document.getElementById('hud'))?.appendChild(wrap);
      }
      this._hud = { wrap, best: wrap.querySelector('#gr-tt-best'), delta: wrap.querySelector('#gr-tt-delta') };
    },

    _chrome(game, on) {
      // hide the multiplayer POSITION + STANDINGS insts while solo; show the TT HUD
      const pos = document.getElementById('hud-pos')?.closest('.inst');
      const lead = document.getElementById('hud-leaders')?.closest('.inst');
      for (const el of [pos, lead]) if (el) el.style.display = on ? 'none' : '';
      if (this._hud) this._hud.wrap.style.display = on ? '' : 'none';
    },
  };
}
