// BLOCKTOOTH v2 — copy for the v2 screens (FEATURES_V2 §2.5, §7.5, §8.4, §9.3, §13.1). THREE-free data.
// Lane L9 (SCREENS). Every new name here is in the §1 register (GOALS & RECORDS, NEXT PERMIT PENDING,
// YOUR BEST ON FILE, RESTRUCTURED, EXTENDED COVERAGE, IT WOULD NOT LEAVE., KEEP GOING) or is house copy in
// the WARD-7 voice. None of it repeats the reference's copy (§0.7).

export const SCREENS = {
  // ── GOALS & RECORDS entry chip (title + select confirm bars) ──
  goalsChip: 'GOALS & RECORDS',
  goalsKey: 'G',

  // ── select screen (§8.4) ──
  select: {
    bestOnFile: 'YOUR BEST ON FILE: LV {lv} · SIZE {size} · {time}',
    paletteLabel: 'COLOURWAY',
    paletteCanon: 'AS FILMED',
    perkLabel: 'STARTING PERK:',
    perkNone: 'NONE',
    perkNoneDesc: 'No paperwork. Straight to air.',
    lockedBy: 'LOCKED · FILE {goal}',
    rowHint: 'OPTIONS',
    rowHintUp: 'CARDS',
    change: 'CHANGE',
  },

  // ── NEXT PERMIT PENDING slip (§8.4) ──
  permit: {
    header: 'NEXT PERMIT PENDING',
    form: 'FORM 7-P',
    pending: 'PENDING',
    issued: 'ISSUED',
    allIssued: 'EVERY PERMIT ISSUED',
    allIssuedSub: 'THE CLERK HAS NOTHING LEFT TO STAMP.',
    kindCard: 'CARD',
    kindEvo: 'RESTRUCTURE',
    kindPerk: 'PERK',
    kindPalette: 'COLOURWAY',
  },

  // ── GOALS & RECORDS screen (§8.4) ──
  goals: {
    title: 'GOALS & RECORDS',
    sub: 'WARD-7 PERMIT OFFICE · CASE BINDER',
    count: '{n} / {t} GOALS FILED',
    tabs: {
      general: 'GENERAL', molo: 'MOLO', voltkite: 'VOLT-KITE', hearthback: 'HEARTHBACK', briarwick: 'BRIARWICK',
      cities: 'CITIES', records: 'RECORDS',
    } as Record<string, string>,
    filed: 'FILED',
    open: 'OPEN',
    unlocks: 'ISSUES',
    lower: 'BEST {x} · UNDER {y}',
    none: '—',
    recordsHead: 'BROADCAST RECORDS · BEST ON FILE PER SUBJECT AND ZONE',
    recCols: { level: 'LV', size: 'SIZE', clear: 'CLEAR', ext: 'EXTENDED', score: 'SCORE' },
    recEmpty: 'NO BROADCAST',
    keys: '← → TABS · ↑ ↓ ROWS · ESC BACK',
    back: 'BACK',
  },

  // ── draft (§7.5) ──
  draft: {
    charges: 'REROLL {r} · BANISH {b} · LOCK {l}',
    hintsKey: [['1/2/3', 'PICK'], ['R', 'REROLL'], ['X', 'BANISH'], ['C', 'LOCK']] as readonly [string, string][],
    hintsPad: [['A', 'PICK'], ['X', 'REROLL'], ['HOLD Y', 'BANISH'], ['LB', 'LOCK']] as readonly [string, string][],
    banish: 'BANISH',
    banished: 'BANISHED',
    lock: 'LOCK',
    held: 'HELD',
    heldFromLast: 'HELD FROM LAST REPORT',
    evoStamp: 'RESTRUCTURED',
    evolves: 'EVOLVES {base}',
    evoFoot: 'REPLACES {base} · KEEPS {with}',
    newRibbon: 'NEW',
    noBanish: 'NO BANISH LEFT',
    noLock: 'NO LOCK LEFT',
  },

  // ── pause LOADOUT (§13.1) ──
  loadout: {
    title: 'LOADOUT',
    sub: 'EVERY PERMIT ON THE SUBJECT',
    perk: 'STARTING PERK',
    perkNone: 'NONE',
    charges: 'BANISH {b} · LOCK {l} · REROLL {r}',
    empty: 'NO MUTATIONS FILED YET.',
    count: '{n} CARDS',
  },

  // ── settings rows (§13.1) ──
  settings: {
    reduceMotion: 'REDUCE MOTION',
    opening: 'OPENING',
    openingLevels: ['OFF', 'SHORT', 'FULL'] as readonly string[],
  },

  // ── tabloid (§9.1, §9.3, §8.4) ──
  tabloid: {
    keepGoing: 'KEEP GOING',
    keepGoingKey: 'K',
    keepGoingTag: 'EXTENDED COVERAGE',
    endlessKicker: 'EXTENDED COVERAGE EDITION',
    endlessHeadline: 'IT WOULD NOT LEAVE.',
    endlessSubs: 'ON AIR {air} · EXTENDED {ext} · REMATCHES WON {n} · SCORE {score}',
    endlessStamp: 'OFF AIR',
    newRecordTitle: 'NEW ON THE RECORD',
    newRecordUnlock: 'ISSUED: {unlock} — NEXT RUN',
    recExt: 'LONGEST EXTENDED',
    recScore: 'TOP SCORE',
    recRematches: 'REMATCHES WON',
  },
} as const;
