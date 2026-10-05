// DYEFIELD — ONLINE wire protocol (CONTRACT_ONLINE §O3 + the O3.2a table below). THREE-free, DOM-free: Node probes import it.
//
// Binary frames (little-endian DataView), byte 0 = kind, byte 1 = slot (sender for client→host, target for host→one,
// 0xFF for host→all). The relay reads only those two bytes, the length and (SNAP) the u32 tick at bytes 2–5.
// Text frames are JSON control messages {t, …} (CONTRACT_ONLINE §O3.3).
//
// ── O3.2a — the final SNAP / KEYFRAME / HANDOFF layouts (SYNC, 2026-10-01) ──────────────────────────────────────────
// SNAP:  u8 kind=2 | u8 0xFF | u32 tick | u32 prevTick (the previous SNAP's tick: the base of the record tick offsets; a
//        client whose last applied SNAP is not prevTick missed one and resyncs) | u8 phase (0 countdown, 1 live, 2 ended)
//        | u16 ticksLeft | u16 countdownTicks
//        | u8 flags (b0 painter hash present, b1 scoreboard present, b2 first SNAP of a new host) | [u32 painterHash]
//        | u8 nRunners | nRunners × RUNNER BLOCK (52 B) | [SCOREBOARD] | u16 nRecords | records
// RUNNER BLOCK (52 B, offsets from the block start):
//    0 f32 tx | 4 f32 ty | 8 f32 tz      the capsule's TRANSLATION (feet y = (ty − halfHeight) − radius for the tall /
//                                        slick shape in flags.tall) — exact: Runner.x/y/z always come from the f32
//                                        translation, so the client reproduces the host's feet bit for bit
//   12 f32 vx | 16 f32 vy | 20 f32 vz
//   24 u16 yaw (×65536/2π) | 26 u16 aimYaw | 28 i16 aimPitch (×32767/π)
//   30 u16 flags: b0–2 MoveState (walk slog slick wallslick air), b3 alive, b4 slickForm, b5 firing, b6 hidden, b7 grounded,
//      b8 rolling, b9 flicking, b10 leaping, b11 charging, b12 specialReady, b13 courtFrozen, b14 tall, b15 ballistic
//   32 u8 hp (×255/WEAPONS.hp) | 33 f32 tank (exact enough for the dry-click rule the client predicts)
//   37 u8 special (floor ×255) | 38 u8 charge (×255) | 39 u8 respawnT (1/20 s) | 40 u8 protectedT (1/20 s)
//   41 u8 surfacing (whole ticks) | 42 u8 specialActive (0 none, else WEAPONS.specials index + 1) | 43 u8 specialT (1/20 s)
//   44 i8 spawnSite | 45 u8 subCooldown (1/20 s) | 46 u16 ackSeq (last consumed intent seq of a human runner, 0 a bot)
//   48 u8 launches (mod 256) | 49 i8 lastSpring | 50 u8 jumps (mod 256) | 51 u8 landings (mod 256)
// SCOREBOARD (every SCOREBOARD_EVERY ticks, and in every KEYFRAME / HANDOFF): CREW_SLOTS × u16 score, then per runner:
//   u16 washes | u16 washedCount | f32 painted | u16 shots | u8 seatSlot (0xFF none) | u8 seatHuman | u32 seatLiveTicks
//   | f32 seatPainted | u16 seatWashes | u16 seatWashed                                                      (24 B)
// RECORDS: each u8 tickOffset (ticks after the previous SNAP's tick, 1..) | u8 type | payload:
//   1 PAINT_SPHERE  u8 team | f64 x y z | f64 radius | u8 optMask (b0 normal, b1 minFacing, b2 edgeNoise, b3 seed)
//                   | [f64 nx ny nz] | [f64 minFacing] | [f64 edgeNoise] | [i32 seed] | u32 flips
//   2 PAINT_CAPSULE u8 team | f64 ax ay az | f64 bx by bz | f64 radius | u8 optMask | … as above | u32 flips
//   3 PSPAWN        u8 kind | u8 variant | u8 owner | u8 team | f32 x y z | f32 vx vy vz | u32 seed | f32 dripEvery
//   16 + i EVENT    SimEvent type EVENT_TYPES[i] (never 'splat': clients synthesize it), payload per EVENT_SPECS
// KEYFRAME: u8 kind=3 | u8 slot | u32 tick | u32 painterHash | u32 compressedLen | deflate-raw(atlas.team)
//           | the SNAP body from `prevTick` on (prevTick = tick; scoreboard always, nRecords = 0) | EXT BLOCKS
// HANDOFF:  u8 kind=4 | u8 0xFF | u32 tick | u32 painterHash | the SNAP body from `prevTick` on (scoreboard, nRecords = 0)
//           | EXT BLOCKS
//           | u32 jsonLen | UTF-8 JSON {roster, seats, matchNo, seed, migrations, botSkill, durationS, world (MatchWorld.netState)}
// EXT BLOCKS: u8 n, then per runner EXT_NUM.length × f64 | EXT_BOOL bits (u32) | u8 state | u8 lastGround | u8 specialActive
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

import type { PlayerIntent, MoveState, TeamId } from '../core/types.ts';
import { CREW_SLOTS } from '../core/types.ts';
import type { SimEvent } from '../core/match/events.ts';
import { RUNNER_NET_BOOL, RUNNER_NET_NUM, type RunnerNetState } from '../core/runner.ts';
import { CAMERA, MOVE, TANK, TICK } from '../core/config.ts';
import { WEAPONS } from '../core/data.ts';

// ───────────────────────────── constants (CONTRACT_ONLINE §O16) ─────────────────────────────
export const PROTO = 1;
export const SNAP_EVERY = 3;
export const INTENT_TICKS_PER_FRAME = 3;
export const INTENT_MAX_PER_FRAME = 6;
export const HASH_EVERY = 120;
export const SCOREBOARD_EVERY = 30;
export const INTERP_DELAY_MS = 100;
export const INTERP_MIN_MS = 66;
export const INTERP_MAX_MS = 150;
export const INTENT_QUEUE_TARGET = 2;
export const INTENT_QUEUE_MAX = 6;
export const INTENT_SILENT_NEUTRAL_MS = 250;
export const INTENT_SILENT_BOT_S = 3;
export const HOST_STALL_MS = 1500;
export const MAX_MIGRATIONS = 3;
export const KEYFRAME_MIN_INTERVAL_S = 10;
export const LOAD_TIMEOUT_S = 25;
export const LATE_JOIN_MIN_LEFT_S = 45;
export const IDLE_KICK_S = 60;
export const PRED_PAINT_TTL_MS = 600;
export const PING_LIVE_S = 2;
export const PING_IDLE_S = 10;
export const MAX_HUMANS = 8;
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LEN = 4;
export const DEFAULT_RELAY = 'wss://dyefield-net.isimcha85.workers.dev';

export const KIND_INTENTS = 0x01;
export const KIND_SNAP = 0x02;
export const KIND_KEYFRAME = 0x03;
export const KIND_HANDOFF = 0x04;
export const SLOT_ALL = 0xff;

export const CLOSE = {
  normal: 4000, notFound: 4004, kicked: 4008, full: 4009, build: 4026, rate: 4029, quota: 4030, closed: 4031,
} as const;

/** a 4-character room code of the alphabet (upper-cased, filtered); '' when it is not one */
export function normCode(raw: string): string {
  const s = (raw ?? '').toUpperCase().split('').filter((c) => CODE_ALPHABET.includes(c)).join('');
  return s.length === CODE_LEN ? s : '';
}

/** CONTRACT_ONLINE §O3: NET_BUILD = VERSION + "+p" + PROTO + "+" + BUILD_ID (the entry chunk's content hash, "dev" under
 *  the dev server). Only identical builds meet. */
export function netBuild(version: string, buildId: string): string {
  return `${version}+p${PROTO}+${buildId}`.toLowerCase().replace(/[^a-z0-9.:+-]/g, '').replace(/\+/g, ':').slice(0, 40);
}

/** the build id from a module URL: assets/index-<hash>.js → <hash> (8 chars); anything else → 'dev' */
export function buildIdFrom(url: string): string {
  const m = /index-([A-Za-z0-9_-]{6,})\.js/.exec(url);
  return m ? m[1].slice(0, 8).toLowerCase() : 'dev';
}

// ───────────────────────────── byte writer / reader ─────────────────────────────
export class Writer {
  private buf: ArrayBuffer;
  private dv: DataView;
  private u8a: Uint8Array;
  pos = 0;
  constructor(cap = 2048) { this.buf = new ArrayBuffer(cap); this.dv = new DataView(this.buf); this.u8a = new Uint8Array(this.buf); }
  reset(): this { this.pos = 0; return this; }
  private need(n: number): void {
    if (this.pos + n <= this.buf.byteLength) return;
    let cap = this.buf.byteLength * 2;
    while (cap < this.pos + n) cap *= 2;
    const nb = new ArrayBuffer(cap);
    new Uint8Array(nb).set(this.u8a.subarray(0, this.pos));
    this.buf = nb; this.dv = new DataView(nb); this.u8a = new Uint8Array(nb);
  }
  u8(v: number): void { this.need(1); this.dv.setUint8(this.pos, v & 0xff); this.pos += 1; }
  i8(v: number): void { this.need(1); this.dv.setInt8(this.pos, Math.max(-128, Math.min(127, v | 0))); this.pos += 1; }
  u16(v: number): void { this.need(2); this.dv.setUint16(this.pos, v & 0xffff, true); this.pos += 2; }
  i16(v: number): void { this.need(2); this.dv.setInt16(this.pos, Math.max(-32768, Math.min(32767, Math.round(v))), true); this.pos += 2; }
  u32(v: number): void { this.need(4); this.dv.setUint32(this.pos, v >>> 0, true); this.pos += 4; }
  i32(v: number): void { this.need(4); this.dv.setInt32(this.pos, v | 0, true); this.pos += 4; }
  f32(v: number): void { this.need(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v: number): void { this.need(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; }
  bytes(b: Uint8Array): void { this.need(b.length); this.u8a.set(b, this.pos); this.pos += b.length; }
  /** patch a u16 written earlier */
  setU16(at: number, v: number): void { this.dv.setUint16(at, v & 0xffff, true); }
  setU8(at: number, v: number): void { this.dv.setUint8(at, v & 0xff); }
  /** a copy of the written bytes (a frame to send) */
  take(): ArrayBuffer { return this.buf.slice(0, this.pos); }
  view(): Uint8Array { return this.u8a.subarray(0, this.pos); }
}

export class Reader {
  readonly dv: DataView;
  pos = 0;
  constructor(buf: ArrayBuffer | Uint8Array, at = 0) {
    this.dv = buf instanceof Uint8Array ? new DataView(buf.buffer, buf.byteOffset, buf.byteLength) : new DataView(buf);
    this.pos = at;
  }
  get left(): number { return this.dv.byteLength - this.pos; }
  private chk(n: number): void { if (this.pos + n > this.dv.byteLength) throw new Error(`net: frame truncated at ${this.pos}+${n}/${this.dv.byteLength}`); }
  u8(): number { this.chk(1); return this.dv.getUint8(this.pos++); }
  i8(): number { this.chk(1); return this.dv.getInt8(this.pos++); }
  u16(): number { this.chk(2); const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i16(): number { this.chk(2); const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u32(): number { this.chk(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i32(): number { this.chk(4); const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  f32(): number { this.chk(4); const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64(): number { this.chk(8); const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  bytes(n: number): Uint8Array { this.chk(n); const b = new Uint8Array(this.dv.buffer, this.dv.byteOffset + this.pos, n); this.pos += n; return b; }
}

export function frameKind(buf: ArrayBuffer): number { return buf.byteLength > 0 ? new Uint8Array(buf)[0] : 0; }
export function frameSlot(buf: ArrayBuffer): number { return buf.byteLength > 1 ? new Uint8Array(buf)[1] : 0; }
/** the u32 tick of a SNAP / KEYFRAME / HANDOFF (bytes 2–5) */
export function frameTick(buf: ArrayBuffer): number { return buf.byteLength >= 6 ? new DataView(buf).getUint32(2, true) : 0; }

// ───────────────────────────── strings ─────────────────────────────
const SPECIAL_IDS: string[] = WEAPONS.specials.map((s) => s.id);
const SUB_IDS: string[] = WEAPONS.subs.map((s) => s.id);
const KIT_IDS: string[] = WEAPONS.kits.map((k) => k.id);
export const STATES: readonly MoveState[] = ['walk', 'slog', 'slick', 'wallslick', 'air'];
const GROUNDS = ['walk', 'slog', 'slick'] as const;
export function specialIndex(id: string): number { const i = SPECIAL_IDS.indexOf(id); return i < 0 ? 0 : i + 1; }
export function specialId(i: number): string { return i > 0 ? (SPECIAL_IDS[i - 1] ?? '') : ''; }
function strIdx(list: readonly string[], s: string): number { const i = list.indexOf(s); return i < 0 ? 255 : i; }
function strAt(list: readonly string[], i: number): string { return list[i] ?? ''; }

// ───────────────────────────── intents ─────────────────────────────
export const YAW_Q = 65536 / (Math.PI * 2);
export const PITCH_Q = 32767 / Math.PI;
const PITCH_MIN = CAMERA.minPitchDeg * Math.PI / 180;
const PITCH_MAX = CAMERA.maxPitchDeg * Math.PI / 180;
/** aim points farther than this outside the map bounds are dropped (hasAim = false) */
export const AIM_MARGIN = 20;

/** the packed fields of one intent (13 B on the wire) */
export interface PackedIntent { mx: number; mz: number; yaw: number; pitch: number; buttons: number; ax: number; ay: number; az: number }

export interface Bounds { min: number[]; max: number[] }

const finite = (v: number, d = 0): number => (Number.isFinite(v) ? v : d);

/** Quantize `it` into `p` (the wire form). The same clamps run on the host for every received intent (§O8). */
export function packIntent(it: PlayerIntent, p: PackedIntent, bounds: Bounds | null): PackedIntent {
  p.mx = Math.round(Math.max(-1, Math.min(1, finite(it.moveX))) * 127);
  p.mz = Math.round(Math.max(-1, Math.min(1, finite(it.moveZ))) * 127);
  let y = finite(it.yaw) % (Math.PI * 2);
  if (y < 0) y += Math.PI * 2;
  p.yaw = Math.round(y * YAW_Q) & 0xffff;
  p.pitch = Math.round(Math.max(PITCH_MIN, Math.min(PITCH_MAX, finite(it.pitch))) * PITCH_Q);
  let b = 0;
  if (it.jump) b |= 1; if (it.fire) b |= 2; if (it.slick) b |= 4; if (it.sub) b |= 8; if (it.special) b |= 16;
  let aim = !!it.hasAim && Number.isFinite(it.aimX) && Number.isFinite(it.aimY) && Number.isFinite(it.aimZ);
  if (aim && bounds) {
    const m = AIM_MARGIN;
    if (it.aimX < bounds.min[0] - m || it.aimX > bounds.max[0] + m || it.aimY < bounds.min[1] - m || it.aimY > bounds.max[1] + m
      || it.aimZ < bounds.min[2] - m || it.aimZ > bounds.max[2] + m) aim = false;
  }
  if (aim && (Math.abs(it.aimX) > 327 || Math.abs(it.aimY) > 327 || Math.abs(it.aimZ) > 327)) aim = false;
  if (aim) b |= 32;
  p.buttons = b;
  p.ax = aim ? Math.round(it.aimX * 100) : 0;
  p.ay = aim ? Math.round(it.aimY * 100) : 0;
  p.az = aim ? Math.round(it.aimZ * 100) : 0;
  return p;
}

/** The intent both sides step with (the dequantized wire values; the pitch clamp re-applied). */
export function unpackIntent(p: PackedIntent, out: PlayerIntent): PlayerIntent {
  out.moveX = Math.max(-1, Math.min(1, p.mx / 127));
  out.moveZ = Math.max(-1, Math.min(1, p.mz / 127));
  let y = (p.yaw & 0xffff) / YAW_Q;
  if (y > Math.PI) y -= Math.PI * 2;
  out.yaw = y;
  out.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, p.pitch / PITCH_Q));
  const b = p.buttons;
  out.jump = (b & 1) !== 0; out.fire = (b & 2) !== 0; out.slick = (b & 4) !== 0; out.sub = (b & 8) !== 0; out.special = (b & 16) !== 0;
  out.hasAim = (b & 32) !== 0;
  out.aimX = out.hasAim ? p.ax / 100 : 0; out.aimY = out.hasAim ? p.ay / 100 : 0; out.aimZ = out.hasAim ? p.az / 100 : 0;
  return out;
}

/** §O8: an aim point outside the map bounds + AIM_MARGIN (or not finite) is dropped (hasAim = false) */
export function clampAim(it: PlayerIntent, bounds: Bounds | null): PlayerIntent {
  if (!it.hasAim) return it;
  const ok = Number.isFinite(it.aimX) && Number.isFinite(it.aimY) && Number.isFinite(it.aimZ) && (!bounds || (
    it.aimX >= bounds.min[0] - AIM_MARGIN && it.aimX <= bounds.max[0] + AIM_MARGIN && it.aimY >= bounds.min[1] - AIM_MARGIN
    && it.aimY <= bounds.max[1] + AIM_MARGIN && it.aimZ >= bounds.min[2] - AIM_MARGIN && it.aimZ <= bounds.max[2] + AIM_MARGIN));
  if (!ok) { it.hasAim = false; it.aimX = 0; it.aimY = 0; it.aimZ = 0; }
  return it;
}

export function emptyPacked(): PackedIntent { return { mx: 0, mz: 0, yaw: 0, pitch: 0, buttons: 0, ax: 0, ay: 0, az: 0 }; }

/** INTENTS: u8 kind | u8 slot | u16 firstSeq | u8 n | u8 flags | n × 13 B */
export function encodeIntents(w: Writer, slot: number, firstSeq: number, list: readonly PackedIntent[], flags: number): ArrayBuffer {
  w.reset();
  w.u8(KIND_INTENTS); w.u8(slot); w.u16(firstSeq & 0xffff); w.u8(list.length); w.u8(flags);
  for (const p of list) {
    w.i8(p.mx); w.i8(p.mz); w.u16(p.yaw); w.i16(p.pitch); w.u8(p.buttons); w.i16(p.ax); w.i16(p.ay); w.i16(p.az);
  }
  return w.take();
}

export interface IntentsFrame { slot: number; firstSeq: number; flags: number; list: PackedIntent[] }
export function decodeIntents(buf: ArrayBuffer): IntentsFrame | null {
  try {
    const r = new Reader(buf);
    if (r.u8() !== KIND_INTENTS) return null;
    const slot = r.u8(), firstSeq = r.u16(), n = r.u8(), flags = r.u8();
    if (n < 1 || n > INTENT_MAX_PER_FRAME) return null;
    const list: PackedIntent[] = [];
    for (let i = 0; i < n; i++) {
      list.push({ mx: r.i8(), mz: r.i8(), yaw: r.u16(), pitch: r.i16(), buttons: r.u8(), ax: r.i16(), ay: r.i16(), az: r.i16() });
    }
    return { slot, firstSeq, flags, list };
  } catch { return null; }
}

/** modular u16 sequence compare: a − b in −32768..32767 */
export function seqDiff(a: number, b: number): number { return ((a - b + 0x18000) & 0xffff) - 0x8000; }

// ───────────────────────────── runner block ─────────────────────────────
export const RUNNER_BLOCK = 52;

/** the decoded runner block of a SNAP (feet already reconstructed from the translation) */
export interface RunnerSnap {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  yaw: number; aimYaw: number; aimPitch: number;
  state: MoveState; alive: boolean; slickForm: boolean; firing: boolean; hidden: boolean; grounded: boolean;
  rolling: boolean; flicking: boolean; leaping: boolean; charging: boolean; specialReady: boolean; courtFrozen: boolean;
  tall: boolean; ballistic: boolean;
  hp: number; tank: number; special: number; charge: number; respawnT: number; protectedT: number; surfacing: number;
  specialActive: string; specialT: number; spawnSite: number; subCooldown: number; ackSeq: number;
  launches: number; lastSpring: number; jumps: number; landings: number;
}

export interface RunnerLike {
  x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; aimYaw: number; aimPitch: number;
  state: MoveState; alive: boolean; slickForm: boolean; firing: boolean; hidden: boolean; grounded: boolean; rolling: boolean;
  flicking: boolean; leaping: boolean; charging: boolean; specialReady: boolean; courtFrozen: boolean; readonly isTall: boolean;
  ballistic: boolean; hp: number; tank: number; special: number; charge: number; respawnT: number; protectedT: number;
  surfacing: number; specialActive: string; specialT: number; spawnSite: number; subCooldown: number; launches: number;
  lastSpring: number; jumps: number; landings: number;
}

const HP_MAX = WEAPONS.hp;
const clampU8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));
const angU16 = (a: number): number => { let y = finite(a) % (Math.PI * 2); if (y < 0) y += Math.PI * 2; return Math.round(y * YAW_Q) & 0xffff; };
const u16Ang = (v: number): number => { let y = v / YAW_Q; if (y > Math.PI) y -= Math.PI * 2; return y; };
const halfOf = (tall: boolean): number => (tall ? MOVE.halfHeight : MOVE.slickHalfHeight);

export function writeRunner(w: Writer, r: RunnerLike, ackSeq: number): void {
  const tall = r.isTall;
  w.f32(r.x); w.f32(r.y + halfOf(tall) + MOVE.radius); w.f32(r.z);
  w.f32(r.vx); w.f32(r.vy); w.f32(r.vz);
  w.u16(angU16(r.yaw)); w.u16(angU16(r.aimYaw)); w.i16(Math.max(-Math.PI, Math.min(Math.PI, finite(r.aimPitch))) * PITCH_Q);
  let f = Math.max(0, STATES.indexOf(r.state)) & 7;
  if (r.alive) f |= 1 << 3; if (r.slickForm) f |= 1 << 4; if (r.firing) f |= 1 << 5; if (r.hidden) f |= 1 << 6;
  if (r.grounded) f |= 1 << 7; if (r.rolling) f |= 1 << 8; if (r.flicking) f |= 1 << 9; if (r.leaping) f |= 1 << 10;
  if (r.charging) f |= 1 << 11; if (r.specialReady) f |= 1 << 12; if (r.courtFrozen) f |= 1 << 13; if (tall) f |= 1 << 14;
  if (r.ballistic) f |= 1 << 15;
  w.u16(f);
  w.u8(clampU8(r.hp * 255 / HP_MAX));
  w.f32(r.tank);
  w.u8(Math.max(0, Math.min(255, Math.floor(finite(r.special) * 255 + 1e-9))));
  w.u8(clampU8(r.charge * 255));
  w.u8(clampU8(r.respawnT * 20));
  w.u8(clampU8(r.protectedT * 20));
  w.u8(clampU8(r.surfacing / TICK));
  w.u8(specialIndex(r.specialActive));
  w.u8(clampU8(r.specialT * 20));
  w.i8(r.spawnSite);
  w.u8(clampU8(r.subCooldown * 20));
  w.u16(ackSeq & 0xffff);
  w.u8(r.launches & 0xff); w.i8(r.lastSpring); w.u8(r.jumps & 0xff); w.u8(r.landings & 0xff);
}

export function readRunner(r: Reader, o: RunnerSnap): RunnerSnap {
  const tx = r.f32(), ty = r.f32(), tz = r.f32();
  o.vx = r.f32(); o.vy = r.f32(); o.vz = r.f32();
  o.yaw = u16Ang(r.u16()); o.aimYaw = u16Ang(r.u16()); o.aimPitch = r.i16() / PITCH_Q;
  const f = r.u16();
  o.state = STATES[f & 7] ?? 'walk';
  o.alive = (f & (1 << 3)) !== 0; o.slickForm = (f & (1 << 4)) !== 0; o.firing = (f & (1 << 5)) !== 0; o.hidden = (f & (1 << 6)) !== 0;
  o.grounded = (f & (1 << 7)) !== 0; o.rolling = (f & (1 << 8)) !== 0; o.flicking = (f & (1 << 9)) !== 0; o.leaping = (f & (1 << 10)) !== 0;
  o.charging = (f & (1 << 11)) !== 0; o.specialReady = (f & (1 << 12)) !== 0; o.courtFrozen = (f & (1 << 13)) !== 0;
  o.tall = (f & (1 << 14)) !== 0; o.ballistic = (f & (1 << 15)) !== 0;
  o.x = tx; o.y = (ty - halfOf(o.tall)) - MOVE.radius; o.z = tz;
  o.hp = r.u8() * HP_MAX / 255;
  o.tank = r.f32();
  o.special = r.u8() / 255;
  o.charge = r.u8() / 255;
  o.respawnT = r.u8() / 20;
  o.protectedT = r.u8() / 20;
  o.surfacing = r.u8() * TICK;
  o.specialActive = specialId(r.u8());
  o.specialT = r.u8() / 20;
  o.spawnSite = r.i8();
  o.subCooldown = r.u8() / 20;
  o.ackSeq = r.u16();
  o.launches = r.u8(); o.lastSpring = r.i8(); o.jumps = r.u8(); o.landings = r.u8();
  return o;
}

export function emptyRunnerSnap(): RunnerSnap {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, aimYaw: 0, aimPitch: 0, state: 'walk', alive: true, slickForm: false, firing: false,
    hidden: false, grounded: true, rolling: false, flicking: false, leaping: false, charging: false, specialReady: false, courtFrozen: false,
    tall: true, ballistic: false, hp: HP_MAX, tank: TANK.max, special: 0, charge: 0, respawnT: 0, protectedT: 0, surfacing: 0,
    specialActive: '', specialT: 0, spawnSite: -1, subCooldown: 0, ackSeq: 0, launches: 0, lastSpring: -1, jumps: 0, landings: 0,
  };
}

// ───────────────────────────── scoreboard ─────────────────────────────
export interface SeatTotals { slot: number; human: boolean; liveTicks: number; painted: number; washes: number; washedCount: number }
export interface ScoreRunner { washes: number; washedCount: number; painted: number; shots: number; seat: SeatTotals | null }
export interface Scoreboard { scores: number[]; runners: ScoreRunner[] }

export function writeScoreboard(w: Writer, sb: Scoreboard): void {
  for (let k = 0; k < CREW_SLOTS; k++) w.u16(sb.scores[k] ?? 0);
  for (const r of sb.runners) {
    w.u16(r.washes); w.u16(r.washedCount); w.f32(r.painted); w.u16(r.shots);
    const s = r.seat;
    w.u8(s ? s.slot : 0xff); w.u8(s && s.human ? 1 : 0); w.u32(s ? s.liveTicks : 0); w.f32(s ? s.painted : 0);
    w.u16(s ? s.washes : 0); w.u16(s ? s.washedCount : 0);
  }
}

export function readScoreboard(r: Reader, n: number): Scoreboard {
  const scores: number[] = [];
  for (let k = 0; k < CREW_SLOTS; k++) scores.push(r.u16());
  const runners: ScoreRunner[] = [];
  for (let i = 0; i < n; i++) {
    const washes = r.u16(), washedCount = r.u16(), painted = r.f32(), shots = r.u16();
    const slot = r.u8(), human = r.u8() === 1, liveTicks = r.u32(), sp = r.f32(), sw = r.u16(), swd = r.u16();
    runners.push({ washes, washedCount, painted, shots, seat: slot === 0xff ? null : { slot, human, liveTicks, painted: sp, washes: sw, washedCount: swd } });
  }
  return { scores, runners };
}

// ───────────────────────────── records ─────────────────────────────
export const REC_SPHERE = 1;
export const REC_CAPSULE = 2;
export const REC_PSPAWN = 3;
export const REC_EVENT0 = 16;

export interface PaintRec {
  type: 1 | 2; tick: number; team: TeamId; ax: number; ay: number; az: number; bx: number; by: number; bz: number; radius: number;
  hasN: boolean; nx: number; ny: number; nz: number; minFacing: number | undefined; edgeNoise: number | undefined; seed: number | undefined; flips: number;
}
export interface SpawnRec {
  type: 3; tick: number; kind: number; variant: number; owner: number; team: number; x: number; y: number; z: number;
  vx: number; vy: number; vz: number; seed: number; dripEvery: number;
}
export interface EventRec { type: 16; tick: number; e: SimEvent }
export type NetRecord = PaintRec | SpawnRec | EventRec;

export function writePaint(w: Writer, tickOffset: number, capsule: boolean, team: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number, o: { radius: number; nx?: number; ny?: number; nz?: number; minFacing?: number; edgeNoise?: number; seed?: number }, flips: number): void {
  w.u8(tickOffset); w.u8(capsule ? REC_CAPSULE : REC_SPHERE);
  w.u8(team);
  w.f64(ax); w.f64(ay); w.f64(az);
  if (capsule) { w.f64(bx); w.f64(by); w.f64(bz); }
  w.f64(o.radius);
  const hasN = o.nx !== undefined || o.ny !== undefined || o.nz !== undefined;
  let m = 0;
  if (hasN) m |= 1; if (o.minFacing !== undefined) m |= 2; if (o.edgeNoise !== undefined) m |= 4; if (o.seed !== undefined) m |= 8;
  w.u8(m);
  if (hasN) { w.f64(o.nx ?? 0); w.f64(o.ny ?? 0); w.f64(o.nz ?? 0); }
  if (o.minFacing !== undefined) w.f64(o.minFacing);
  if (o.edgeNoise !== undefined) w.f64(o.edgeNoise);
  if (o.seed !== undefined) w.i32(o.seed | 0);
  w.u32(flips);
}

export function writeSpawn(w: Writer, tickOffset: number, kind: number, owner: number, team: number, x: number, y: number, z: number,
  vx: number, vy: number, vz: number, seed: number, dripEvery: number, variant: number): void {
  w.u8(tickOffset); w.u8(REC_PSPAWN);
  w.u8(kind); w.u8(variant); w.u8(owner); w.u8(team);
  w.f32(x); w.f32(y); w.f32(z); w.f32(vx); w.f32(vy); w.f32(vz); w.u32(seed >>> 0); w.f32(dripEvery);
}

// Event payload specs: [field, type]. 'pid8' = u8 runner id; 'by16' = i16 (-1 = null for 'washed'); 's' = string table.
type FieldT = 'u8' | 'i16' | 'u16' | 'f32' | 'dir' | 'bool' | 'cause' | 'phaseS' | 'phaseSub' | 'horn' | 'mphase' | 'spec' | 'sub' | 'kit' | 'nullby';
const EVENT_SPECS: Record<string, Array<[string, FieldT]>> = {
  shot: [['pid', 'u8'], ['kit', 'kit'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['dx', 'dir'], ['dy', 'dir'], ['dz', 'dir']],
  dry: [['pid', 'u8']],
  hit: [['victim', 'u8'], ['by', 'i16'], ['dmg', 'f32'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32']],
  washed: [['victim', 'u8'], ['by', 'nullby'], ['cause', 'cause']],
  respawn: [['pid', 'u8']],
  slick: [['pid', 'u8'], ['on', 'bool'], ['wall', 'bool']],
  jump: [['pid', 'u8']],
  land: [['pid', 'u8'], ['hard', 'bool']],
  tankLow: [['pid', 'u8']],
  special: [['pid', 'u8'], ['id', 'spec'], ['phase', 'phaseS'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32']],
  sub: [['pid', 'u8'], ['id', 'sub'], ['phase', 'phaseSub'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32']],
  horn: [['kind', 'horn']],
  phase: [['phase', 'mphase']],
  glint: [['pid', 'u8'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['dx', 'dir'], ['dy', 'dir'], ['dz', 'dir'], ['charge', 'f32']],
  beam: [['pid', 'u8'], ['x0', 'f32'], ['y0', 'f32'], ['z0', 'f32'], ['x1', 'f32'], ['y1', 'f32'], ['z1', 'f32'], ['charge', 'f32']],
  burst: [['pid', 'u8'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['r', 'f32'], ['air', 'bool']],
  roll: [['pid', 'u8'], ['on', 'bool']],
  flick: [['pid', 'u8']],
  ring: [['pid', 'u8'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['r', 'f32']],
  score: [['crew', 'u8'], ['score', 'u16'], ['pid', 'u8']],
  spawn: [['pid', 'u8'], ['site', 'u8'], ['x', 'f32'], ['y', 'f32'], ['z', 'f32'], ['yaw', 'f32']],
};
export const EVENT_TYPES: string[] = Object.keys(EVENT_SPECS);
const CAUSES = ['dye', 'sea', 'sub', 'special'];
const SPHASES = ['ready', 'start', 'end', 'denied'];
const SUBPHASES = ['throw', 'land', 'pop'];
const HORNS = ['start', 'minute', 'final10', 'end'];
const MPHASES = ['countdown', 'live', 'ended'];

/** append one EVENT record (never 'splat'); returns false for a type with no spec */
export function writeEvent(w: Writer, tickOffset: number, e: SimEvent): boolean {
  const ti = EVENT_TYPES.indexOf(e.t);
  if (ti < 0) return false;
  w.u8(tickOffset); w.u8(REC_EVENT0 + ti);
  const ev = e as unknown as Record<string, unknown>;
  for (const [k, t] of EVENT_SPECS[e.t]) {
    const v = ev[k];
    switch (t) {
      case 'u8': w.u8(Number(v) | 0); break;
      case 'i16': w.i16(Number(v)); break;
      case 'u16': w.u16(Number(v) | 0); break;
      case 'f32': w.f32(Number(v)); break;
      case 'dir': w.i16(Math.max(-1, Math.min(1, finite(Number(v)))) * 32767); break;
      case 'bool': w.u8(v ? 1 : 0); break;
      case 'nullby': w.i16(v === null || v === undefined ? -1 : Number(v)); break;
      case 'cause': w.u8(strIdx(CAUSES, String(v))); break;
      case 'phaseS': w.u8(strIdx(SPHASES, String(v))); break;
      case 'phaseSub': w.u8(strIdx(SUBPHASES, String(v))); break;
      case 'horn': w.u8(strIdx(HORNS, String(v))); break;
      case 'mphase': w.u8(strIdx(MPHASES, String(v))); break;
      case 'spec': w.u8(strIdx(SPECIAL_IDS, String(v))); break;
      case 'sub': w.u8(strIdx(SUB_IDS, String(v))); break;
      case 'kit': w.u8(strIdx(KIT_IDS, String(v))); break;
    }
  }
  return true;
}

function readEvent(r: Reader, ti: number): SimEvent {
  const t = EVENT_TYPES[ti];
  const spec = EVENT_SPECS[t];
  if (!spec) throw new Error(`net: unknown event record ${ti}`);
  const e: Record<string, unknown> = { t };
  for (const [k, ty] of spec) {
    switch (ty) {
      case 'u8': e[k] = r.u8(); break;
      case 'i16': e[k] = r.i16(); break;
      case 'u16': e[k] = r.u16(); break;
      case 'f32': e[k] = r.f32(); break;
      case 'dir': e[k] = r.i16() / 32767; break;
      case 'bool': e[k] = r.u8() === 1; break;
      case 'nullby': { const v = r.i16(); e[k] = v < 0 ? null : v; break; }
      case 'cause': e[k] = strAt(CAUSES, r.u8()) || 'dye'; break;
      case 'phaseS': e[k] = strAt(SPHASES, r.u8()) || 'end'; break;
      case 'phaseSub': e[k] = strAt(SUBPHASES, r.u8()) || 'throw'; break;
      case 'horn': e[k] = strAt(HORNS, r.u8()) || 'start'; break;
      case 'mphase': e[k] = strAt(MPHASES, r.u8()) || 'live'; break;
      case 'spec': e[k] = strAt(SPECIAL_IDS, r.u8()); break;
      case 'sub': e[k] = strAt(SUB_IDS, r.u8()); break;
      case 'kit': e[k] = strAt(KIT_IDS, r.u8()); break;
    }
  }
  return e as unknown as SimEvent;
}

/** read `n` records; `baseTick` = the previous SNAP's tick (record tick = base + tickOffset) */
export function readRecords(r: Reader, n: number, baseTick: number, out: NetRecord[]): void {
  for (let i = 0; i < n; i++) {
    const tick = baseTick + r.u8();
    const type = r.u8();
    if (type === REC_SPHERE || type === REC_CAPSULE) {
      const team = r.u8();
      const ax = r.f64(), ay = r.f64(), az = r.f64();
      let bx = ax, by = ay, bz = az;
      if (type === REC_CAPSULE) { bx = r.f64(); by = r.f64(); bz = r.f64(); }
      const radius = r.f64();
      const m = r.u8();
      const hasN = (m & 1) !== 0;
      let nx = 0, ny = 0, nz = 0;
      if (hasN) { nx = r.f64(); ny = r.f64(); nz = r.f64(); }
      const minFacing = (m & 2) !== 0 ? r.f64() : undefined;
      const edgeNoise = (m & 4) !== 0 ? r.f64() : undefined;
      const seed = (m & 8) !== 0 ? r.i32() : undefined;
      const flips = r.u32();
      out.push({ type, tick, team, ax, ay, az, bx, by, bz, radius, hasN, nx, ny, nz, minFacing, edgeNoise, seed, flips } as PaintRec);
    } else if (type === REC_PSPAWN) {
      const kind = r.u8(), variant = r.u8(), owner = r.u8(), team = r.u8();
      const x = r.f32(), y = r.f32(), z = r.f32(), vx = r.f32(), vy = r.f32(), vz = r.f32();
      const seed = r.u32(), dripEvery = r.f32();
      out.push({ type: 3, tick, kind, variant, owner, team, x, y, z, vx, vy, vz, seed, dripEvery });
    } else if (type >= REC_EVENT0) {
      out.push({ type: 16, tick, e: readEvent(r, type - REC_EVENT0) });
    } else throw new Error(`net: unknown record type ${type}`);
  }
}

/** the SplatOpts a paint record replays (undefined stays undefined) */
export function paintOpts(p: PaintRec): { radius: number; team: TeamId; nx?: number; ny?: number; nz?: number; minFacing?: number; edgeNoise?: number; seed?: number } {
  const o: { radius: number; team: TeamId; nx?: number; ny?: number; nz?: number; minFacing?: number; edgeNoise?: number; seed?: number } = { radius: p.radius, team: p.team };
  if (p.hasN) { o.nx = p.nx; o.ny = p.ny; o.nz = p.nz; }
  if (p.minFacing !== undefined) o.minFacing = p.minFacing;
  if (p.edgeNoise !== undefined) o.edgeNoise = p.edgeNoise;
  if (p.seed !== undefined) o.seed = p.seed;
  return o;
}

// ───────────────────────────── SNAP ─────────────────────────────
export const PHASES = ['countdown', 'live', 'ended'] as const;

export interface SnapHeader {
  tick: number; prevTick: number; phase: 'countdown' | 'live' | 'ended'; ticksLeft: number; countdownTicks: number;
  hash: number | null; fresh: boolean;
}

export interface DecodedSnap extends SnapHeader {
  runners: RunnerSnap[];
  scoreboard: Scoreboard | null;
  records: NetRecord[];
}

/** write the SNAP body from `prevTick` on (no kind / slot / tick) */
export function writeSnapBody(w: Writer, h: SnapHeader, runners: readonly RunnerLike[], ack: readonly number[], sb: Scoreboard | null): void {
  w.u32(h.prevTick);
  w.u8(Math.max(0, PHASES.indexOf(h.phase)));
  w.u16(Math.max(0, Math.min(65535, h.ticksLeft)));
  w.u16(Math.max(0, Math.min(65535, h.countdownTicks)));
  let fl = 0;
  if (h.hash !== null) fl |= 1;
  if (sb) fl |= 2;
  if (h.fresh) fl |= 4;
  w.u8(fl);
  if (h.hash !== null) w.u32(h.hash);
  w.u8(runners.length);
  for (let i = 0; i < runners.length; i++) writeRunner(w, runners[i], ack[i] ?? 0);
  if (sb) writeScoreboard(w, sb);
}

export function readSnapBody(r: Reader, tick: number, out?: DecodedSnap): DecodedSnap {
  const prevTick = r.u32();
  const phase = PHASES[r.u8()] ?? 'live';
  const ticksLeft = r.u16(), countdownTicks = r.u16();
  const fl = r.u8();
  const hash = (fl & 1) !== 0 ? r.u32() : null;
  const n = r.u8();
  const runners: RunnerSnap[] = out?.runners ?? [];
  runners.length = n;
  for (let i = 0; i < n; i++) runners[i] = readRunner(r, runners[i] ?? emptyRunnerSnap());
  const scoreboard = (fl & 2) !== 0 ? readScoreboard(r, n) : null;
  const records: NetRecord[] = [];
  if (r.left >= 2) {
    const nr = r.u16();
    readRecords(r, nr, prevTick, records);
  }
  return { tick, prevTick, phase, ticksLeft, countdownTicks, hash, fresh: (fl & 4) !== 0, runners, scoreboard, records };
}

/** decode a SNAP (record ticks = its prevTick + tickOffset). Throws on a malformed frame. */
export function decodeSnap(buf: ArrayBuffer): DecodedSnap {
  const r = new Reader(buf);
  if (r.u8() !== KIND_SNAP) throw new Error('net: not a SNAP');
  r.u8();
  const tick = r.u32();
  return readSnapBody(r, tick);
}

// ───────────────────────────── extended runner blocks (KEYFRAME / HANDOFF) ─────────────────────────────
const EXT_PRIV_NUM = ['coyote', 'jumpBuf', 'brushClock', 'offDyeT', 'wallCd', 'probeNx', 'probeNz', 'spawnX', 'spawnY', 'spawnZ', 'spawnYaw'] as const;
const EXT_PRIV_BOOL = ['tall', 'prevJump', 'prevFire', 'refilling'] as const;
export const EXT_NUM: readonly string[] = [...RUNNER_NET_NUM, ...EXT_PRIV_NUM];
export const EXT_BOOL: readonly string[] = [...RUNNER_NET_BOOL, ...EXT_PRIV_BOOL];

export function writeExt(w: Writer, list: readonly RunnerNetState[]): void {
  w.u8(list.length);
  for (const s of list) {
    const o = s as unknown as Record<string, unknown>;
    for (const k of EXT_NUM) w.f64(Number(o[k]));
    let bits = 0;
    for (let i = 0; i < EXT_BOOL.length; i++) if (o[EXT_BOOL[i]]) bits |= 1 << i;
    w.u32(bits >>> 0);
    w.u8(Math.max(0, STATES.indexOf(s.state)));
    w.u8(Math.max(0, GROUNDS.indexOf(s.lastGround)));
    w.u8(specialIndex(s.specialActive));
  }
}

export function readExt(r: Reader): RunnerNetState[] {
  const n = r.u8();
  const out: RunnerNetState[] = [];
  for (let j = 0; j < n; j++) {
    const o: Record<string, unknown> = {};
    for (const k of EXT_NUM) o[k] = r.f64();
    const bits = r.u32();
    for (let i = 0; i < EXT_BOOL.length; i++) o[EXT_BOOL[i]] = (bits & (1 << i)) !== 0;
    o.state = STATES[r.u8()] ?? 'walk';
    o.lastGround = GROUNDS[r.u8()] ?? 'walk';
    o.specialActive = specialId(r.u8());
    out.push(o as unknown as RunnerNetState);
  }
  return out;
}

// ───────────────────────────── KEYFRAME / HANDOFF ─────────────────────────────
export interface StateFrame {
  kind: number; slot: number; tick: number; hash: number;
  team: Uint8Array | null;           // KEYFRAME: the compressed atlas.team bytes (still deflated)
  snap: DecodedSnap;                  // runners + scoreboard (no records)
  ext: RunnerNetState[];
  json: Record<string, unknown> | null;
}

/** the body of a KEYFRAME / HANDOFF (SNAP body + nRecords 0 + EXT BLOCKS), encoded at the state's tick (synchronously) */
export function encodeStateBody(h: SnapHeader, runners: readonly RunnerLike[], ack: readonly number[], sb: Scoreboard, ext: readonly RunnerNetState[]): Uint8Array {
  const w = new Writer(8192);
  writeSnapBody(w, h, runners, ack, sb);
  w.u16(0);                                   // nRecords
  writeExt(w, ext);
  return w.view().slice();
}

/** assemble a KEYFRAME (deflated team bytes) or a HANDOFF (JSON tail) around a pre-encoded body */
export function assembleStateFrame(kind: number, slot: number, tick: number, hash: number, deflated: Uint8Array | null, body: Uint8Array, json: unknown): ArrayBuffer {
  const w = new Writer(body.length + (deflated ? deflated.length : 0) + 1024);
  w.u8(kind); w.u8(slot); w.u32(tick); w.u32(hash >>> 0);
  if (kind === KIND_KEYFRAME) { const d = deflated ?? new Uint8Array(0); w.u32(d.length); w.bytes(d); }
  w.bytes(body);
  if (kind === KIND_HANDOFF) {
    const b = new TextEncoder().encode(JSON.stringify(json ?? {}));
    w.u32(b.length); w.bytes(b);
  }
  return w.take();
}

export function decodeStateFrame(buf: ArrayBuffer): StateFrame {
  const r = new Reader(buf);
  const kind = r.u8(), slot = r.u8(), tick = r.u32(), hash = r.u32();
  if (kind !== KIND_KEYFRAME && kind !== KIND_HANDOFF) throw new Error('net: not a state frame');
  let team: Uint8Array | null = null;
  if (kind === KIND_KEYFRAME) { const n = r.u32(); team = r.bytes(n).slice(); }
  const snap = readSnapBody(r, tick);
  const ext = readExt(r);
  let json: Record<string, unknown> | null = null;
  if (kind === KIND_HANDOFF && r.left >= 4) {
    const n = r.u32();
    try { json = JSON.parse(new TextDecoder().decode(r.bytes(n))) as Record<string, unknown>; } catch { json = null; }
  }
  return { kind, slot, tick, hash, team, snap, ext, json };
}

// ───────────────────────────── deflate (KEYFRAME paint bytes) ─────────────────────────────
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const s = new Blob([data as unknown as BlobPart]).stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  const ab = await new Response(s).arrayBuffer();
  return new Uint8Array(ab);
}
export function deflateRaw(data: Uint8Array): Promise<Uint8Array> { return pipe(data, new CompressionStream('deflate-raw')); }
export function inflateRaw(data: Uint8Array): Promise<Uint8Array> { return pipe(data, new DecompressionStream('deflate-raw')); }

/** painter.hash() (8 hex digits) → u32 */
export function hashU32(hex: string): number { return parseInt(hex, 16) >>> 0; }

// ───────────────────────────── text control messages (CONTRACT_ONLINE §O3.3) ─────────────────────────────
export type Device = 'kbm' | 'touch';
export interface HelloFields { proto: number; build: string; name: string; kit: string; crew: number; color: number; device: Device; simMs: number; rttMs: number }
export interface WireMember { slot: number; name: string; kit: string; crew: number; color: number; device: Device; conn: boolean; owner: boolean; host: boolean; rttMs: number | null }
export interface WireRoom { code: string; quick: boolean; mode: 'teams' | 'ffa'; rule: 'turf' | 'washout'; map: string; preset: string; skill: 'breeze' | 'swell' | 'storm'; phase: 'room' | 'loading' | 'live' | 'post' | 'closed'; ownerSlot: number; hostSlot: number; matchNo: number }
export interface WireSeat { slot: number; runner: number }
export interface WireRosterEntry { id: number; name: string; team: number; kit: string; bot: boolean; skill: 'breeze' | 'swell' | 'storm' }
export interface WireEndRunner { id: number; name: string; team: number; slot: number | null; washes: number; washedCount: number; painted: number; shots: number; seat: SeatTotals | null }

export type TextMsg =
  | ({ t: 'qm' } & HelloFields)
  | { t: 'queue'; waiting: number; waitedS: number }
  | { t: 'solo' }
  | { t: 'matched'; code: string; ticket: string }
  | ({ t: 'hello'; token?: string } & HelloFields)
  | { t: 'welcome'; slot: number; token: string; room: WireRoom }
  | { t: 'members'; members: WireMember[]; phase: WireRoom['phase']; room?: WireRoom }
  | { t: 'set'; kit?: string; crew?: number; color?: number; rttMs?: number; simMs?: number }
  | { t: 'cfg'; mode?: string; rule?: string; map?: string; preset?: string; skill?: string; durationS?: number }
  | { t: 'start' }
  | { t: 'assign'; matchNo: number; hostSlot: number; seed: number; map: string; preset: string; mode: 'teams' | 'ffa'; rule: 'turf' | 'washout'; skill: 'breeze' | 'swell' | 'storm'; durationS?: number }
  | { t: 'roster'; matchNo: number; seats: WireSeat[]; roster: WireRosterEntry[]; durationS: number; countdownS: number; from?: number }
  | { t: 'loaded'; matchNo: number; atlasSig: number; from?: number }
  | { t: 'seat'; runner: number; slot: number | null; name: string; human: boolean; from?: number }
  | { t: 'resync'; tick: number; myHash: number; from?: number }
  | { t: 'end'; matchNo: number; result?: unknown; runners?: WireEndRunner[]; migrations?: number; voided: boolean; from?: number }
  | { t: 'kick'; slot: number; why: 'idle' | 'owner' }
  | { t: 'handoff' }
  | { t: 'host'; hostSlot: number; reason: 'left' | 'stalled' | 'handoff'; lastTick: number }
  | { t: 'peer'; slot: number; conn: boolean }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'err'; code: string; msg: string };

export function parseText(s: string): TextMsg | null {
  try {
    const m = JSON.parse(s) as { t?: unknown };
    return m && typeof m === 'object' && typeof m.t === 'string' ? (m as TextMsg) : null;
  } catch { return null; }
}

/** CONTRACT_ONLINE §O8: names — NFC, control + bidi characters stripped, trimmed, ≤ 16 characters, empty → GUEST-xxxx */
export function sanitizeName(raw: unknown, salt = 0): string {
  let s = typeof raw === 'string' ? raw : '';
  try { s = s.normalize('NFC'); } catch { /* old engine */ }
  // C0 / C1 controls, bidi marks / embeddings / isolates, zero-width joiners
  s = s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, '').trim();
  const chars = Array.from(s).slice(0, 16);
  s = chars.join('').trim();
  if (!s) s = `GUEST-${((salt >>> 0) % 0x10000).toString(16).toUpperCase().padStart(4, '0')}`;
  return s;
}

/** CONTRACT_ONLINE §O4.5 step 3: atlasSig = hash32-style FNV over (size, count, area[] and lin[] every 997th texel) */
export function atlasSig(atlas: { size: number; count: number; area: Float32Array; lin: Int32Array }): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h ^= v & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff; h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff; h = Math.imul(h, 0x01000193);
  };
  mix(atlas.size); mix(atlas.count);
  const fb = new Float32Array(1), ib = new Int32Array(fb.buffer);
  for (let i = 0; i < atlas.count; i += 997) { fb[0] = atlas.area[i]; mix(ib[0]); mix(atlas.lin[i]); }
  return h >>> 0;
}
