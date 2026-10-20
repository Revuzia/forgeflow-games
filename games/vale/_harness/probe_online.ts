// VALE probe — online play end to end (CONTRACT §7.2): a real game server (server/hub.ts) on a random
// port, real WebSocket clients (OnlineLink, Node's global WebSocket) inside real LocalSessions, the whole
// flow — queue → ready check → server-side draft → loading → lockstep match → postgame — at 64× speed.
// Checks: both humans land in the same match, every client tick matches its sim tick, no digest drift,
// the clients and the server agree on the result, and each profile booked the match.
// Uses the built catalog (dist-catalog): run `node tools/build_content.ts --allow-missing-assets` first.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../src/contracts/catalog.ts';
import type { MatchResult } from '../src/contracts/sim.ts';
import { memorySession } from '../src/session/local_session.ts';
import { LockstepMatchHost } from '../src/session/lockstep_host.ts';
import { OnlineLink } from '../src/session/online_link.ts';
import { Hub } from '../server/hub.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..', 'dist-catalog', 'schema-1');
if (!existsSync(root)) { console.log('SKIP probe_online: no built catalog (node tools/build_content.ts --allow-missing-assets)'); process.exit(0); }
const ver = readdirSync(root).sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).pop()!;
const catalog = Catalog.parse(JSON.parse(readFileSync(join(root, ver, 'catalog.json'), 'utf8')));

let fails = 0;
const check = (ok: boolean, what: string, detail?: unknown): void => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
};

const serverResults: string[] = [];
const hub = new Hub({ catalog, port: 0, host: '127.0.0.1', waitSeconds: 0.5, speed: 64, readySeconds: 10, log: (m) => { if (/ended/.test(m)) serverResults.push(m); } });
await new Promise((r) => setTimeout(r, 100));
const url = `ws://127.0.0.1:${hub.port}`;

async function scenario(queue: string, humans: number, pilot: boolean): Promise<void> {
  console.log(`— ${queue}: ${humans} humans${pilot ? ' on autopilot (their commands cross the wire)' : ' standing still'}`);
  const clients = Array.from({ length: humans }, (_, i) => {
    const link = new OnlineLink(url, catalog.version, () => `Tester ${i + 1}`);
    const s = memorySession({ catalog, seed: 2000 + i, online: link, ...(pilot ? { autopilot: 'match' as const } : {}) }).session;
    const state = { s, link, result: null as MatchResult | null, errors: [] as string[], matchIds: new Set<string>(), loaded: false };
    s.on((e) => {
      if (e.type === 'queue' && e.state === 'found') s.acceptMatch();
      if (e.type === 'loading' && e.progress >= 1 && !state.loaded) { state.loaded = true; s.matchReady(); }
      if (e.type === 'loading') state.matchIds.add(e.setup.matchId);
      if (e.type === 'postgame') state.result = e.result;
      if (e.type === 'error') state.errors.push(e.message);
    });
    return state;
  });
  const t0 = Date.now();
  while (!clients.every((c) => c.link.connected) && Date.now() - t0 < 5000) await new Promise((r) => setTimeout(r, 20));
  check(clients.every((c) => c.link.connected), 'every client connects and says hello');
  for (const c of clients) c.s.queue({ queue });
  // pump every live match like the frame loop does, until every client has its postgame
  const deadline = Date.now() + 240000;
  while (!clients.every((c) => c.result) && Date.now() < deadline) {
    for (const c of clients) c.s.currentMatch()?.pump(0.05);
    await new Promise((r) => setImmediate(r));
  }
  check(clients.every((c) => c.result), 'every client reaches the postgame', clients.map((c) => !!c.result));
  const ids = new Set(clients.flatMap((c) => [...c.matchIds]));
  check(ids.size === 1, 'all humans were seated in the same match', [...ids]);
  const results = clients.map((c) => c.result).filter((r): r is MatchResult => !!r);
  const key = (r: MatchResult): string => JSON.stringify({ w: r.winningTeam, d: r.duration, reason: r.reason, k: r.players.map((p) => [p.kills, p.deaths, p.cs, Math.round(p.gold)]) });
  check(results.length === humans && results.every((r) => key(r) === key(results[0])), 'clients agree on the result (winner, duration, every K/D/CS/gold)');
  const humanSeats = results[0]?.players.filter((p) => p.controller === 'human').length ?? 0;
  check(humanSeats === humans, 'the match seated every human as a human', humanSeats);
  const mism = clients.map((c) => (c.s.currentMatch() as LockstepMatchHost | null)?.mismatches ?? 0);
  check(clients.every((c) => !c.errors.some((e) => /drifted|lost/.test(e))), 'no digest drift and no lost connection', clients.map((c) => c.errors));
  check(mism.every((m) => m === 0), 'every server tick lined up with the client sim', mism);
  check(clients.every((c) => c.s.profile().history[0]?.matchId === results[0]?.matchId), 'each profile booked the online match');
  if (pilot) {
    const acted = results[0]?.players.filter((p) => p.controller === 'human').map((p) => p.cs + p.kills + p.deaths + p.assists) ?? [];
    check(acted.length === humans && acted.every((n) => n > 0), 'the humans played: their commands reached every sim', acted);
  }
  console.log(`  ${queue}: ${results[0]?.reason} after ${results[0]?.duration.toFixed(0)} s of game in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const c of clients) { c.s.dispose(); c.link.dispose(); }
}

await scenario('bridge_standard', 2, true);
await scenario('fray_standard', 3, true);
await scenario('rift_coop', 2, false);
check(serverResults.length >= 3, 'the server ran every match to an end', serverResults);
await hub.close();
console.log(`${fails ? 'FAIL' : 'PASS'} probe_online`);
process.exit(fails ? 1 : 0);
