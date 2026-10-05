// BLOCKTOOTH ONLINE VS ("ZONING DISPUTE") — all on-screen copy, in the WARD-7 tabloid voice (lane B-VIEW).
// vs_design.md §3 (banners), §9-§11 (placement, KO / spectate / end card), §10 (bot call-signs). Pure data + tiny
// formatters: THREE-free, DOM-free. Every string here is user-visible; nothing in the sim reads this file.

import type { GateId, TitanId } from '../core/types.ts';
import { VS as VSCFG } from '../core/config.ts';
import type { VsPhase } from '../vs/types.ts';

/** phase banners (vs_design.md §3 table): `title` is the stamp, `sub` the one-line rule that just changed */
export const VS_BANNER: Record<VsPhase, { title: string; sub: string }> = {
  countdown: { title: 'ZONING DISPUTE', sub: 'FOUR APPLICANTS, ONE CITY' },
  open: { title: 'OPEN HOUSE', sub: 'EAT FIRST, ASK LATER' },
  takeover: { title: 'HOSTILE TAKEOVER', sub: 'THE CLAWS ARE OUT' },
  final: { title: 'FINAL NOTICE', sub: 'THE CITY IS CONDEMNED' },
  last: { title: 'LAST CALL', sub: 'THE CORDON CLOSES FOR GOOD' },
  over: { title: 'CASE CLOSED', sub: 'THE FRONT PAGE IS GOING TO PRINT' },
};

/** the rule line under the clock, per phase (what is true right now) */
export const VS_RULE: Record<VsPhase, string> = {
  countdown: 'TITANS ON THEIR MARKS',
  open: 'NO RIVAL DAMAGE · HITS SHOVE ONLY',
  takeover: `KO = EVICTED · BACK IN ${VSCFG.ko.respawnS} S · −${VSCFG.ko.levelsLost} LV · THE CROWN −${VSCFG.crown.levelsLost}`,   // read from the rules (it said −2 LV while the rule was −1)
  final: 'NO RESPAWNS · THE CORDON CLOSES',
  last: 'THE CORDON IS AT ITS LAST CIRCLE',
  over: 'MATCH DECIDED',
};

/** what the clock counts down to (the NEXT phase), by the phase we are in */
export const VS_NEXT: Partial<Record<VsPhase, string>> = {
  open: 'HOSTILE TAKEOVER IN',
  takeover: 'FINAL NOTICE IN',
  final: 'LAST CALL IN',
  last: 'HARD END IN',
};

export const VS_TENDER_NAME: Record<GateId, string> = {
  stencil1: 'STENCIL-1',
  cordon2: 'CORDON-2',
  switchboard5: 'SWITCHBOARD-5',
};

export const VS = {
  /** the countdown's last beat */
  go: 'GO',
  you: 'YOU',
  bot: 'BOT',
  crown: 'FRONT PAGE',
  out: 'OUT',
  evicted: 'EVICTED',
  clearedChip: 'CLEARED',
  protChip: 'PROTECTED',
  noContest: 'NO CONTEST',
  /** KO feed lines. {a} {b} are names, {n} a number */
  feed: {
    evicted: '{a} EVICTED {b}{lv}',
    evictedBy: '{b} EVICTED BY {a}{lv}',
    headline: 'HEADLINE STOLEN · {a} EVICTS THE FRONT PAGE',
    assist: '{a} ASSISTS',
    eliminated: '{b} ELIMINATED · {place}',
    eliminatedBy: '{b} ELIMINATED BY {a} · {place}',
    crown: 'FRONT PAGE: {a}',
    crownNone: 'THE FRONT PAGE IS VACANT',
    tenderMarker: 'PUBLIC TENDER: {name} IN {t} S · BIDS BY DAMAGE',
    tenderSpawn: '{name} IS ON THE STREET',
    tenderPaid: 'BIDS PAID · {a} TOP BIDDER ON {name}',
    ring: 'CONDEMNATION ORDER · STEP {n} OF 4',
    phase: '{title}',
  },
  /** the tender rig's nameplate (ui/bossbar.ts in a VS match) */
  tender: {
    kicker: 'PUBLIC TENDER · BIDS BY DAMAGE',
    sub: 'MOST DAMAGE TAKES THE CHEST · NO LAST-HIT BONUS',
    arriving: 'THE BID IS OPEN — GET THERE FIRST',
    paid: 'BIDS PAID',
  },
  /** own-body stamps */
  backIn: 'BACK IN {n}',
  evictedBy: 'EVICTED BY {a}{lv}',
  evictedAlone: 'EVICTED{lv}',
  eliminatedYou: 'ELIMINATED — {place}',
  outsideRing: 'OUTSIDE THE CORDON — MORTAR INBOUND',
  spectating: 'SPECTATING',
  spectateKeys: 'Q / E  CYCLE',
  mapKey: 'M  MAP',
  leaveKey: 'ESC  LEAVE',
  /** standings */
  place: ['1ST', '2ND', '3RD', '4TH'],
  placeLong: ['FIRST', 'SECOND', 'THIRD', 'FOURTH'],
  rail: {
    title: 'CARD RAIL',
    reroll: 'REROLL',
    queued: '+{n} QUEUED',
    chest: 'TENDER CHEST',
    opening: 'OPENING CARD',
    keys: '1 2 3 PICK · R REROLL',
    padKeys: 'LB · LT · BACK PICK · X REROLL',
    auto: 'AUTO-PICK',
  },
  menu: {
    chip: 'VS PRACTICE',
    key: 'V',
    header: 'VS PRACTICE — ZONING DISPUTE',
    step1: 'STEP 1 OF 2 — PICK YOUR TITAN',
    step2: 'STEP 2 OF 2 — PICK THE CITY',
    confirm: 'NEXT',
    start: 'START THE DISPUTE',
    botsLabel: 'RIVAL BOTS',
    botsHint: 'YOU + 3 BOTS · THE OTHER THREE TITANS',
    levels: { rookie: 'ROOKIE', regular: 'REGULAR', veteran: 'VETERAN' },
    levelNote: {
      rookie: 'SLOW TO REACT · DODGES LESS · FIGHTS ONLY WHEN AHEAD',
      regular: 'THE DEFAULT ROOM',
      veteran: 'QUICK · DODGES MOST TELLS · FIGHTS EVEN ODDS',
    },
  },
  end: {
    kicker: 'ZONING DISPUTE · FINAL EDITION',
    win: '{name} WINS ZONING DISPUTE IN {t}',
    winSub: 'CERTIFIED HEADLINE',
    timeout: '{name} TAKES ZONING DISPUTE AT THE BELL · {t}',
    you1: 'YOU TOOK THE FRONT PAGE',
    youN: 'YOU FINISHED {place}',
    score: 'VS SCORE',
    items: { tons: 'TONNAGE', pvp: 'PVP DAMAGE', evict: 'EVICTIONS', assist: 'ASSISTS', bids: 'TENDER BIDS', size: 'PEAK SIZE' },
    rematch: 'REMATCH',
    leave: 'LEAVE',
    swapTitle: 'TITAN SWAP',
    swapSub: 'PICK YOUR APPLICANT · NEW CITY · NEW SEED',
    swapGo: 'LOCK IN',
    swapIn: 'STARTS IN {n}',
    voteIn: 'REMATCH VOTE · {n}',
  },
} as const;

/** original handler call-signs for the bots (vs_design.md §10). Cosmetic, picked by seat + seed; never names a real person. */
export const BOT_CALLSIGNS: readonly string[] = [
  'LOOSE PERMIT', 'NIGHT SHIFT', 'RED TAPE', 'PETTY CASH', 'STAY OF DEMOLITION', 'GRANDFATHERED',
  'VARIANCE', 'OVERTIME', 'HARD HAT', 'FINE PRINT', 'LAST STOP', 'SMALL CLAIMS',
];

/** "UNIT 9 — LOOSE PERMIT": slot + seed pick a stable call-sign (a human seat keeps its own name) */
export function botName(slot: number, seed: number): { unit: string; sign: string } {
  let h = Math.imul((seed >>> 0) ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  // the three bots of a match must read as different units: slot spreads the unit number, the hash the call-sign
  const unit = 2 + ((h + slot * 3) % 8);
  const sign = BOT_CALLSIGNS[((h >>> 8) + slot * 5) % BOT_CALLSIGNS.length];
  return { unit: 'UNIT ' + unit, sign };
}

export function fmtMatchClock(s: number): string {
  const t = Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

/** "{a} … {b}" template fill (names are already upper-case) */
export function vsFmt(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** the biome rotation of REMATCH (vs_design.md §11: GRID-EAST → WHITE STACKS → LOCKWATER) */
export const REMATCH_BIOMES = ['grideast', 'whitestacks', 'lockwater'] as const;

/** a titan's short tabloid label for a seat card ("MOLO") */
export function titanTag(id: TitanId): string {
  return id === 'voltkite' ? 'VOLT-KITE' : id.toUpperCase();
}
