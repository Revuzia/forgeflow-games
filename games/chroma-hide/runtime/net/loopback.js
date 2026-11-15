/**
 * CHROMA HIDE — runtime/net/loopback.js
 * An in-process test double for the ChromaNet API. A LoopbackHub wires N
 * endpoints together and delivers messages synchronously (broadcast, self:false),
 * running the SAME net_protocol pack/unpack as the real transport. This lets the
 * host/guest sync logic be verified headlessly — without Supabase — so only the
 * (identical, already-proven) NetPlay socket layer is left to a live 2-tab test.
 * Not shipped in the play path; imported only by verification.
 */
import * as P from "../sim/net_protocol.js";

export class LoopbackHub {
  constructor() { this.endpoints = []; }
  endpoint(id, isHost) { const ep = new LoopbackNet(this, id, isHost); this.endpoints.push(ep); return ep; }
  _deliver(fromId, t, d) { for (const ep of this.endpoints) if (ep.id !== fromId) ep._recv(fromId, t, d); }
}

class LoopbackNet {
  constructor(hub, id, isHost) { this.hub = hub; this.id = id; this._isHost = isHost; this.handlers = {}; this.pendingInput = new Map(); }
  myId() { return this.id; }
  isHost() { return this._isHost; }
  on(e, cb) { (this.handlers[e] = this.handlers[e] || []).push(cb); return this; }
  _emit(e, p) { (this.handlers[e] || []).forEach((cb) => { try { cb(p); } catch (err) {} }); }
  takeInput(pid) { return this.pendingInput.get(pid) || null; }

  sendInput(i) { this.hub._deliver(this.id, P.MSG.INPUT, i); }
  sendSnapshot(state) { this.hub._deliver(this.id, P.MSG.SNAP, P.packSnapshot(state)); }
  sendStrokes(id, strokes) { this.hub._deliver(this.id, P.MSG.PAINT, { id, s: P.packStrokes(strokes) }); }
  sendShot() { this.hub._deliver(this.id, P.MSG.SHOT, {}); }
  sendEvent(ev) { this.hub._deliver(this.id, P.MSG.EVENT, ev); }
  leave() {}

  _recv(from, t, d) {
    switch (t) {
      case P.MSG.INPUT: this.pendingInput.set(from, d); this._emit("input", { from, input: d }); break;
      case P.MSG.SNAP: this._emit("snapshot", P.unpackSnapshot(d)); break;
      case P.MSG.PAINT: this._emit("paint", { id: d.id, strokes: P.unpackStrokes(d.s || []) }); break;
      case P.MSG.SHOT: this._emit("shot", { from }); break;
      case P.MSG.EVENT: this._emit("event", d); break;
      default: break;
    }
  }
}
