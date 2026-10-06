// BLOCKTOOTH ONLINE VS — lobby / controller pure-logic probe (lane O-LOBBY). Node, no browser, no network.
//
//   node _harness/net/probe_lobby.ts
//
// Covers the parts of src/online.ts that are plain functions: room-code derivation for REMATCH rooms, name cleaning, the invite
// link, the START -> VsMatchInfo description (seat names, bot call-signs, seat colours, who is local), the VS HUD safe rectangle
// (CRIT: nameplates / arrows clamp to it) and the takeover damage ramp (CRIT). The browser flows (menu, lobby, notices, rematch)
// are driven by _harness/scratch/partb/O-LOBBY/ond.py against a real Chrome + real Supabase.

import { VS } from '../../src/core/config.ts';
import { SEATS, NET_PROTO } from '../../src/net/proto.ts';
import { vsStartInfo } from '../../src/net/simport.ts';
import { phaseMul, TAKEOVER_RAMP_S } from '../../src/vs/clock.ts';
import { safeRect } from '../../src/ui/vstypes.ts';
import { asTitan, buildInfo, cleanName, rematchCode } from '../../src/online.ts';

let pass = 0, fail = 0;
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) pass++; else { fail++; console.log('  FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// ── rematch codes ──
ok(rematchCode('ABCD') === 'ABCDR1', 'rematch code of a 4-letter room', rematchCode('ABCD'));
ok(rematchCode('ABCDR1') === 'ABCDR2', 'rematch of a rematch increments', rematchCode('ABCDR1'));
ok(rematchCode(rematchCode(rematchCode('WXYZ'))) === 'WXYZR3', 'three rematches', rematchCode(rematchCode(rematchCode('WXYZ'))));
ok(rematchCode('QJ1Y9QUOI') === 'QJ1Y9QUOIR1' && rematchCode('QJ1Y9QUOI').length <= 12, 'a quick-match room code stays within 12 characters');
ok(rematchCode('QJ1Y9QUOIR9').length <= 12 && rematchCode('QJ1Y9QUOIR9').endsWith('R10'), 'R9 -> R10 still fits', rematchCode('QJ1Y9QUOIR9'));
ok(/^[A-Z0-9]{4,12}$/.test(rematchCode('KXQF')), 'a rematch code is a valid room code');
// every peer derives the same code from the same old code
ok(rematchCode('KXQF') === rematchCode('KXQF'), 'deterministic');

// ── names / titans ──
ok(cleanName('  alice  ') === 'ALICE', 'cleanName trims + upper-cases');
ok(cleanName('Bob<script>') === 'BOBSCRIPT', 'cleanName strips markup characters', cleanName('Bob<script>'));
ok(cleanName('A'.repeat(40)).length === 14, 'cleanName caps at 14');
ok(cleanName(null) === '' && cleanName(undefined) === '', 'cleanName of nothing');
ok(asTitan('molo') === 'molo' && asTitan('voltkite') === 'voltkite' && asTitan('godzilla') === null && asTitan(7) === null, 'asTitan validates');

// ── START -> match info ──
const start = vsStartInfo({
  proto: NET_PROTO, build: 'probe', matchId: 'probe-1', seed: 1337, biome: 'grideast',
  seats: [
    { kind: 'human', peer: 'p0', name: 'ALICE', titan: 'molo' },
    { kind: 'human', peer: 'p1', name: 'GUEST-4F9K', titan: 'voltkite' },
    { kind: 'bot', peer: null, name: '', titan: 'hearthback', botLevel: 1 },
    { kind: 'bot', peer: null, name: '', titan: 'briarwick', botLevel: 2 },
  ],
});
const infoA = buildInfo(start, 0), infoB = buildInfo(start, 1);
ok(infoA.seats.length === SEATS && infoA.local === 0 && infoB.local === 1, 'info: 4 seats, local seat');
ok(infoA.seats[0].name === 'YOU' && infoA.seats[1].name === 'GUEST-4F9K' && infoB.seats[0].name === 'ALICE' && infoB.seats[1].name === 'YOU', 'info: the local seat reads YOU, rivals their own names');
ok(!infoA.seats[0].bot && !infoA.seats[1].bot && infoA.seats[2].bot && infoA.seats[3].bot, 'info: bot flags');
ok(infoA.seats[2].level === 'regular' && infoA.seats[3].level === 'veteran' && infoA.seats[0].level === null, 'info: bot levels from SeatInfo.botLevel');
ok(infoA.seats[2].name.startsWith('UNIT ') && infoA.seats[2].sign.length > 0, 'info: bots get a UNIT n + call-sign', infoA.seats[2].name + ' / ' + infoA.seats[2].sign);
ok(infoA.seats[2].name === infoB.seats[2].name && infoA.seats[3].sign === infoB.seats[3].sign, 'info: the same bot names on every peer');
ok(new Set(infoA.seats.map((s) => s.color)).size === 4 && infoA.seats[0].color === VS.seatColors[0], 'info: 4 distinct seat colours');
ok(infoA.biome === 'grideast' && infoA.seed === 1337, 'info: city + seed come from START');
ok(start.endTick >= Math.round((VS.countdownS + VS.phase.hardEndS) * 30), 'START endTick covers the whole match', String(start.endTick));
ok(start.mode === 'vs' && start.seats.length === 4, 'START is a 4-seat VS match');

// ── the HUD safe rectangle ──
{
  const u = 12.8, W = 1280, H = 720;
  const R = safeRect(W, H, u);
  ok(R.l >= 24.5 * u - 1e-9 && R.r <= W - 26 * u + 1e-9 && R.t >= 12 * u - 1e-9 && R.b <= H - 16 * u + 1e-9, 'safe rect clears the seat column / feed + minimap / phase strip / bottom panels');
  ok(R.r - R.l > 30 * u && R.b - R.t > 15 * u, 'safe rect is large enough to be useful at 1280x720', JSON.stringify(R));
  const small = safeRect(640, 360, 8);
  ok(small.r > small.l && small.b > small.t, 'safe rect never inverts on a tiny window');
}

// ── the takeover damage ramp ──
{
  const P = VS.phase;
  ok(phaseMul('takeover', P.openEndS) === 0, 'takeover ramp starts at 0');
  ok(Math.abs(phaseMul('takeover', P.openEndS + TAKEOVER_RAMP_S / 2) - 0.5) < 1e-12, 'takeover ramp is linear');
  ok(phaseMul('takeover', P.openEndS + TAKEOVER_RAMP_S) === 1 && phaseMul('takeover', P.openEndS + 100) === 1, 'takeover ramp reaches 1 and stays');
  ok(phaseMul('open', 100) === 0 && phaseMul('last', 620) === 1, 'the other phases are untouched');
}

console.log(`probe_lobby: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
