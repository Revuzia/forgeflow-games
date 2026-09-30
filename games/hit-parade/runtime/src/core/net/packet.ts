// HIT PARADE - core/net/packet.ts (lane NET). Binary wire formats, identical on every transport.
// THREE-free, DOM-free, clock-free. Layout = _research/NETCODE.md 3.2 (binding), little-endian.
//
// INPUT (type 0x01)
//   off size field
//   0   u8   type = 0x01
//   1   u8   flags: b0 relay, b1 has-checksum, b2 pause-request (away), b3 i-am-stalled,
//                   b4-b7 match epoch (matchIndex & 15; extension of 3.2 - stale packets of the previous
//                   match on the same transport are dropped)
//   2   u16  seq              packet counter (loss / reorder stats)
//   4   u32  startFrame       sim frame of the first input word below
//   8   u32  ackFrame         highest remote input frame received contiguously (0xffffffff = none)
//   12  i8   frameAdvantage   local frame - estimated remote frame (time sync, clamped +-127)
//   13  u8   count N          1..32 input words
//   14  u16  tsLow            sender ms clock & 0xffff        } continuous RTT:
//   16  u16  echoTs           last tsLow received from peer   } rtt = now - echoTs - echoHold
//   18  u16  echoHold         ms between receiving echoTs and sending (0xffff = no echo yet)
//   [20 u32 csFrame, 24 u32 checksum]  only when flags.b1
//   then N x u16 input words (frames startFrame .. startFrame+N-1)
//
// Control packets (reliable `ctl` channel on RTC; a binary broadcast on the relay):
//   SYNC_PING 0x10 / SYNC_PONG 0x11: u8 type, u8 seq, u16 0, f64 t (sender clock ms)      = 12 B
//   SNAPSHOT  0x20: u8 type, u8 0, u8 epoch, u8 0, u32 frame, u32 checksum, u32 nInts, nInts x i32 = 16 + 4n B
//   DESYNC    0x21: u8 type, u8 0, u8 epoch, u8 0, u32 frame (request a host snapshot)               = 8 B
//   DELAY     0x22: u8 type, u8 delay, u8 epoch, u8 0, u32 atFrame (host-authoritative D change)     = 8 B
//   RECOVERED 0x23: u8 type, u8 0, u8 epoch, u8 0, u32 frame (guest loaded the snapshot; its frame now) = 8 B

export const PKT = {
  INPUT: 0x01,
  SYNC_PING: 0x10,
  SYNC_PONG: 0x11,
  SNAPSHOT: 0x20,
  DESYNC: 0x21,
  DELAY: 0x22,
  RECOVERED: 0x23,
} as const;

export const FLAG = {
  RELAY: 1,
  CHECKSUM: 2,
  AWAY: 4,
  STALLED: 8,
  EPOCH_SHIFT: 4,
} as const;

/** Match epoch carried in flags b4-b7 (INPUT) and byte 2 (control packets). */
export function flagsEpoch(flags: number): number { return (flags >>> FLAG.EPOCH_SHIFT) & 15; }
/** Epoch byte of a control packet (SNAPSHOT / DESYNC / DELAY / RECOVERED). */
export function ctlEpoch(b: Uint8Array): number { return b.length > 2 ? b[2] & 15 : 0; }

export const MAX_INPUTS = 32;
export const INPUT_HEADER = 20;
export const NONE_U32 = 0xffffffff;
export const NO_ECHO = 0xffff;

/** Decoded INPUT packet (reused by the decoder; copy what you keep). */
export interface InputPacket {
  flags: number;
  seq: number;
  startFrame: number;      // int (-1 never occurs: start >= 0)
  ackFrame: number;        // int, -1 = none
  advantage: number;       // signed
  count: number;
  tsLow: number;
  echoTs: number;
  echoHold: number;
  csFrame: number;         // -1 when absent
  checksum: number;        // u32 as signed int32 (compare with | 0)
  inputs: Uint16Array;     // length >= count; only [0, count) valid
}

export function newInputPacket(): InputPacket {
  return {
    flags: 0, seq: 0, startFrame: 0, ackFrame: -1, advantage: 0, count: 0,
    tsLow: 0, echoTs: 0, echoHold: NO_ECHO, csFrame: -1, checksum: 0, inputs: new Uint16Array(MAX_INPUTS),
  };
}

/** Byte length of an INPUT packet with `count` words. */
export function inputPacketBytes(count: number, hasChecksum: boolean): number {
  return INPUT_HEADER + (hasChecksum ? 8 : 0) + 2 * count;
}

/**
 * Encode an INPUT packet. `words` is read from `words[(first + k) & mask]` for k in [0, count) so the
 * caller can hand its ring buffer directly (mask = ring length - 1, ring length a power of two).
 */
export function encodeInput(
  p: { flags: number; seq: number; startFrame: number; ackFrame: number; advantage: number; tsLow: number;
       echoTs: number; echoHold: number; csFrame: number; checksum: number },
  words: ArrayLike<number>, first: number, count: number, mask: number,
): Uint8Array {
  if (count < 1 || count > MAX_INPUTS) throw new RangeError('input count ' + count);
  const hasCs = (p.flags & FLAG.CHECKSUM) !== 0;
  const buf = new Uint8Array(inputPacketBytes(count, hasCs));
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, PKT.INPUT);
  dv.setUint8(1, p.flags & 0xff);
  dv.setUint16(2, p.seq & 0xffff, true);
  dv.setUint32(4, p.startFrame >>> 0, true);
  dv.setUint32(8, p.ackFrame < 0 ? NONE_U32 : p.ackFrame >>> 0, true);
  const adv = p.advantage > 127 ? 127 : p.advantage < -127 ? -127 : p.advantage | 0;
  dv.setInt8(12, adv);
  dv.setUint8(13, count);
  dv.setUint16(14, p.tsLow & 0xffff, true);
  dv.setUint16(16, p.echoTs & 0xffff, true);
  dv.setUint16(18, p.echoHold & 0xffff, true);
  let off = INPUT_HEADER;
  if (hasCs) {
    dv.setUint32(off, p.csFrame >>> 0, true);
    dv.setUint32(off + 4, p.checksum >>> 0, true);
    off += 8;
  }
  for (let k = 0; k < count; k++) {
    dv.setUint16(off, words[(first + k) & mask] & 0xffff, true);
    off += 2;
  }
  return buf;
}

/**
 * Decode + validate an INPUT packet into `out`. Returns false (and leaves `out` unspecified) when the
 * packet is malformed: wrong type, length != 20 + 8*b1 + 2N, N outside 1..32, or frame fields that
 * overflow int32. The frame-window check (startFrame + N - 1 <= localFrame + D + W + 32) needs session
 * state and lives in the session.
 */
export function decodeInput(b: Uint8Array, out: InputPacket): boolean {
  if (b.length < INPUT_HEADER) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint8(0) !== PKT.INPUT) return false;
  const flags = dv.getUint8(1);
  const count = dv.getUint8(13);
  const hasCs = (flags & FLAG.CHECKSUM) !== 0;
  if (count < 1 || count > MAX_INPUTS) return false;
  if (b.length !== inputPacketBytes(count, hasCs)) return false;
  const start = dv.getUint32(4, true);
  const ack = dv.getUint32(8, true);
  if (start > 0x7fffff00) return false;
  if (ack !== NONE_U32 && ack > 0x7fffff00) return false;
  out.flags = flags;
  out.seq = dv.getUint16(2, true);
  out.startFrame = start;
  out.ackFrame = ack === NONE_U32 ? -1 : ack;
  out.advantage = dv.getInt8(12);
  out.count = count;
  out.tsLow = dv.getUint16(14, true);
  out.echoTs = dv.getUint16(16, true);
  out.echoHold = dv.getUint16(18, true);
  let off = INPUT_HEADER;
  if (hasCs) {
    const csf = dv.getUint32(off, true);
    if (csf > 0x7fffff00) return false;
    out.csFrame = csf;
    out.checksum = dv.getUint32(off + 4, true) | 0;
    off += 8;
  } else {
    out.csFrame = -1;
    out.checksum = 0;
  }
  for (let k = 0; k < count; k++) {
    out.inputs[k] = dv.getUint16(off, true);
    off += 2;
  }
  return true;
}

/** Packet type byte, or -1 for an empty buffer. */
export function packetType(b: Uint8Array): number {
  return b.length > 0 ? b[0] : -1;
}

// ---- control packets -------------------------------------------------------------------------------

export function encodeSync(type: typeof PKT.SYNC_PING | typeof PKT.SYNC_PONG, seq: number, t: number): Uint8Array {
  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, type);
  dv.setUint8(1, seq & 0xff);
  dv.setFloat64(4, t, true);
  return buf;
}

export function decodeSync(b: Uint8Array): { type: number; seq: number; t: number } | null {
  if (b.length !== 12) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = dv.getUint8(0);
  if (type !== PKT.SYNC_PING && type !== PKT.SYNC_PONG) return null;
  return { type, seq: dv.getUint8(1), t: dv.getFloat64(4, true) };
}

export function encodeSnapshot(frame: number, checksum: number, state: Int32Array, epoch = 0): Uint8Array {
  const n = state.length;
  const buf = new Uint8Array(16 + 4 * n);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, PKT.SNAPSHOT);
  dv.setUint8(2, epoch & 15);
  dv.setUint32(4, frame >>> 0, true);
  dv.setUint32(8, checksum >>> 0, true);
  dv.setUint32(12, n, true);
  for (let i = 0; i < n; i++) dv.setInt32(16 + 4 * i, state[i], true);
  return buf;
}

export function decodeSnapshot(b: Uint8Array, expectInts: number): { frame: number; checksum: number; state: Int32Array } | null {
  if (b.length < 16) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint8(0) !== PKT.SNAPSHOT) return null;
  const n = dv.getUint32(12, true);
  if (n !== expectInts || b.length !== 16 + 4 * n) return null;
  const frame = dv.getUint32(4, true);
  if (frame > 0x7fffff00) return null;
  const state = new Int32Array(n);
  for (let i = 0; i < n; i++) state[i] = dv.getInt32(16 + 4 * i, true);
  return { frame, checksum: dv.getUint32(8, true) | 0, state };
}

export function encodeFrameMsg(type: typeof PKT.DESYNC | typeof PKT.DELAY | typeof PKT.RECOVERED, frame: number, arg = 0, epoch = 0): Uint8Array {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint8(0, type);
  dv.setUint8(1, arg & 0xff);
  dv.setUint8(2, epoch & 15);
  dv.setUint32(4, frame >>> 0, true);
  return buf;
}

export function decodeFrameMsg(b: Uint8Array): { type: number; arg: number; frame: number } | null {
  if (b.length !== 8) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const type = dv.getUint8(0);
  if (type !== PKT.DESYNC && type !== PKT.DELAY && type !== PKT.RECOVERED) return null;
  const frame = dv.getUint32(4, true);
  if (frame > 0x7fffff00) return null;
  return { type, arg: dv.getUint8(1), frame };
}
