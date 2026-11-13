// BLOCKTOOTH - _harness/net/probe_vshash.ts (lane O-PORT). Unit gate for src/net/simport.ts hashWorld on a VS world
// (src/net/vshash.ts): the lockstep desync detector must (1) not depend on which seat a peer LOOKS at, (2) see a 1-ulp change
// in every kind of state the sim owns, (3) be deterministic run to run.
//
//   1. VIEW INDEPENDENCE  four worlds from one seed, view seats 0..3 (setViewSlot), the same frames: the hash is equal at every
//                         checkpoint (a hash that read the cursor w.titan / w.upgrades would differ between peers)
//   2. SENSITIVITY        at tick N a long list of mutators flips 1 ulp / adds 1 to one field in a different container each; the
//                         hash must change, and return to the original when the field is restored
//   3. DETERMINISM        a second world, same seed + frames, same view: identical hashes
//
// Usage: node _harness/net/probe_vshash.ts [--ticks 2400] [--seed 1337]      Exit 0 = PASS, 1 = FAIL
import type { World } from '../../src/core/types.ts';
import { SEATS, INPUT_BYTES, NET_PROTO, type Frame } from '../../src/net/proto.ts';
import { vsStartInfo, vsWorldPort } from '../../src/net/simport.ts';
import { setViewSlot } from '../../src/core/world.ts';

const args = process.argv.slice(2);
const opt = (n: string, d: string): string => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const TICKS = Number(opt('--ticks', '2400'));
const SEED = Number(opt('--seed', '1337'));

const start = vsStartInfo({ proto: NET_PROTO, build: 'h', matchId: 'h', seed: SEED, biome: 'grideast',
  seats: ['molo', 'voltkite', 'hearthback', 'briarwick'].map((t, i) => ({ kind: i === 0 ? 'human' as const : 'bot' as const, peer: i === 0 ? 'p0' : null, name: 'S' + i, titan: t })) });

function frame(tick: number): Frame {
  const inputs = new Uint8Array(SEATS * INPUT_BYTES);
  const a = ((tick >> 6) % 8) / 8 * Math.PI * 2;
  inputs[0] = Math.round(Math.cos(a) * 127) & 0xff; inputs[1] = Math.round(Math.sin(a) * 127) & 0xff;
  inputs[2] = tick % 97 === 0 ? 1 : 0;
  if (tick % 61 === 0) inputs[3] = 1 + (tick % 3);
  return { tick, lateMask: 0, botMask: 0b1110, inputs };
}

const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
function ulp(x: number): number { F64[0] = x; U32[0] ^= 1; return F64[0]; }

interface Mut { name: string; apply: (w: World) => (() => void) | null }
function numField<T extends object>(name: string, get: (w: World) => T | null | undefined, key: string): Mut {
  return { name, apply: (w) => {
    const o = get(w) as Record<string, unknown> | null | undefined;
    if (!o || typeof o[key] !== 'number') return null;
    const old = o[key] as number;
    o[key] = old === 0 ? 1e-300 : ulp(old);
    return () => { o[key] = old; };
  } };
}

const MUTS: Mut[] = [
  numField('seat1 titan.x', (w) => w.players[1].titan, 'x'),
  numField('seat3 titan.hp', (w) => w.players[3].titan, 'hp'),
  numField('seat2 titan.dashRecharge', (w) => w.players[2].titan, 'dashRecharge'),
  numField('seat2 titan.stats.damage', (w) => w.players[2].titan.stats, 'damage'),
  numField('seat0 upgrades.rerolls', (w) => w.players[0].upgrades, 'rerolls'),
  numField('seat1 ult.charge', (w) => w.players[1].ult, 'charge'),
  numField('seat1 ult.xpTotal', (w) => w.players[1].ult, 'xpTotal'),
  numField('seat2 tally.kills', (w) => w.players[2].tally, 'kills'),
  numField('seat2 tally.hpLowFrac', (w) => w.players[2].tally, 'hpLowFrac'),
  numField('seat3 director.spawnBudget', (w) => w.players[3].director, 'spawnBudget'),
  numField('seat3 director.nextWaveT', (w) => w.players[3].director, 'nextWaveT'),
  numField('seat1 rail.openedT', (w) => w.players[1].rail, 'openedT'),
  numField('seat2 vs.pvpDealt', (w) => w.players[2].vs, 'pvpDealt'),
  numField('seat1 bot.tx', (w) => w.players[1].bot, 'tx'),
  numField('seat1 bot.lastX', (w) => w.players[1].bot, 'lastX'),
  numField('seat3 bot.holdAbilityUntil', (w) => w.players[3].bot, 'holdAbilityUntil'),
  numField('vs.ring.r', (w) => w.vs?.ring, 'r'),
  numField('vs.phaseT', (w) => w.vs, 'phaseT'),
  numField('vs.tenders[0].atS', (w) => w.vs?.tenders[0], 'atS'),
  numField('enemy[first live].heading', (w) => w.enemies.find((e) => e.alive), 'heading'),
  numField('enemy[first live].cd', (w) => w.enemies.find((e) => e.alive), 'cd'),
  numField('enemy[first live].stun', (w) => w.enemies.find((e) => e.alive), 'stun'),
  numField('pickup[first live].vy', (w) => w.pickups.find((p) => p.alive), 'vy'),
  numField('projectile[first live].vz', (w) => w.projectiles.find((p) => p.alive), 'vz'),
  numField('telegraph[first live].t', (w) => w.telegraphs.find((p) => p.alive), 't'),
  numField('hazard[first live].tickT', (w) => w.hazards.find((p) => p.alive), 'tickT'),
  numField('map.nextOverloadT', (w) => w.map, 'nextOverloadT'),
  numField('map.lastDropT', (w) => w.map, 'lastDropT'),
  numField('map.objectives[0].t', (w) => w.map.objectives.find((o) => o.alive !== false) as unknown as object, 't'),
  numField('map.powerups[0].t', (w) => w.map.powerups.find((o) => (o as { alive?: boolean }).alive !== false) as unknown as object, 't'),
  numField('city.building[0].floorHp', (w) => w.city.buildings[0], 'floorHp'),
  numField('city.prop[0].hp', (w) => w.city.props[0], 'hp'),
  numField('city.prop[traffic].laneS', (w) => w.city.props.find((p) => p.lane >= 0), 'laneS'),
  numField('run.tonnage', (w) => w.run, 'tonnage'),
  { name: 'world.nextId', apply: (w) => { w.nextId++; return () => { w.nextId--; }; } },
  { name: 'seat2 vs.data (new key)', apply: (w) => { const d = w.players[2].vs.data; d.__probe = 1; return () => { delete d.__probe; }; } },
  { name: 'seat1 upgrades.owned (new card)', apply: (w) => { const o = w.players[1].upgrades.owned; o.__probe = 1; return () => { delete o.__probe; }; } },
];

function main(): void {
  const port = vsWorldPort();
  const checks: { id: string; ok: boolean; detail: string }[] = [];
  const add = (id: string, ok: boolean, detail: string): void => { checks.push({ id, ok, detail }); };

  // 1 + 3: view independence and determinism
  const worlds = [0, 1, 2, 3, 0].map((v) => { const w = port.create(start); setViewSlot(w, v); return w; });
  let compared = 0, bad = 0, firstBad = '';
  for (let t = 1; t <= TICKS; t++) {
    const f = frame(t);
    for (const w of worlds) { port.step(w, f); setViewSlot(w, w.view); }
    if (t % 30 === 0) {
      const hs = worlds.map((w) => port.hash(w));
      compared++;
      if (hs.some((h) => h !== hs[0])) { bad++; if (!firstBad) firstBad = `tick ${t}: ${hs.map((h) => h.toString(16)).join('/')}`; }
    }
  }
  add('view_independent_and_deterministic', bad === 0 && compared > 0, `${compared} checkpoints x 5 worlds (views 0,1,2,3,0), ${bad} mismatched${firstBad ? ' first ' + firstBad : ''}`);

  // 2: sensitivity
  const w = worlds[0];
  const base = port.hash(w);
  let tested = 0;
  const skipped: string[] = [];
  const failed: string[] = [];
  for (const m of MUTS) {
    const undo = m.apply(w);
    if (!undo) { skipped.push(m.name); continue; }
    tested++;
    const h = port.hash(w);
    undo();
    const back = port.hash(w);
    if (h === base) failed.push(`${m.name} (hash did not change)`);
    if (back !== base) failed.push(`${m.name} (not restored)`);
  }
  add('hash_sees_1ulp_everywhere', failed.length === 0 && tested >= MUTS.length - 6,
    `${tested}/${MUTS.length} mutators applied at tick ${w.tick} (enemies ${w.enemies.filter((e) => e.alive).length}, projectiles ${w.projectiles.filter((e) => e.alive).length}, telegraphs ${w.telegraphs.filter((e) => e.alive).length}, hazards ${w.hazards.filter((e) => e.alive).length}); ` +
    (failed.length ? 'NOT SEEN: ' + failed.join(', ') : 'every one changed the hash and restored it') + (skipped.length ? `; no live target for: ${skipped.join(', ')}` : ''));

  // the cursor is NOT part of the hash
  const h0 = port.hash(w);
  setViewSlot(w, 2); const h2 = port.hash(w); setViewSlot(w, 0);
  add('cursor_not_hashed', h0 === h2, `view 0 ${h0.toString(16)} vs view 2 ${h2.toString(16)}`);

  for (const c of checks) console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.id}: ${c.detail}`);
  const ok = checks.every((c) => c.ok);
  console.log(`probe_vshash: ${ok ? 'PASS' : 'FAIL'}`);
  process.exit(ok ? 0 : 1);
}
main();
