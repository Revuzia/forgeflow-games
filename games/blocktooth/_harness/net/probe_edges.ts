// BLOCKTOOTH — one-tick input edges reach exactly ONE tick (lane O-LOBBY). Node, no browser, no network.
//
//   node _harness/net/probe_edges.ts
//
// The app presents a hook / dash / UPROAR press and a CARD RAIL pick for ONE 60 Hz frame while the lockstep samples are stamped at 30 Hz.
// Without a latch a press could fall between two samples (lost); held over, it would reach two ticks (a RECAST would fire its own
// DETONATE). LockstepPeer.setLocalInput latches the edges until a stamped sample carries them; a late (repeated) word never repeats
// them; a stamp that arrives too late for its tick hands its presses to the NEXT frame. This drives a real LockstepPeer with a stub
// sim and reads the canonical frames.

import { LockstepPeer } from '../../src/net/lockstep.ts';
import { INPUT_BYTES, NET_PROTO, TICK_MS, encodeInput, encodeInputPkt, type Frame, type StartInfo } from '../../src/net/proto.ts';
import type { SimPort, Standings } from '../../src/net/simport.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

interface W { tick: number }
function stubSim(frames: Frame[]): SimPort<W> {
  return {
    create: () => ({ tick: 0 }),
    step: (w, f) => { w.tick = f.tick; frames.push({ tick: f.tick, lateMask: f.lateMask, botMask: f.botMask, inputs: f.inputs.slice() }); },
    tick: (w) => w.tick,
    hash: (w) => w.tick,
    ended: () => false,
    standings: (w): Standings => ({ endTick: w.tick, result: 'x', seats: [], summary: {}, hash: 0 }),
  };
}

function startInfo(peers: (string | null)[]): StartInfo {
  return {
    proto: NET_PROTO, build: 'probe', matchId: 'edges', seed: 1, biome: 'grideast', mode: 'vs', endTick: 100000, lead: 4,
    seats: peers.map((p, slot) => ({ slot, kind: p ? 'human' as const : 'bot' as const, peer: p, name: p ?? 'bot', titan: 'molo' })),
  };
}

const word = (o: { mx?: number; mz?: number; ability?: boolean; abilityHeld?: boolean; dash?: boolean; ultimate?: boolean }, card = 0): Uint8Array => {
  const b = new Uint8Array(INPUT_BYTES);
  encodeInput({ mx: o.mx ?? 0, mz: o.mz ?? 0, ability: !!o.ability, abilityHeld: !!o.abilityHeld, dash: !!o.dash, ultimate: !!o.ultimate }, b, 0, card);
  return b;
};

// ── 1. the host's own presses: one frame each, whatever the sampling phase ──
{
  const frames: Frame[] = [];
  const sent: Uint8Array[] = [];
  const p = new LockstepPeer<W>({ self: 'a', start: startInfo(['a', null, null, null]), sim: stubSim(frames), mesh: { send: (_t, b) => { sent.push(b); } }, now: 0 });
  let now = 0;
  const run = (n: number): void => { for (let i = 0; i < n; i++) { now += TICK_MS / 2; p.pump(now); } };   // 60 Hz pumps, 30 Hz ticks
  run(6);
  // press the hook for ONE app frame, then clear it (the app's next frame has no edge)
  p.setLocalInput(word({ ability: true, mx: 1 }));
  p.setLocalInput(word({ mx: 1 }));
  run(12);
  // press dash twice in a row within one stamp interval (merges), then UPROAR later
  p.setLocalInput(word({ dash: true })); p.setLocalInput(word({})); p.setLocalInput(word({ dash: true })); p.setLocalInput(word({}));
  run(10);
  p.setLocalInput(word({ ultimate: true })); p.setLocalInput(word({}));
  run(10);
  // a held hook (level bit 2) stays on every frame
  p.setLocalInput(word({ abilityHeld: true }));
  run(14);
  const cnt = (bit: number): number => frames.filter((f) => (f.inputs[2] & bit) !== 0).length;
  ok(frames.length > 20, 'the stub sim stepped frames', String(frames.length));
  ok(cnt(1) === 1, 'one ability press -> exactly one tick with the ability edge', String(cnt(1)));
  ok(cnt(4) === 1, 'two dash presses inside one stamp interval merge into ONE tick', String(cnt(4)));
  ok(cnt(8) === 1, 'one UPROAR press -> exactly one tick', String(cnt(8)));
  const held = frames.filter((f) => (f.inputs[2] & 2) !== 0).length;
  ok(held >= 5, 'the held bit is a level (it stays on while held)', String(held));
  const mv = frames.filter((f) => f.inputs[0] === 127).length;
  ok(mv >= 6, 'movement is untouched by the latch', String(mv));
}

// ── 2. a late guest stamp: its presses ride the next frame; a repeated word never re-fires ──
{
  const frames: Frame[] = [];
  const p = new LockstepPeer<W>({ self: 'a', start: startInfo(['a', 'b', null, null]), sim: stubSim(frames), mesh: { send: () => { /* */ } }, now: 0 });
  let now = 0;
  const run = (n: number): void => { for (let i = 0; i < n; i++) { now += TICK_MS / 2; p.pump(now); } };
  const inputPkt = (first: number, words: Uint8Array[]): Uint8Array => {
    const inputs = new Uint8Array(words.length * INPUT_BYTES);
    words.forEach((w, i) => inputs.set(w, i * INPUT_BYTES));
    return encodeInputPkt({ epoch: 0, seat: 1, lead: 4, ping: 0, ack: 0, first, inputs });
  };
  run(2);
  // guest b sends stamps 3..6 on time (movement only, with a dash press at stamp 5)...
  p.receive('b', inputPkt(3, [word({ mx: 1 }), word({ mx: 1 }), word({ mx: 1, dash: true }), word({ mx: 1 })]), now);
  run(10);                                     // ticks 1..~8 produced; the guest's stamps are used where they exist
  const f5 = frames.find((f) => f.tick === 5);
  ok(!!f5 && (f5.inputs[INPUT_BYTES + 2] & 4) !== 0, 'an on-time guest dash lands on its own tick', f5 ? String(f5.inputs[INPUT_BYTES + 2]) : 'no frame');
  // ... then the guest stays silent for a while (late frames repeat its word, never its press) ...
  run(14);
  const lateFrames = frames.filter((f) => ((f.lateMask >> 1) & 1) === 1 && f.tick > 6);
  ok(lateFrames.length >= 3, 'late frames were produced', String(lateFrames.length));
  ok(lateFrames.every((f) => (f.inputs[INPUT_BYTES + 2] & (1 | 4 | 8)) === 0 && f.inputs[INPUT_BYTES + 3] === 0), 'a repeated (late) word never re-fires a press or a card');
  // ... and now a stamp for a tick that was already repeated shows up, carrying a hook press + a card pick
  const lateTick = lateFrames[0].tick;
  const before = frames.length;
  p.receive('b', inputPkt(lateTick, [word({ mx: 1, ability: true }, 2)]), now);
  run(4);
  const after = frames.slice(before);
  const carried = after.filter((f) => (f.inputs[INPUT_BYTES + 2] & 1) !== 0);
  ok(carried.length === 1, 'the late stamp\'s hook press rides exactly one later frame', String(carried.length));
  ok(after.filter((f) => f.inputs[INPUT_BYTES + 3] === 2).length === 1, 'the late stamp\'s card pick rides exactly one later frame');
  // the same stamp arriving again (the 6-deep redundancy) must not fire twice
  const before2 = frames.length;
  p.receive('b', inputPkt(lateTick, [word({ mx: 1, ability: true }, 2)]), now);
  run(4);
  ok(frames.slice(before2).every((f) => (f.inputs[INPUT_BYTES + 2] & 1) === 0 && f.inputs[INPUT_BYTES + 3] === 0), 'a duplicate of a carried stamp does not fire again');
}

console.log(`probe_edges: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
