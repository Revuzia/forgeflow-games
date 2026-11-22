// VALE probe — friend rooms (net.ts FRIEND ROOMS): a real game server (server/hub.ts) on a random port and three real
// LocalSessions over OnlineLink. Checks: Start room gives a code; Join friend by code puts a friend in it; a wrong code and
// a non-host change are refused; Same team seats both friends on one team in one match with the other seats filled;
// the room survives the match; Against each other splits them across the sides; leaving hands the host on.
// Uses the built catalog (dist-catalog): run `node tools/build_content.ts --allow-missing-assets` first.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../src/contracts/catalog.ts';
import type { FriendRoomState } from '../src/contracts/net.ts';
import type { MatchSetup } from '../src/contracts/sim.ts';
import { memorySession } from '../src/session/local_session.ts';
import { OnlineLink } from '../src/session/online_link.ts';
import { Hub } from '../server/hub.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..', 'dist-catalog', 'schema-1');
if (!existsSync(root)) { console.log('SKIP probe_friend_room: no built catalog (node tools/build_content.ts --allow-missing-assets)'); process.exit(0); }
const ver = readdirSync(root).filter((v) => /^\d{4}\.\d+\.\d+$/.test(v)).sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; }).pop()!;
const catalog = Catalog.parse(JSON.parse(readFileSync(join(root, ver, 'catalog.json'), 'utf8')));

let fails = 0;
const check = (ok: boolean, what: string, detail?: unknown): void => {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 5000): Promise<boolean> { const t = Date.now(); while (!f() && Date.now() - t < ms) await sleep(20); return f(); }

// VALE_NET_URL=ws://127.0.0.1:8791/ws runs the same checks against another server (workers/vale-net under wrangler dev)
const ext = process.env.VALE_NET_URL;
const hub = ext ? null : new Hub({ catalog, port: 0, host: '127.0.0.1', waitSeconds: 30, speed: 16, readySeconds: 10, friendTicketSeconds: 3 });
await sleep(100);
const url = ext ?? `ws://127.0.0.1:${hub!.port}`;
console.log(`server: ${url}`);

const queueId = catalog.queues.find((q) => q.id === 'rift_standard')?.id ?? catalog.queues.find((q) => q.kind === 'standard')!.id;
const clients = ['Ash', 'Birch', 'Cedar'].map((name, i) => {
  const link = new OnlineLink(url, catalog.version, () => name);
  const s = memorySession({ catalog, seed: 3100 + i, online: link }).session;
  const st = { name, s, link, errors: [] as string[], setup: null as MatchSetup | null, you: -1, loaded: false, drafted: false };
  s.on((e) => {
    if (e.type === 'error') st.errors.push(e.message);
    if (e.type === 'draft') st.drafted = true;
    if (e.type === 'loading') { st.setup = e.setup; if (e.progress >= 1 && !st.loaded) { st.loaded = true; s.matchReady(); } }
  });
  return st;
});
const [A, B, C] = clients;
const room = (c: typeof A): FriendRoomState | null => c.s.friendRoom();

check(await until(() => clients.every((c) => c.link.connected)), 'every client connects');

// ── start a room, join it ──────────────────────────────────────────────────────────────────────────
A.s.createFriendRoom(queueId, true);
check(await until(() => !!room(A)), 'Start room gives the host a room');
const code = room(A)?.code ?? '';
check(/^[A-Z2-9]{5}$/.test(code) && !/[01OIL]/.test(code), 'the room code is 5 easy-to-read characters', code);
check(room(A)?.host === room(A)?.you, 'the creator hosts the room');

C.s.joinFriendRoom('ZZZZZ');
check(await until(() => C.errors.includes('froom: no_room')), 'a wrong code is refused (no_room)', C.errors);
B.s.joinFriendRoom(code.toLowerCase());
check(await until(() => room(B)?.code === code && room(A)?.members.length === 2), 'Join friend by code (any case) puts the friend in the room', room(A));
B.s.setFriendRoom({ together: false });
check(await until(() => B.errors.includes('froom: not_host')), 'only the host changes the room (not_host)', B.errors);

// ── same team ──────────────────────────────────────────────────────────────────────────────────────
A.s.startFriendRoom();
check(await until(() => !!A.setup && !!B.setup, 20000), 'Start match takes both friends to loading (no ready check)', { a: !!A.setup, b: !!B.setup, ea: A.errors, eb: B.errors });
const seatsOf = (c: typeof A) => c.setup?.seats ?? [];
const humans = (c: typeof A) => seatsOf(c).filter((s) => s.controller === 'human');
check(A.setup?.matchId === B.setup?.matchId, 'both friends are in the same match', [A.setup?.matchId, B.setup?.matchId]);
check(humans(A).length === 2 && new Set(humans(A).map((s) => s.team)).size === 1, 'Same team: both friends are on one team', humans(A).map((s) => [s.name, s.team]));
check(seatsOf(A).length === 10 && seatsOf(A).filter((s) => s.controller === 'bot').length === 8, 'the other 8 seats are filled', seatsOf(A).length);
check(await until(() => !!room(A)?.members.every((m) => m.busy)), 'the room shows its members in a match');

// everyone leaves the match: the room is still there
for (const c of [A, B]) c.s.currentMatch()?.leave();
check(await until(() => !!room(A) && room(A)!.members.every((m) => !m.busy) && room(A)!.members.length === 2, 8000), 'the room survives the match with both members', room(A));

// ── against each other ─────────────────────────────────────────────────────────────────────────────
await until(() => A.s.currentMatch() === null && B.s.currentMatch() === null, 3000);
A.setup = null; B.setup = null; A.loaded = false; B.loaded = false;
A.s.setFriendRoom({ together: false });
check(await until(() => room(B)?.together === false), 'the host switches to Against each other and the friend sees it');
A.s.startFriendRoom();
check(await until(() => !!A.setup && !!B.setup, 20000), 'a second Start match takes both to loading', { ea: A.errors, eb: B.errors });
check(humans(A).length === 2 && new Set(humans(A).map((s) => s.team)).size === 2, 'Against each other: the friends are on opposite sides', humans(A).map((s) => [s.name, s.team]));
for (const c of [A, B]) c.s.currentMatch()?.leave();
await until(() => !!room(A) && room(A)!.members.every((m) => !m.busy), 8000);

// ── leaving ────────────────────────────────────────────────────────────────────────────────────────
A.s.leaveFriendRoom();
check(await until(() => room(B)?.host === room(B)?.you && room(B)?.members.length === 1), 'when the host leaves, the friend hosts the room', room(B));
check(room(A) === null, 'the one who left is in no room');

for (const c of clients) c.link.dispose();
await hub?.close();
console.log(fails ? `probe_friend_room: ${fails} FAIL` : 'probe_friend_room: all PASS');
process.exit(fails ? 1 : 0);
