// BLOCKTOOTH — toy traffic (CONTRACT.md §7.2). THREE-FREE, deterministic, no rng consumed.
// Owner: city-sim lane. Called once per tick by stepCity (citysim.ts).
//
// Cars are Props with lane ≥ 0. They follow their lane polyline at a per-car cruise speed
// (8–12 m/s, hashed from seed+id), keep a gap to the car ahead IN THE SAME LANE (stopping
// at 0 behind a stationary one), brake and turn `scared` when the titan is within 3H + 6 m
// ahead, reverse-flee when it is very close, and floor it when the titan is behind them.
// Heading comes from the lane tangent (finite difference over ±1 m, so corners turn
// smoothly). Destroyed cars leave the lane (dropped from the lane lists, never block).
// Moving cars keep city.blockProps current (re-listed when they cross a block cell).

import type { CityLayout, World } from '../core/types.ts';
import { cellOf, cruiseSpeed, laneCum, laneEval, laneHeading, PROP_INFO } from './citygen.ts';

const MIN_GAP = 1.6;          // bumper-to-bumper standstill gap (m)
const FOLLOW_K = 1.2;         // speed allowance per metre of free gap (1/s)
const ACCEL = 5;              // m/s²
const BRAKE = 16;             // m/s²
const REVERSE_SPEED = 5;      // m/s when reverse-fleeing
const PANIC_MUL = 1.45;       // cruise multiplier when fleeing forward
const SCARE_S = 1.5;          // scared timer refresh (s)

interface TrafficIndex {
  cum: Float64Array[];        // per lane cumulative vertex arc lengths
  cars: number[][];           // per lane: live car prop ids, kept sorted by laneS
  cell: Int32Array;           // per prop: block cell it is currently listed under (−1 = not traffic)
  nProps: number;
}

const INDEX = new WeakMap<CityLayout, TrafficIndex>();

function buildIndex(city: CityLayout): TrafficIndex {
  const cum = city.lanes.map((l) => laneCum(l));
  const cars: number[][] = city.lanes.map(() => []);
  const cell = new Int32Array(city.props.length).fill(-1);
  for (const p of city.props) {
    if (p.lane < 0 || p.lane >= city.lanes.length) continue;
    if (p.alive) cars[p.lane].push(p.id);
    // listing invariant: a traffic prop is always listed under cellOf(its current x,z)
    cell[p.id] = cellOf(city, p.x, p.z);
  }
  for (const list of cars) list.sort((a, b) => city.props[a].laneS - city.props[b].laneS || a - b);
  return { cum, cars, cell, nProps: city.props.length };
}

function getIndex(city: CityLayout): TrafficIndex {
  let idx = INDEX.get(city);
  if (!idx || idx.nProps !== city.props.length || idx.cum.length !== city.lanes.length) {
    idx = buildIndex(city);
    INDEX.set(city, idx);
  }
  return idx;
}

// scratch (no per-tick allocation in the hot loop)
let targetBuf = new Float64Array(64);
const EV = { x: 0, z: 0, h: 0 };

export function stepTraffic(w: World): void {
  const city = w.city;
  if (!city.lanes.length) return;
  const idx = getIndex(city);
  const props = city.props;
  const dt = w.dt;
  const T = w.titan;
  const H = Math.max(1, T.height);
  const scareR = 3 * H + 6;
  const fleeR = 1.2 * H + 5 + T.radius;
  const titanLive = T.alive;

  for (let li = 0; li < idx.cars.length; li++) {
    const list = idx.cars[li];
    if (!list.length) continue;
    // destroyed cars leave the lane
    let j = 0;
    for (let k = 0; k < list.length; k++) if (props[list[k]].alive) list[j++] = list[k];
    list.length = j;
    const n = list.length;
    if (!n) continue;
    const lane = city.lanes[li];
    const L = lane.length;
    const closed = lane.closed;
    const cum = idx.cum[li];
    if (targetBuf.length < n) targetBuf = new Float64Array(n * 2);

    // pass 1: target speeds from the CURRENT positions (order-independent)
    for (let k = 0; k < n; k++) {
      const p = props[list[k]];
      const cruise = cruiseSpeed(city.seed, p.id);
      const halfLen = PROP_INFO[p.kind].len / 2;
      let target = cruise;
      if (titanLive) {
        const dx = T.x - p.x, dz = T.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < scareR) {
          const along = dx * Math.sin(p.heading) + dz * Math.cos(p.heading);
          if (along > -T.radius) {
            // titan ahead (or alongside): brake; very close → reverse-flee
            if (d < fleeR && along > 0) target = -REVERSE_SPEED;
            else target = 0;
            p.scared = SCARE_S;
          } else {
            target = cruise * PANIC_MUL;       // titan behind: floor it
            p.scared = SCARE_S;
          }
        } else if (p.scared > 0) target = cruise * (1 + (PANIC_MUL - 1) * Math.min(1, p.scared / SCARE_S));
      }
      p.scared = Math.max(0, p.scared - dt);

      // gap keeping against the car ahead in this lane
      if (target > 0) {
        let q = -1, ahead = 0;
        if (k + 1 < n) { q = list[k + 1]; ahead = props[q].laneS - p.laneS; }
        else if (closed && n > 1) { q = list[0]; ahead = props[q].laneS + L - p.laneS; }
        if (q >= 0) {
          const gap = ahead - halfLen - PROP_INFO[props[q].kind].len / 2;
          const leadV = Math.max(0, props[q].speed);
          target = Math.min(target, Math.max(0, (gap - MIN_GAP) * FOLLOW_K + leadV));
          if (gap <= MIN_GAP && leadV <= 0.05) target = 0;
        }
      } else if (target < 0) {
        // reversing: don't back into the car behind (or off the start of an open lane)
        let q = -1, behind = 0;
        if (k > 0) { q = list[k - 1]; behind = p.laneS - props[q].laneS; }
        else if (closed && n > 1) { q = list[n - 1]; behind = p.laneS + L - props[q].laneS; }
        if (q >= 0 && behind - halfLen - PROP_INFO[props[q].kind].len / 2 <= MIN_GAP) target = 0;
        if (!closed && p.laneS <= halfLen) target = 0;
      }
      targetBuf[k] = target;
    }

    // pass 2: integrate speed + arc length, place on the lane, keep the block index current
    let wrapped = false;
    for (let k = 0; k < n; k++) {
      const p = props[list[k]];
      const target = targetBuf[k];
      if (target > p.speed) p.speed = Math.min(target, p.speed + ACCEL * dt);
      else p.speed = Math.max(target, p.speed - BRAKE * dt);
      let s = p.laneS + p.speed * dt;
      let teleport = false;
      if (closed) {
        if (s >= L) { s -= L; wrapped = true; } else if (s < 0) { s += L; wrapped = true; }
      } else if (s >= L) {
        s -= L; teleport = true; wrapped = true;             // open lane: re-enter at the start
      } else if (s < 0) {
        s = 0; p.speed = 0;
      }
      p.laneS = s;
      laneEval(lane, cum, s, EV);
      p.x = EV.x; p.z = EV.z;
      // smoothed tangent heading (centred difference; clamps at open-lane ends)
      p.heading = laneHeading(lane, cum, s, EV.h);
      if (teleport) { p.px = p.x; p.pz = p.z; p.pheading = p.heading; }   // no interpolation streak across the map

      const c = cellOf(city, p.x, p.z);
      const old = idx.cell[p.id];
      if (c !== old) {
        if (old >= 0) {
          const bl = city.blockProps[old];
          const at = bl.indexOf(p.id);
          if (at >= 0) bl.splice(at, 1);
        }
        city.blockProps[c].push(p.id);
        idx.cell[p.id] = c;
      }
    }

    // keep the lane list sorted by laneS (nearly sorted: insertion sort)
    if (wrapped || n > 1) {
      for (let a = 1; a < n; a++) {
        const id = list[a], s = props[id].laneS;
        let b = a - 1;
        while (b >= 0 && props[list[b]].laneS > s) { list[b + 1] = list[b]; b--; }
        list[b + 1] = id;
      }
    }
  }
}
