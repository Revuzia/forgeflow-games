// lobby.mjs - the Node half of p23/lobby.py (parity P2-F port of F:/lc_p1/P1-D/phantom.mjs + P1-D's forgery cases). NO browser, NO file edited.
//
//   node lobby.mjs --root <game dir> [--plant presence-blind|forgery-open|ping-merged] --out res.json
//
// Imports <root>/runtime/3d/royale/net.js (its pure exports: SquadHandshake, senderMay, PingOutbox, pingTeamOk, normPing) and
// <root>/runtime/sim/royale.js (for the damage cap) and measures:
//   phantom       two peers hello + appear in presence, one closes the tab (leaves presence) before START: the roster gives it no slot
//   grace         a peer heard (hello) but not yet in presence gets a slot within PRESENCE_GRACE_MS, none after it
//   forgeries     P1-D's forged messages from a guest (slot 1): state / fire for the host's slot, hitYou credited to the host's bot or over
//                 the weapon's biggest hit, died / bye / takeover for another slot, a message from a peer outside the match -> each refused
//   legit         the same guest's own state / fire / hitYou (a real AR hit) / died / bye, the host's takeover -> each allowed
//   ping-streams  a world ping and a map pin in the same second both go out; a second pin within 1 s is held (not dropped) and due at 1 s
//   ping-team     a ping is shown only to the same non-empty team
//   ping-norm     a ping body with a bad kind / non-finite / out-of-map coordinate is dropped
// A module without the export is reported as such ("missing") - the frozen pre-P1 build has neither onPresence nor senderMay.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root);
const PLANT = args.plant || null;
const require = createRequire(import.meta.url);

const out = { root: ROOT, plant: PLANT, missing: [] };
const M = await import(pathToFileURL(path.join(ROOT, "runtime", "3d", "royale", "net.js")).href + "?t=" + Date.now());
let K = null;
try { const f = path.join(ROOT, "runtime", "sim", "royale.js"); globalThis.FFG = undefined; const m = require(f); K = m && m.WEAPONS ? m : globalThis.FFG.sim.Royale; } catch (e) { out.simError = String(e); }

// planted faults at the contract surface
if (PLANT === "presence-blind" && M.SquadHandshake) M.SquadHandshake.prototype.isPresent = function () { return true; };
const senderMay = PLANT === "forgery-open" ? (() => null) : M.senderMay;
const PingOutbox = M.PingOutbox;

// phantom (P1-D phantom.mjs, unchanged scenario)
if (!M.SquadHandshake) out.missing.push("SquadHandshake");
else {
  const host = new M.SquadHandshake({ id: "a_host", name: "Host", gv: 3, host: true });
  const peers = {};
  for (const [id, nm] of [["b_alice", "Alice"], ["c_bob", "Bob"]]) { host.onHello(id, { name: nm, gv: 3, host: 0 }, 1000); peers[id] = nm; }
  const hasPresence = typeof host.onPresence === "function";
  if (!hasPresence) out.missing.push("SquadHandshake.onPresence");
  if (hasPresence) host.onPresence(["a_host", "b_alice", "c_bob"]);
  if (hasPresence) host.onPresence(["a_host", "b_alice"]);
  const plan = host.planStart(peers, 3, 9000);
  out.phantom = { presenceAware: hasPresence, roster: plan.roster.map((r) => r.peerId), phantomSlot: plan.roster.some((r) => r.peerId === "c_bob") };
  // grace: never-present hello'd peer
  const h2 = new M.SquadHandshake({ id: "a_host", name: "Host", gv: 3, host: true });
  if (hasPresence) h2.onPresence(["a_host"]);
  h2.onHello("d_dan", { name: "Dan", gv: 3, host: 0 }, 1000);
  const grace = M.PRESENCE_GRACE_MS || 3000;
  const early = h2.planStart({ d_dan: "Dan" }, 3, 1000 + grace - 500).roster.some((r) => r.peerId === "d_dan");
  const late = h2.planStart({ d_dan: "Dan" }, 3, 1000 + grace + 500).roster.some((r) => r.peerId === "d_dan");
  out.grace = { graceMs: grace, slotWithinGrace: early, slotAfterGrace: late };
}

// forgeries + legit (P1-D p1d_squad light cases, applied to the pure authorizer)
if (typeof M.senderMay !== "function") out.missing.push("senderMay");
else {
  const roster = [{ peerId: "a_host", slot: 0 }, { peerId: "b_guest", slot: 1 }, { peerId: "c_guest2", slot: 2 }];
  const actors = { s0: { isBot: false }, s1: { isBot: false }, s2: { isBot: false }, s7: { isBot: true }, s8: { isBot: true } };
  const ctxHost = { roster, isHost: true, actor: (id) => actors[id] || null, K, selfId: "s0" };      // the HOST receiving
  const ctxGuest = { roster, isHost: false, actor: (id) => actors[id] || null, K, selfId: "s2" };    // a GUEST receiving
  const arMax = typeof M.maxHitDamage === "function" && K ? M.maxHitDamage(K, "ar") : null;
  const forged = [
    ["state for the host's slot", "state", { id: "s0" }, "b_guest", ctxHost],
    ["fire for the host's slot", "fire", { id: "s0" }, "b_guest", ctxHost],
    ["hitYou credited to a host bot", "hitYou", { attacker: "s7", dmg: 37, weapon: "ar" }, "b_guest", ctxHost],
    ["hitYou over the weapon's biggest hit", "hitYou", { attacker: "s1", dmg: 500, weapon: "ar" }, "b_guest", ctxHost],
    ["died for a host bot", "died", { slot: "s7" }, "b_guest", ctxHost],
    ["bye for another slot", "bye", { slot: "s2" }, "b_guest", ctxHost],
    ["takeover from a guest", "takeover", { slot: "s2" }, "b_guest", ctxGuest],
    ["a peer outside the match", "state", { id: "s9" }, "z_stranger", ctxHost],
  ];
  const legit = [
    ["own state", "state", { id: "s1" }, "b_guest", ctxHost],
    ["own fire", "fire", { id: "s1" }, "b_guest", ctxHost],
    ["own hitYou (a real AR body hit)", "hitYou", { attacker: "s1", dmg: 20, weapon: "ar" }, "b_guest", ctxHost],
    ["own died", "died", { slot: "s1" }, "b_guest", ctxHost],
    ["own bye", "bye", { slot: "s1" }, "b_guest", ctxHost],
    ["host takeover to a guest", "takeover", { slot: "s1" }, "a_host", ctxGuest],
    ["host speaks for its bot", "fire", { id: "s7" }, "a_host", ctxGuest],
  ];
  out.forgeries = forged.map(([n, t, d, from, ctx]) => ({ n, refused: senderMay(t, d, from, ctx) }));
  out.legit = legit.map(([n, t, d, from, ctx]) => ({ n, refused: senderMay(t, d, from, ctx) }));
  out.arMaxHit = arMax;
}

// pings (P1-D-fix ffe96307: separate pin / ping streams, coalesced pins)
if (typeof PingOutbox !== "function") out.missing.push("PingOutbox");
else {
  const ob = new PingOutbox(1000);
  if (PLANT === "ping-merged") { const o = ob.offer.bind(ob); ob.offer = (stream, body, now, co) => o("one", body, now, co); }
  const a = ob.offer("s1:w", { k: "enemy", x: 1, y: 0, z: 1 }, 1000, false);
  const b = ob.offer("s1:m", { k: "pin", x: 5, y: 0, z: 5 }, 1100, true);
  const c = ob.offer("s1:m", { k: "pin", x: 9, y: 0, z: 9 }, 1300, true);
  const dueEarly = ob.due(1900).length;
  const dueAt = ob.due(2150);
  out.pings = { worldSent: !!a.now, pinSent: !!b.now, secondPinHeld: !c.now && c.wait != null && c.wait > 0, dueEarly,
                dueAt1s: dueAt.map(([s, body]) => [s, body && body.x]) };
}
if (typeof M.pingTeamOk === "function") out.pingTeam = { same: M.pingTeamOk("t1", "t1"), other: M.pingTeamOk("t1", "t2"), empty: M.pingTeamOk("", "") };
else out.missing.push("pingTeamOk");
if (typeof M.normPing === "function") out.pingNorm = { badKind: M.normPing({ k: "nuke", x: 0, y: 0, z: 0 }), nan: M.normPing({ k: "go", x: NaN, y: 0, z: 0 }),
  far: M.normPing({ k: "go", x: 99999, y: 0, z: 0 }, 800), good: M.normPing({ k: "go", x: 10.04, y: 2, z: -3 }, 800) };
else out.missing.push("normPing");

fs.writeFileSync(args.out, JSON.stringify(out, null, 1));
console.log("lobby.mjs:", JSON.stringify({ missing: out.missing, phantom: out.phantom, grace: out.grace }));
