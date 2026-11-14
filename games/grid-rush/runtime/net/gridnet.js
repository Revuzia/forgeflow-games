/* Grid Rush — net/gridnet.js
 * Wire helpers for online play: shared FFG Supabase credentials, the kart
 * pack/unpack schema, and per-slot interpolation. The stateful session lives in
 * online-mode.js (the OnlineMode); this file is pure, testable helpers.
 * Backend: the same Supabase project + anon key every FFG multiplayer game uses
 * (Realtime Broadcast/Presence only — never touches Postgres, so it is $0).
 */
import { NetPlay } from './ffg_netplay.js';
import { wrapAngle, lerp } from '../math.js';

export { NetPlay };

export const SUPABASE_URL = 'https://wugoxdewcdxzfppgzohy.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves';

/** Quantized kart state for the wire, keyed by global `slot` (§8 of the spec). */
export function packKart(r) {
  return {
    s: r.slot,
    x: +r.position.x.toFixed(2),
    y: +r.position.y.toFixed(2),
    z: +r.position.z.toFixed(2),
    yw: +r.yaw.toFixed(3),
    vx: +r.velocity.x.toFixed(2),
    vy: +r.velocity.y.toFixed(2),
    vz: +r.velocity.z.toFixed(2),
    tS: +r.trackS.toFixed(1),
    lap: r.lap,
    cp: r.cpIndex,
    tb: Math.round(r.turbine),
    fl:
      (r.drifting ? 1 : 0) |
      (r.airborne ? 2 : 0) |
      (r.phasing ? 4 : 0) |
      (r.veil ? 8 : 0) |
      (r.overclockTimer > 0 ? 16 : 0) |
      (r.stun > 0 ? 32 : 0),
    it: r.item || 0,
  };
}

/** Decode packet `p` into racer `r` — authoritative fields set directly; the
 *  position/yaw go into the interp buffer (not applied here), the rest are HUD/
 *  ranking-bearing and are trusted verbatim for remotes. */
export function applyPacketAuthoritative(r, p) {
  r.trackS = p.tS;
  r.lap = p.lap;
  r.cpIndex = p.cp;
  r.turbine = p.tb;
  r.item = p.it || null;
  const fl = p.fl | 0;
  r.drifting = !!(fl & 1);
  r.airborne = !!(fl & 2);
  r.phasing = !!(fl & 4);
  r.veil = !!(fl & 8);
  // overclock/stun as booleans-ish (visual only for remotes)
  r.overclockTimer = fl & 16 ? Math.max(r.overclockTimer, 0.1) : 0;
  r.stun = fl & 32 ? Math.max(r.stun, 0.1) : 0;
}

/** Push a fresh packet into a slot's {a,b} interpolation buffer. */
export function pushInterp(buf, p, now) {
  buf.a = buf.b;
  buf.b = { x: p.x, y: p.y, z: p.z, yw: p.yw, vx: p.vx, vy: p.vy, vz: p.vz, at: now };
}

/** Interpolate a remote kart toward its latest packet, with mild velocity
 *  dead-reckoning so fast karts don't rubber-band across the 66 ms gap. */
export function interpKart(r, buf, now) {
  const b = buf.b;
  if (!b) return;
  const a = buf.a || b;
  const span = Math.max(1, b.at - a.at);
  let k = (now - b.at) / span; // 0 at b, grows after
  // base lerp a→b, clamped, then dead-reckon past b for one dropped packet
  const kc = Math.min(1, Math.max(0, k));
  let x = lerp(a.x, b.x, kc);
  let y = lerp(a.y, b.y, kc);
  let z = lerp(a.z, b.z, kc);
  const over = Math.min(0.1, Math.max(0, (now - b.at) / 1000)); // s of extrapolation, capped
  x += b.vx * over;
  y += b.vy * over;
  z += b.vz * over;
  r.position.set(x, y, z);
  r.yaw = a.yw + wrapAngle(b.yw - a.yw) * kc;
}
