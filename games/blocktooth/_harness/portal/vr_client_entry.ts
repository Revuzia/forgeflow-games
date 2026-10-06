// BLOCKTOOTH - VR gate client (lane O-REPORT): one human's end of a finished VS match, run headless inside a portal stand-in frame.
//
//   vr_client.html?seed=7&biome=grideast&humans=0,1&slot=0&winner=0&matchId=blocktooth:vr1:0001&uids=[u0,u1,null,null]&simS=12
//
// Every client of one match gets the SAME seed / lineup / humans / winner / simS, so they hold the same finished world, exactly as the
// lockstep peers do (the sim is deterministic: the probe_net4 / xbrowser gates prove that). `slot` is THIS client's seat. The page builds
// the world, plays `simS` seconds with no human input (human seats idle, bot seats on their native brains), decides the match for
// `winner` (the dev end the VS test surface uses: endMatch), then hands the world to the REAL PortalClient.vsMatchEnded exactly as
// App.reportVsEnd does. window.__VR__ = { done, error, state, goals, payload, filing, stats, ledger } is what portalcheck.py reads.
import { createWorld, stepWorldN } from '../../src/core/world.ts';
import { endMatch } from '../../src/vs/ko.ts';
import { emptyProfile } from '../../src/meta/profile.ts';
import { PortalClient } from '../../src/net/portal.ts';
import { VsEventTally } from '../../src/data/vsgoals.ts';
import type { BiomeId, PlayerSeat, SimEvent, TitanId } from '../../src/core/types.ts';

const Q = new URLSearchParams(location.search);
const out = document.getElementById('o') as HTMLElement;
const VR: Record<string, unknown> = { done: false, error: null, state: 'standalone' };
(window as unknown as { __VR__: unknown }).__VR__ = VR;
const log = (s: string): void => { out.textContent += '\n' + s; };

async function main(): Promise<void> {
  if (Q.get('fresh') !== '0') { try { localStorage.clear(); } catch { /* blocked */ } }
  const seed = Number(Q.get('seed') ?? 7) >>> 0;
  const biome = (Q.get('biome') ?? 'grideast') as BiomeId;
  const lineup = (Q.get('lineup') ?? 'molo,voltkite,hearthback,briarwick').split(',') as TitanId[];
  const humans = (Q.get('humans') ?? '0,1').split(',').filter((x) => x !== '').map(Number);
  const slot = Number(Q.get('slot') ?? 0);
  const winner = Number(Q.get('winner') ?? 0);
  const simS = Number(Q.get('simS') ?? 12);
  const matchId = Q.get('matchId') ?? 'blocktooth:vr:0001';
  const uids = JSON.parse(Q.get('uids') ?? '[null,null,null,null]') as (string | null)[];
  const startDelay = Number(Q.get('delay') ?? 0);

  const portal = new PortalClient({ cloudProfile: false, getProfile: () => emptyProfile(), getBests: () => ({}), adopt: () => { /* none */ } });
  portal.start();
  // wait for whoami (the stand-in answers at once; a silent parent leaves 'silent' after 3 x 4 s)
  const t0 = Date.now();
  while (portal.state === 'waiting' && Date.now() - t0 < 16000) await new Promise((r) => setTimeout(r, 25));
  VR.state = portal.state;
  if (startDelay > 0) await new Promise((r) => setTimeout(r, startDelay));

  const seats: PlayerSeat[] = lineup.map((t, i) => ({ titan: t, bot: humans.includes(i) ? null : 'regular' }));
  const w = createWorld({ mode: 'vs', players: seats, biome, seed, view: slot });
  const tally = new VsEventTally(slot);
  const inputs: null[] = [null, null, null, null];
  const limit = w.vs!.startT + simS;
  while (!w.run.result && w.t < limit) {
    stepWorldN(w, inputs);
    for (const e of w.events as readonly SimEvent[]) tally.feed(e);
  }
  if (!w.run.result) {
    const n0 = w.events.length;
    endMatch(w, winner);
    for (let i = n0; i < w.events.length; i++) tally.feed(w.events[i]);
  }
  log(`world decided: winner ${w.vs!.winner}, places ${w.players.map((p) => p.vs.place).join(',')}, ${w.tick} ticks`);
  const outcome = portal.vsMatchEnded({ w, slot, matchId, humans: humans.length, uidBySlot: uids, tally });
  VR.goals = outcome ? outcome.goals : null;
  VR.payload = outcome ? outcome.payload : null;
  VR.facts = outcome ? outcome.facts : null;
  VR.winner = w.vs!.winner;
  VR.places = w.players.map((p) => p.vs.place);
  VR.filing = outcome ? await outcome.filing : null;
  VR.stats = { vsResults: portal.stats.vsResults, achievements: portal.stats.achievements };
  const led = portal.vsLedger;
  VR.ledger = { matches: led.matches, wins: led.wins, done: Object.keys(led.done).sort() };
  VR.done = true;
  log('done ' + JSON.stringify({ goals: VR.goals, filing: VR.filing }));
}

main().catch((e) => { VR.error = String((e as Error)?.stack ?? e); VR.done = true; log('ERROR ' + VR.error); });
