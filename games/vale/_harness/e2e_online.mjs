// VALE harness — online play in real Chrome: a local game server + two separate browsers. Both players
// queue BRIDGE through the real UI (online pill → Play → BRIDGE → Find match → Ready), the server drafts and
// runs one lockstep match (seats on autopilot), and both reach the same postgame.
//   node _harness/e2e_online.mjs [--speed 8] [--port 8799]
// Needs the dev server (:5190) and a built catalog (node tools/build_content.ts --allow-missing-assets).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, shot, vale, waitFor } from './pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(opt('port', 8799)), SPEED = Number(opt('speed', 8));

const server = spawn(process.execPath, [join(HERE, '..', 'server', 'main.ts'), '--port', String(PORT), '--host', '127.0.0.1', '--wait', '3', '--speed', String(SPEED)], { stdio: ['ignore', 'pipe', 'pipe'] });
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d).trim()));
server.stderr.on('data', (d) => serverLog.push(String(d).trim()));
await new Promise((r) => setTimeout(r, 1500));

let fails = 0;
const check = (ok, what, detail) => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${!ok && detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`); };

const url = `/?dev=1&autopilot=match&server=${encodeURIComponent(`ws://127.0.0.1:${PORT}`)}`;
const players = [];
try {
  for (let i = 0; i < 2; i++) players.push(await open(url));
  for (const [i, p] of players.entries()) {
    await waitFor(p.page, (v) => v.state.online.value?.status === 'online', 20000);
    const pill = await p.page.locator('.netpill').innerText();
    check(/online/i.test(pill), `player ${i + 1} sees the online pill`, pill);
  }
  // both queue BRIDGE through the real UI
  for (const p of players) {
    await p.page.locator('.nav__item', { hasText: 'Play' }).click();
    await p.page.waitForTimeout(600);
    await p.page.locator('.station', { hasText: 'BRIDGE' }).first().click();
    await p.page.waitForTimeout(400);
    await p.page.getByRole('button', { name: 'Find match' }).click();
  }
  for (const [i, p] of players.entries()) {
    await waitFor(p.page, (v) => v.state.queue.value?.state === 'found' || !!v.state.draft.value, 30000);
    const line = await p.page.locator('.queue__net').innerText().catch(() => '');
    if (i === 0) console.log(`  queue line: ${line}`);
  }
  for (const p of players) {
    const ready = p.page.getByRole('button', { name: /^Ready/ });
    if (await ready.count()) await ready.first().click();
  }
  for (const p of players) await waitFor(p.page, (v) => !!v.state.draft.value || !!v.state.loading.value || !!v.state.match.value, 30000);
  const draftSeats = await vale(players[0].page, (v) => v.state.draft.value?.seats.filter((s) => !s.isBot).length ?? null);
  check(draftSeats === 2, 'the server draft seats both humans', draftSeats);
  for (const p of players) await waitFor(p.page, (v) => !!v.state.match.value, 120000);
  const ids = await Promise.all(players.map((p) => vale(p.page, (v) => v.state.match.value?.setup.matchId)));
  check(ids[0] && ids[0] === ids[1], 'both players are in the same online match', ids);
  await players[0].page.waitForTimeout(4000);
  await shot(players[0].page, 'e2e_online_p1_live');
  await shot(players[1].page, 'e2e_online_p2_live');
  for (const p of players) await waitFor(p.page, (v) => v.router.route.value.screen === 'postgame' || !!v.state.postgame.value, 1500000);
  const res = await Promise.all(players.map((p) => vale(p.page, (v) => { const g = v.state.postgame.value; return g ? { w: g.result.winningTeam, d: Math.round(g.result.duration), k: g.result.players.map((x) => x.kills) } : null; })));
  check(res[0] && JSON.stringify(res[0]) === JSON.stringify(res[1]), 'both players get the same result', res);
  await shot(players[0].page, 'e2e_online_p1_postgame');
  const errs = players.flatMap((p) => p.logs.filter((l) => /^\[(pageerror|http [45])/.test(l) || /drifted/.test(l)));
  check(!errs.length, 'no page errors, failed requests or drift', errs.slice(0, 5));
} catch (e) {
  fails++;
  console.log(`FAIL ${String(e?.message ?? e).split('\n')[0]}`);
  if (players[0]) await shot(players[0].page, 'e2e_online_FAIL').catch(() => {});
} finally {
  for (const p of players) await p.browser.close().catch(() => {});
  server.kill();
}
console.log(serverLog.filter((l) => /room|ended|desync|resume/.test(l)).slice(-6).join('\n'));
console.log(`${fails ? 'FAIL' : 'PASS'} e2e_online`);
process.exit(fails ? 1 : 0);
