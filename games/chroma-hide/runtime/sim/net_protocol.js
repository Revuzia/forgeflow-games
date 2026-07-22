/**
 * CHROMA HIDE — runtime/sim/net_protocol.js
 * PURE serialization for the online protocol (no three, no NetPlay) so the wire
 * format is node-testable. Snapshots (actor transforms + phase) and paint strokes
 * are quantized to keep messages small at 10 Hz; roster assignment maps connected
 * peers + fill bots onto slots with roles. chromanet.js does only transport glue.
 */
import { assignRoles, ROLE, POSE_IDS } from "./match_core.js";
import { makeRng } from "./util.js";

// message types on the wire
export const MSG = Object.freeze({
  HELLO: "hello", LOBBY: "lobby", START: "start", INPUT: "in",
  SNAP: "snap", PAINT: "pnt", SHOT: "shot", EVENT: "ev", CHAT: "chat",
});

// The wire pose index keys off the canonical list, so all 8 poses survive the
// round trip. The old 4-entry literal collapsed flat/curl/stretch/lean/wide to
// "stand" -- a clinging, flattened player looked upright to every remote client.
const POSES = POSE_IDS;
const POSE_CODE = (p) => Math.max(0, POSES.indexOf(p));
const CODE_POSE = (c) => POSES[c] || "stand";

// yaw [-π,π] -> byte 0..255 and back (≈1.4° resolution — fine for a body)
export function yawToByte(y) { let t = (y / (Math.PI * 2)) + 0.5; t -= Math.floor(t); return Math.round(t * 255) & 255; }
export function byteToYaw(b) { return ((b / 255) - 0.5) * Math.PI * 2; }

const Q = 100; // position: centimetre resolution

/** Pack one actor to a compact fixed array (index-addressed). */
export function packActor(a, idx) {
  const flags = (a.alive ? 1 : 0) | (a.caught ? 2 : 0) | (a.fleeing ? 4 : 0) | (a.hidden ? 8 : 0) | (a.role === ROLE.SEEKER ? 16 : 0);
  return [idx, Math.round(a.x * Q), Math.round(a.z * Q), yawToByte(a.yaw), POSE_CODE(a.pose), flags, a.ammo | 0, Math.round(a.score) | 0,
    Math.round((a._elev || 0) * Q)];   // cling height: without it a clinging player renders on the floor for everyone else
}
export function unpackActor(arr) {
  const [idx, x, z, yb, pose, flags, ammo, score, elev] = arr;
  return { idx, x: x / Q, z: z / Q, yaw: byteToYaw(yb), pose: CODE_POSE(pose),
    alive: !!(flags & 1), caught: !!(flags & 2), fleeing: !!(flags & 4), hidden: !!(flags & 8),
    role: (flags & 16) ? ROLE.SEEKER : ROLE.HIDER, ammo, score, _elev: (elev || 0) / Q };
}

/** Full authoritative snapshot the host broadcasts each tick. */
export function packSnapshot(state) {
  return { p: phaseCode(state.phase), t: Math.round(state.timeLeft * 10), a: state.actors.map((a, i) => packActor(a, i)) };
}
export function unpackSnapshot(msg) {
  return { phase: codePhase(msg.p), timeLeft: msg.t / 10, actors: msg.a.map(unpackActor) };
}
const PHASES = ["lobby", "role_assign", "prep", "hunt", "answer_check", "results"];
const phaseCode = (p) => Math.max(0, PHASES.indexOf(p));
const codePhase = (c) => PHASES[c] || "prep";

/** Paint strokes: [u12,v12,size,r,g,b,metal8,rough8]. u/v in 1/4096ths. */
export function packStroke(s) {
  // `hard` is the dab's falloff and it is what separates a spray from a marker. Dropping it
  // from the wire meant a remote client re-rendered every stroke at the default brush
  // hardness -- the disguise other players saw was not the one the painter made.
  return [Math.round(s.u * 4095), Math.round(s.v * 4095), Math.round(s.size), s.r | 0, s.g | 0, s.b | 0,
    Math.round((s.metal ?? 0) * 255), Math.round((s.rough ?? 0.8) * 255), Math.round((s.hard ?? 0.6) * 255)];
}
export function unpackStroke(a) {
  return { u: a[0] / 4095, v: a[1] / 4095, size: a[2], r: a[3], g: a[4], b: a[5], metal: a[6] / 255, rough: a[7] / 255,
    hard: a[8] != null ? a[8] / 255 : 0.6 };
}
export function packStrokes(list) { return list.map(packStroke); }
export function unpackStrokes(list) { return list.map(unpackStroke); }

/**
 * Build the match roster from connected human peer ids + fill bots up to
 * lobbySize, assigning roles. Host computes this and broadcasts it so every
 * client builds the identical world. Returns { players:[{id,isBot,role,name}], seed }.
 */
export function buildRoster(peerIds, lobbySize, seekerCount, seed, localPeerId) {
  const rng = makeRng(seed >>> 0);
  const humans = peerIds.slice(0, lobbySize);
  const nBots = Math.max(0, lobbySize - humans.length);
  const botNames = ["Vex", "Rune", "Mica", "Pip", "Sol", "Wisp", "Bram", "Kite", "Fen", "Ivo"];
  const slots = humans.map((id) => ({ id, isBot: false }))
    .concat(Array.from({ length: nBots }, (_, i) => ({ id: "bot" + i, isBot: true, name: botNames[i % botNames.length] })));
  const roleInfo = assignRoles(slots.map((s) => s.id), seekerCount, [], rng);
  const players = slots.map((s) => ({ id: s.id, isBot: s.isBot, role: roleInfo.roles[s.id], name: s.name, isLocal: s.id === localPeerId }));
  return { players, seed };
}

/**
 * Who is allowed to say what. PURE, so it is node-testable and so the transport and the
 * loopback double cannot drift apart on it.
 *
 * The host owns world state; a guest owns only its own intent. Without this every peer
 * could broadcast a forged `win`, `caught` or `phase` EVENT and each client would apply
 * it without question, and a guest could push snapshots that overwrite the authoritative
 * simulation.
 *
 * Returns true when the message should be processed.
 */
export function authorizeMsg(type, from, { isHost, hostId }) {
  switch (type) {
    // world state: the host's word only
    case MSG.SNAP:
    case MSG.EVENT:
      return hostId != null && from === hostId;
    // intent: only the host acts on it
    case MSG.INPUT:
    case MSG.SHOT:
      return !!isHost;
    // lobby handshake, paint streams and chat are peer-to-peer by design
    case MSG.LOBBY:
    case MSG.START:
    case MSG.PAINT:
    case MSG.CHAT:
      return true;
    default:
      return false;
  }
}
