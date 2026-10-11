// GENESIS — where a thing the camera follows is, this frame (CONTRACT.md §15.8 follow): a person, a herd, the creature,
// a ship, a disaster, a building, a settlement, the weather, the god's own body, a cell. Everything is read from the
// WorldView at the render tick (movers extrapolated along their velocity like the crowds draw them; ships from the
// ship layer's interpolated poses), so a followed thing moves as smoothly as it is drawn.

import type { WorldView, PlanetView } from '../../client/worldview.ts';
import type { EntityRef } from '../../sim/types.ts';
import { qRotate, type D3 } from '../../client/orbits.ts';
import { tangentBasis } from '../../sim/core/vec3.ts';
import { SHIP_POSES } from '../life/ships.ts';

export interface TargetState {
  /** the world it is on (−1 between the worlds) */
  planet: number;
  /** body-frame position (m, from the planet's centre) when planet ≥ 0, else the system-frame position */
  pos: D3;
  /** system-frame position (m) */
  sys: D3;
  /** the direction it faces / travels (unit, same frame as pos); null when it has none */
  fwd: D3 | null;
  /** its own up (unit, same frame): the radial up on a world, a ship's axis */
  up: D3;
  /** its size (m: a person 1.7, a rocket its height, a storm its radius) */
  size: number;
  /** m per tick it is moving (0 when still) */
  speed: number;
}

/** the god's body on the ground (camera/walk.ts sets it while walking) */
export const AVATAR = { planet: -1, pos: [0, 0, 0] as D3, heading: 0, active: false };

const _e: D3 = [0, 0, 0];
const _n: D3 = [0, 0, 0];

function headingDir(u: ArrayLike<number>, heading: number): D3 {
  tangentBasis(_e, _n, u);
  const c = Math.cos(heading), s = Math.sin(heading);
  return [_n[0] * c + _e[0] * s, _n[1] * c + _e[1] * s, _n[2] * c + _e[2] * s];
}

function norm(v: D3): D3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; return v; }

function finish(view: WorldView, pv: PlanetView, u: D3, lift: number, fwd: D3 | null, size: number, speed: number, out: TargetState): TargetState {
  norm(u);
  const r = view.groundRadius(pv, u[0], u[1], u[2]) + lift;
  out.planet = pv.id;
  out.pos = [u[0] * r, u[1] * r, u[2] * r];
  out.up = [u[0], u[1], u[2]];
  out.fwd = fwd;
  out.size = size;
  out.speed = speed;
  const s = qRotate(pv.quat, out.pos);
  out.sys = [pv.center[0] + s[0], pv.center[1] + s[1], pv.center[2] + s[2]];
  return out;
}

/** resolve a target for this frame; null when it is gone (died, landed elsewhere, a storm blew out) */
export function resolveTarget(view: WorldView, ref: EntityRef, out: TargetState = { planet: -1, pos: [0, 0, 0], sys: [0, 0, 0], fwd: null, up: [0, 1, 0], size: 2, speed: 0 }): TargetState | null {
  if (ref.kind === 'ship') {
    const p = SHIP_POSES.get(ref.id);
    const sv = view.ships.find((s) => s.id === ref.id);
    if (!p || !sv) return null;
    out.planet = p.planet;
    out.pos = p.planet >= 0 ? [p.body.x, p.body.y, p.body.z] : [p.sys[0], p.sys[1], p.sys[2]];
    out.sys = [p.sys[0], p.sys[1], p.sys[2]];
    out.up = [p.up.x, p.up.y, p.up.z];
    out.fwd = [p.fwd.x, p.fwd.y, p.fwd.z];
    out.size = Math.max(4, p.size);
    out.speed = sv.phase === 'ascent' || sv.phase === 'descent' ? 30 : sv.phase === 'orbit' || sv.phase === 'transfer' ? 100 : 0;
    return out;
  }
  if (ref.kind === 'avatar') {
    if (!AVATAR.active) return null;
    const pv = view.planet(AVATAR.planet);
    if (!pv) return null;
    const u: D3 = [AVATAR.pos[0], AVATAR.pos[1], AVATAR.pos[2]];
    return finish(view, pv, u, 1.1, headingDir(norm([...u] as D3), AVATAR.heading), 2.2, 0, out);
  }
  const pv = view.planet(ref.planet ?? -1) ?? (ref.kind === 'creature' ? view.planet(view.creatures.find((c) => c.id === ref.id)?.planet ?? -1) : undefined);
  if (!pv) return null;
  const dt = (pv.renderTick ?? pv.paramsTick) - pv.paramsTick;
  switch (ref.kind) {
    case 'agent': {
      const A = pv.agents;
      if (!A) return null;
      for (let i = 0; i < A.count; i++) {
        if (A.id[i] !== ref.id) continue;
        const u: D3 = [A.pos[i * 3] + A.vel[i * 3] * dt, A.pos[i * 3 + 1] + A.vel[i * 3 + 1] * dt, A.pos[i * 3 + 2] + A.vel[i * 3 + 2] * dt];
        const sp = Math.hypot(A.vel[i * 3], A.vel[i * 3 + 1], A.vel[i * 3 + 2]) * pv.params.radius;
        const sc = A.scale[i] || 1;
        return finish(view, pv, u, Math.max(0, A.alt[i]) + 1.0 * sc, headingDir(norm([...u] as D3), A.heading[i]), 1.7 * sc, sp, out);
      }
      return null;
    }
    case 'animal': {
      // a herd: its members' centre (the herd id is the movers' group)
      const M = pv.animals;
      if (!M) return null;
      let x = 0, y = 0, z = 0, n = 0, alt = 0, h = 0, vx = 0, vy = 0, vz = 0;
      for (let i = 0; i < M.count; i++) {
        if (M.group[i] !== ref.id && !(M.id[i] === ref.id && M.group[i] < 0)) continue;
        x += M.pos[i * 3] + M.vel[i * 3] * dt; y += M.pos[i * 3 + 1] + M.vel[i * 3 + 1] * dt; z += M.pos[i * 3 + 2] + M.vel[i * 3 + 2] * dt;
        vx += M.vel[i * 3]; vy += M.vel[i * 3 + 1]; vz += M.vel[i * 3 + 2];
        alt += Math.max(0, M.alt[i]); h = M.heading[i]; n++;
      }
      if (!n) return null;
      const u: D3 = [x, y, z];
      return finish(view, pv, u, alt / n + 1.2, headingDir(norm([...u] as D3), h), 3 + Math.sqrt(n), (Math.hypot(vx, vy, vz) / n) * pv.params.radius, out);
    }
    case 'creature': {
      const c = view.creatures.find((q) => q.id === ref.id);
      if (!c) return null;
      const u: D3 = [c.pos[0], c.pos[1], c.pos[2]];
      return finish(view, pv, u, c.height * 0.55, headingDir(norm([...u] as D3), c.heading), Math.max(3, c.height), 0, out);
    }
    case 'disaster': {
      const d = pv.disasters.find((q) => q.id === ref.id);
      if (!d) return null;
      const u: D3 = [d.pos[0], d.pos[1], d.pos[2]];
      return finish(view, pv, u, 10 + Math.min(600, d.params.alt ?? 0), null, Math.max(30, Math.min(1500, d.radius)), 0, out);
    }
    case 'weather': {
      const w = pv.weather.find((q) => q.id === ref.id);
      if (!w) return null;
      const u: D3 = [w.pos[0], w.pos[1], w.pos[2]];
      return finish(view, pv, u, 200, null, Math.max(100, w.radius), 0, out);
    }
    case 'building': {
      const B = pv.buildings;
      if (!B) return null;
      for (let i = 0; i < B.count; i++) if (B.id[i] === ref.id) return finish(view, pv, [B.pos[i * 3], B.pos[i * 3 + 1], B.pos[i * 3 + 2]], 4, null, 12 * (B.scale[i] || 1), 0, out);
      return null;
    }
    case 'settlement': {
      const s = pv.settlements.find((q) => q.id === ref.id);
      if (!s) return null;
      return finish(view, pv, [s.pos[0], s.pos[1], s.pos[2]], 6, null, 120, 0, out);
    }
    case 'cell': {
      if (ref.id < 0 || ref.id >= pv.grid.count) return null;
      const P = pv.grid.pos;
      return finish(view, pv, [P[ref.id * 3], P[ref.id * 3 + 1], P[ref.id * 3 + 2]], 2, null, 30, 0, out);
    }
  }
  return null;
}
