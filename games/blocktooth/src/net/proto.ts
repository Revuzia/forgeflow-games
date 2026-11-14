// BLOCKTOOTH - net/proto.ts (lane B-NET). Wire constants + binary codecs for the host-clocked lockstep session
// (ONLINE_PLAN.md B.1, netcode.md 6.3 / 7.1). THREE-free, DOM-free, sim-free: runs under plain node.
//
// Layout of the game stream (WebRTC DataChannels, host star; never Supabase):
//   INPUT  guest -> authority, unreliable, 30 Hz : the guest's last <= INPUT_REDUNDANCY stamped 4-byte inputs
//   FRAME  authority -> guest, unreliable, 30 Hz : every confirmed frame the guest has not acked yet (<= FRAME_BATCH)
//   HASH   any -> every peer, unreliable, 1 Hz   : (tick, world hash, frame-log hash) at every HASH_EVERY-th tick
//   LOG    reliable                              : a run of confirmed frames (resend, migration hand-over, replay join)
//   CTL    reliable                              : small JSON control messages (join, migrate, seat, leave, result)
//
// One confirmed frame = FRAME_BYTES = 2 + 4 x 4 = 18 bytes: lateMask (a guest's input was late -> its previous input
// was repeated), botMask (this seat is driven by the deterministic bot brain on every peer: empty seat, AFK, left,
// desynced, or still joining), then 4 bytes per seat. The 4-byte input word (netcode.md 6.3):
//   [0] mx int8 x127   [1] mz int8 x127   [2] flags: 1 ability, 2 abilityHeld, 4 dash, 8 ultimate
//   [3] card byte: 0 = none, 1..4 = pick card N of the current offer, 0x80 = reroll (CARD RAIL, B-TITAN)

import type { TitanInput } from '../core/types.ts';

/** Wire protocol version. Bump on ANY incompatible change; the room layer only groups identical versions. */
export const NET_PROTO = 1;
export const SEATS = 4;
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
export const INPUT_BYTES = 4;
export const FRAME_BYTES = 2 + SEATS * INPUT_BYTES;
/** state-hash cadence in ticks (netcode.md 7.1: "every 30 ticks") */
export const HASH_EVERY = 30;
/** a guest silent for this long is AFK: the bot drives its seat until inputs resume (netcode.md 7.1: 3 s) */
export const AFK_MS = 3000;
/** a guest silent for this long has left: the seat goes to the bot for good */
export const LEFT_MS = 10000;
/** no packet from the authority for this long -> elect a new one (netcode.md 7.2 "clock watchdog: 1 s") */
export const HOST_TIMEOUT_MS = 1200;
/** the new authority waits at most this long for every survivor's HAVE before resuming the clock */
export const MIGRATE_WAIT_MS = 700;
/** taking over a bot seat by replay join is allowed while tick < this (ONLINE_PLAN.md 2: 3:00) */
export const JOIN_CUTOFF_TICK = 180 * TICK_HZ;
/** inputs carried per INPUT packet (loss cover) */
export const INPUT_REDUNDANCY = 6;
/** most frames per FRAME packet; a guest further behind gets a reliable LOG resend instead */
export const FRAME_BATCH = 10;
/** frames per LOG chunk (18 B each -> ~18 KB, far under the DataChannel message limit) */
export const LOG_CHUNK = 1000;
/** the authority never produces more than this many ticks in one pump (a long tab stall catches up over pumps) */
export const MAX_CATCHUP = 15;
export const LEAD_MIN = 1;
export const LEAD_MAX = 20;
export const LEAD_START = 4;

export const PK = { INPUT: 1, FRAME: 2, HASH: 3, LOG: 4, CTL: 5 } as const;
export const CARD = { NONE: 0, REROLL: 0x80 } as const;

// ─────────────────────────────── input word ───────────────────────────────

function q127(v: number): number {
  const c = v > 1 ? 1 : v < -1 ? -1 : v;
  return Math.round(c * 127) & 0xff;
}
function s127(b: number): number { return (b > 127 ? b - 256 : b) / 127; }

/** TitanInput (+ card byte) -> 4 bytes at out[o..o+3]. The local sim must step the DECODED word, never the raw
 *  float input (netcode.md 6.3: quantisation changes the run from tick 0). */
export function encodeInput(inp: TitanInput, out: Uint8Array, o = 0, card = 0): void {
  out[o] = q127(inp.mx);
  out[o + 1] = q127(inp.mz);
  out[o + 2] = (inp.ability ? 1 : 0) | (inp.abilityHeld ? 2 : 0) | (inp.dash ? 4 : 0) | (inp.ultimate ? 8 : 0);
  out[o + 3] = card & 0xff;
}

export function decodeInput(b: Uint8Array, o = 0): TitanInput {
  const f = b[o + 2];
  return { mx: s127(b[o]), mz: s127(b[o + 1]), ability: !!(f & 1), abilityHeld: !!(f & 2), dash: !!(f & 4), ultimate: !!(f & 8) };
}

export function cardOf(b: Uint8Array, o = 0): number { return b[o + 3]; }

// ─────────────────────────────── frames ───────────────────────────────

/** One confirmed lockstep frame (the canonical input of one tick, identical on every peer). */
export interface Frame {
  tick: number;
  lateMask: number;
  botMask: number;
  /** SEATS x INPUT_BYTES */
  inputs: Uint8Array;
}

export function writeFrame(f: Frame, out: Uint8Array, o: number): void {
  out[o] = f.lateMask & 0xff;
  out[o + 1] = f.botMask & 0xff;
  out.set(f.inputs.subarray(0, SEATS * INPUT_BYTES), o + 2);
}

export function readFrame(tick: number, b: Uint8Array, o: number): Frame {
  return { tick, lateMask: b[o], botMask: b[o + 1], inputs: b.slice(o + 2, o + FRAME_BYTES) };
}

/** Rolling FNV-1a over the canonical frame bytes: equal log hashes = the peers stepped the same inputs. */
export function foldFrame(h: number, f: Frame): number {
  let x = h >>> 0;
  x = Math.imul(x ^ (f.tick & 0xff), 0x01000193) >>> 0;
  x = Math.imul(x ^ ((f.tick >>> 8) & 0xff), 0x01000193) >>> 0;
  x = Math.imul(x ^ f.lateMask, 0x01000193) >>> 0;
  x = Math.imul(x ^ f.botMask, 0x01000193) >>> 0;
  for (let i = 0; i < f.inputs.length; i++) x = Math.imul(x ^ f.inputs[i], 0x01000193) >>> 0;
  return x;
}
export const FNV_SEED = 0x811c9dc5;

// ─────────────────────────────── packets ───────────────────────────────
// Little-endian DataView codecs. Every decoder validates the length and returns null on malformed input.

export interface InputPkt { epoch: number; seat: number; lead: number; ping: number; ack: number; first: number; inputs: Uint8Array /* n x 4 */ }
export interface FramePkt { epoch: number; echo: number; hold: number; authTick: number; slack: number[]; frames: Frame[] }
export interface HashPkt { seat: number; tick: number; world: number; log: number }
export interface LogPkt { epoch: number; frames: Frame[] }

const IN_HDR = 1 + 1 + 1 + 1 + 2 + 4 + 4 + 1;          // 15
export function encodeInputPkt(p: InputPkt): Uint8Array {
  const n = (p.inputs.length / INPUT_BYTES) | 0;
  const b = new Uint8Array(IN_HDR + n * INPUT_BYTES);
  const v = new DataView(b.buffer);
  b[0] = PK.INPUT; b[1] = p.epoch & 0xff; b[2] = p.seat & 0xff; b[3] = p.lead & 0xff;
  v.setUint16(4, p.ping & 0xffff, true); v.setUint32(6, p.ack >>> 0, true); v.setUint32(10, p.first >>> 0, true);
  b[14] = n; b.set(p.inputs.subarray(0, n * INPUT_BYTES), IN_HDR);
  return b;
}
export function decodeInputPkt(b: Uint8Array): InputPkt | null {
  if (b.length < IN_HDR || b[0] !== PK.INPUT) return null;
  const n = b[14];
  if (b.length !== IN_HDR + n * INPUT_BYTES || b[2] >= SEATS) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { epoch: b[1], seat: b[2], lead: b[3], ping: v.getUint16(4, true), ack: v.getUint32(6, true), first: v.getUint32(10, true),
    inputs: b.slice(IN_HDR) };
}

const FR_HDR = 1 + 1 + 2 + 2 + 4 + SEATS + 4 + 1;    // 19
export function encodeFramePkt(p: FramePkt): Uint8Array {
  const n = p.frames.length;
  const b = new Uint8Array(FR_HDR + n * FRAME_BYTES);
  const v = new DataView(b.buffer);
  b[0] = PK.FRAME; b[1] = p.epoch & 0xff;
  v.setUint16(2, p.echo & 0xffff, true); v.setUint16(4, Math.min(0xffff, Math.max(0, Math.round(p.hold))), true);
  v.setUint32(6, p.authTick >>> 0, true);
  for (let i = 0; i < SEATS; i++) v.setInt8(10 + i, Math.max(-128, Math.min(127, p.slack[i] | 0)));
  v.setUint32(10 + SEATS, n ? p.frames[0].tick >>> 0 : 0, true);
  b[14 + SEATS] = n;
  for (let i = 0; i < n; i++) writeFrame(p.frames[i], b, FR_HDR + i * FRAME_BYTES);
  return b;
}
export function decodeFramePkt(b: Uint8Array): FramePkt | null {
  if (b.length < FR_HDR || b[0] !== PK.FRAME) return null;
  const n = b[14 + SEATS];
  if (b.length !== FR_HDR + n * FRAME_BYTES) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const slack: number[] = [];
  for (let i = 0; i < SEATS; i++) slack.push(v.getInt8(10 + i));
  const first = v.getUint32(10 + SEATS, true);
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) frames.push(readFrame(first + i, b, FR_HDR + i * FRAME_BYTES));
  return { epoch: b[1], echo: v.getUint16(2, true), hold: v.getUint16(4, true), authTick: v.getUint32(6, true), slack, frames };
}

export function encodeHashPkt(p: HashPkt): Uint8Array {
  const b = new Uint8Array(14);
  const v = new DataView(b.buffer);
  b[0] = PK.HASH; b[1] = p.seat & 0xff;
  v.setUint32(2, p.tick >>> 0, true); v.setUint32(6, p.world >>> 0, true); v.setUint32(10, p.log >>> 0, true);
  return b;
}
export function decodeHashPkt(b: Uint8Array): HashPkt | null {
  if (b.length !== 14 || b[0] !== PK.HASH) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { seat: b[1], tick: v.getUint32(2, true), world: v.getUint32(6, true), log: v.getUint32(10, true) };
}

const LOG_HDR = 1 + 1 + 4 + 2;                         // 8
export function encodeLogPkt(epoch: number, frames: readonly Frame[]): Uint8Array {
  const n = frames.length;
  const b = new Uint8Array(LOG_HDR + n * FRAME_BYTES);
  const v = new DataView(b.buffer);
  b[0] = PK.LOG; b[1] = epoch & 0xff;
  v.setUint32(2, n ? frames[0].tick >>> 0 : 0, true); v.setUint16(6, n, true);
  for (let i = 0; i < n; i++) writeFrame(frames[i], b, LOG_HDR + i * FRAME_BYTES);
  return b;
}
export function decodeLogPkt(b: Uint8Array): LogPkt | null {
  if (b.length < LOG_HDR || b[0] !== PK.LOG) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const first = v.getUint32(2, true), n = v.getUint16(6, true);
  if (b.length !== LOG_HDR + n * FRAME_BYTES) return null;
  const frames: Frame[] = [];
  for (let i = 0; i < n; i++) frames.push(readFrame(first + i, b, LOG_HDR + i * FRAME_BYTES));
  return { epoch: b[1], frames };
}

const TE = new TextEncoder();
const TD = new TextDecoder();
export function encodeCtl(msg: { t: string; [k: string]: unknown }): Uint8Array {
  const body = TE.encode(JSON.stringify(msg));
  const b = new Uint8Array(1 + body.length);
  b[0] = PK.CTL; b.set(body, 1);
  return b;
}
export function decodeCtl(b: Uint8Array): { t: string; [k: string]: unknown } | null {
  if (b.length < 3 || b[0] !== PK.CTL) return null;
  try {
    const m = JSON.parse(TD.decode(b.subarray(1)));
    return m && typeof m === 'object' && typeof m.t === 'string' ? m : null;
  } catch { return null; }
}

// ─────────────────────────────── match start ───────────────────────────────

export type SeatKind = 'human' | 'bot';
export interface SeatInfo {
  slot: number;
  kind: SeatKind;
  /** room peer id of the human in this seat (null = bot) */
  peer: string | null;
  name: string;
  /** titan id (multi-titan world; the current 1-titan world uses seat 0's) */
  titan: string;
  /** bot difficulty for bot seats (vs_design: 3 levels) */
  botLevel?: number;
}

/** START (reliable, sent once over the room channel): everything every peer needs to build the same world. */
export interface StartInfo {
  proto: number;
  build: string;
  matchId: string;
  seed: number;
  biome: string;
  mode: 'vs' | 'coop1';
  seats: SeatInfo[];
  /** last tick of the match (10:45 at 30 Hz = 19,350) */
  endTick: number;
  lead: number;
}

/** Deterministic id order: the lexically lowest live human id is the authority (slot 0 at start). */
export function lowestId(ids: Iterable<string>): string | null {
  let best: string | null = null;
  for (const id of ids) if (best === null || id < best) best = id;
  return best;
}
