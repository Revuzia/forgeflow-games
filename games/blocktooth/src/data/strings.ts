// BLOCKTOOTH — every line of on-screen copy (CONTRACT.md §1, §12). ui lane.
// THREE-free, DOM-free data. All copy is ORIGINAL: WARD-7 ("Ward Seven Municipal Alert")
// is a fictional municipal channel; HALVARD CIVIL DEFENSE is the fictional contractor.
// Tone: Saturday-morning monster comic + a panicking municipal news desk. Deadpan civic.
// Templates use {tokens}; fill them with fmt() from ui/dom.ts.

import type { AlertKey, BiomeId, Rarity } from '../core/types.ts';

/** Roman size numerals, index = RankIndex. */
const RANK_NUMERALS = ['I', 'II', 'III', 'IV', 'V'] as const;

export const STR = {
  game: 'BLOCKTOOTH',
  tagline: 'YOU EAT THE STREET. YOU OUTGROW THE BLOCK.',
  network: 'WARD-7',
  networkLong: 'WARD SEVEN MUNICIPAL ALERT',
  bug: 'WARD-7 • LIVE',
  live: 'LIVE',
  specialReport: 'a WARD-7 special report',
  ranks: RANK_NUMERALS,

  /** Broadcast clock start per biome, minutes after midnight (the clock then runs with the sim). */
  clockStart: { grideast: 14 * 60 + 6, whitestacks: 16 * 60 + 48, lockwater: 23 * 60 + 41 } as Record<BiomeId, number>,

  title: {
    band: 'SPECIAL REPORT',
    press: 'PRESS ENTER',
    pressSub: 'OR PRESS Ⓐ · CLICK ANYWHERE',
    standby: 'PLEASE STAND BY',
    legal: 'FOOTAGE UNVERIFIED · WARD SEVEN MUNICIPAL ALERT · RESIDENTS ADVISED TO BE ELSEWHERE',
    crawl: [
      'WARD-7 INTERRUPTS THIS PROGRAM FOR A MATTER OF SOME SIZE',
      'OFFICIALS URGE CALM, THEN LEAVE',
      'SOMETHING IN THE CROSSWALK IS NOT A PEDESTRIAN',
      'HALVARD CIVIL DEFENSE SAYS IT IS "MONITORING THE INVOICE"',
    ],
  },

  /** Open-slate lower thirds. `headline` mirrors BiomeDef.slate (the biome file is canonical). */
  slates: {
    grideast: {
      headline: 'UNIDENTIFIED MASS — DOWNTOWN GRID',
      place: 'GRID-EAST · 5TH & WHOLESALE',
      subs: [
        'SIGHTING: A {species} CALLING ITSELF {name}, STANDING IN THE ZEBRA CROSSING. IT HAS NOT PRESSED THE BUTTON.',
        'SIGHTING: {name}, A {species}, WAITING AT THE CROSSWALK. THE LIGHT IS GREEN. IT IS LOOKING AT THE CARS.',
        'SIGHTING: {name}, A {species}, REPORTED BY A CROSSING GUARD WHO HAS SINCE TAKEN THE AFTERNOON OFF.',
      ],
    },
    whitestacks: {
      headline: 'UNIDENTIFIED MASS — WHITE STACKS',
      place: 'WHITE STACKS · TANK ROW',
      subs: [
        'SIGHTING: {name}, A {species}, IN THE SNOW BETWEEN TANK FARMS 2 AND 3. PLOW CREWS CONFIRM IT IS NOT A DRIFT.',
        'SIGHTING: {name}, A {species}, SNIFFING A SATELLITE DISH. RECEPTION IN THE AREA DESCRIBED AS "WORSE."',
        'SIGHTING: {name}, A {species}, NEAR THE NIGHT-SHIFT GATE. SECURITY HAS WAVED IT THROUGH OUT OF HABIT.',
      ],
    },
    lockwater: {
      headline: 'UNIDENTIFIED MASS — LOCKWATER',
      place: 'LOCKWATER · BERTH 9',
      subs: [
        'SIGHTING: {name}, A {species}, WADING UP BERTH 9 AFTER DARK. HARBOR PATROL HAS STOPPED WAVING AT IT.',
        'SIGHTING: {name}, A {species}, STANDING IN A FLOODED CROSSWALK. THE WALK SIGNAL IS UNDERWATER. SO IS THE WALK.',
        'SIGHTING: {name}, A {species}, INSPECTING A SHIPPING CONTAINER WITH ITS MOUTH. CUSTOMS HAS QUESTIONS.',
      ],
    },
  } as Record<BiomeId, { headline: string; place: string; subs: string[] }>,

  slate: {
    any: 'PRESS ANY KEY',
    freeze: 'FREEZE FRAME',
    breaking: 'BREAKING',
    subject: 'SUBJECT',
    footage: 'VIEWER FOOTAGE · UNVERIFIED',
    cam: 'CAM 3',
  },

  sizeUp: {
    title: 'MASS BREACH',
    size: 'SIZE',
    tag: 'WARD-7 SIZE DESK',
  },

  alertTag: 'WARD-7 ALERT',

  hud: {
    lv: 'LV',
    size: 'SIZE',
    mass: 'MASS',
    massMax: 'CEILING REACHED',
    xp: 'XP',
    hp: 'HP',
    dash: 'DASH',
    hook: 'HOOK',
    ready: 'READY',
    shield: 'SHIELD',
    shell: 'SHELL',
    tonnage: 'TONNAGE',
    tons: 'T',
    blocks: 'BLOCKS',
    crushed: 'CRUSHED',
    levelUp: 'LEVEL UP',
    mutations: 'MUTATIONS ON FILE',
    tickerLabel: 'WARD-7 WIRE',
    tickerLive: 'LIVE',
    runPrefix: 'T+',
    keyHook: 'SPACE',
    keyDash: 'SHIFT',
    /** live wire items the HUD inserts into the crawl when things happen */
    wire: {
      rankUp: 'SIZE {size} CONFIRMED BY THE WARD-7 SIZE DESK',
      block: 'BLOCK {n} FORMALLY RECLASSIFIED AS "OPEN SPACE"',
      elite: 'HALVARD DEPLOYS ITS RAMROD — "IT HAS A VERY LARGE SHOVEL," SAYS SPOKESPERSON',
      boss: 'CONTAINMENT ASSET {boss} EN ROUTE — CITY ASKS IT TO "PLEASE BE CAREFUL WITH THE REST"',
      chest: 'HALVARD SUPPLY CRATE LOST TO SUBJECT; COMPANY LISTS IT AS "DELIVERED"',
    },
  },

  boss: {
    phase: 'PHASE',
    staggered: 'STAGGERED — DOUBLE DAMAGE',
    approaching: 'APPROACHING — CONTAINMENT IN PROGRESS',
    contractor: 'HALVARD CIVIL DEFENSE',
  },

  select: {
    header: 'SUBJECT IDENTIFICATION',
    step1: 'STEP 1 OF 2 · CHOOSE YOUR TITAN',
    step2: 'STEP 2 OF 2 · CHOOSE A DROP ZONE',
    step1Short: 'TITAN',
    step2Short: 'DROP ZONE',
    file: 'SUBJECT FILE',
    zone: 'ZONE FILE',
    confirm: 'CONFIRM',
    dropIn: 'DROP IN',
    back: 'BACK',
    choose: 'CHOOSE',
    auto: 'AUTO',
    hook: 'HOOK',
    dash: 'DASH',
    handling: 'HANDLING',
    difficulty: ['', 'ROUTINE', 'INVOLVED', 'ADVANCED'] as readonly string[],
    containment: 'CONTAINMENT ASSET ON CALL',
    conditions: 'CONDITIONS',
    time: { day: 'DAYTIME', overcast: 'OVERCAST', night: 'NIGHT' } as Record<string, string>,
    weather: { none: 'CLEAR', snow: 'SNOW', rain: 'RAIN' } as Record<string, string>,
    blocks: '{x} × {z} BLOCKS',
    noPortrait: 'NO PHOTO ON FILE',
  },

  draft: {
    title: 'MUTATION REPORT',
    filed: 'FILED BY THE WARD-7 SCIENCE DESK',
    level: 'LEVEL {n} FILING',
    crate: 'RECOVERED HALVARD CRATE — NOTABLE OR BETTER',
    pick: 'FILE ONE',
    reroll: 'REROLL',
    rerollLeft: '{n} LEFT',
    noReroll: 'NO REROLLS LEFT',
    stacks: 'STACKS',
    newTag: 'NEW',
    maxTag: 'FINAL',
    locked: 'SUBJECT-SPECIFIC',
    caseFile: 'CASE 07-{n}',
    rarity: { common: 'ROUTINE', rare: 'NOTABLE', epic: 'ALARMING', legendary: 'CLASSIFIED' } as Record<Rarity, string>,
  },

  pause: {
    title: "WE'LL BE RIGHT BACK",
    sub: 'WARD-7 IS EXPERIENCING A MONSTER',
    resume: 'RESUME',
    settings: 'SETTINGS',
    retry: 'RETRY',
    quit: 'QUIT TO TITLE',
    confirmRetry: 'CONFIRM RETRY — THE CITY WILL BE REBUILT',
    confirmQuit: 'CONFIRM QUIT — THIS BROADCAST WILL END',
    testCard: 'TEST CARD',
    keys: '↑↓ SELECT · ENTER CONFIRM · ESC RESUME',
  },

  settings: {
    title: 'STATION ENGINEERING',
    sub: 'PICTURE & SOUND ADJUSTMENTS',
    master: 'MASTER VOLUME',
    music: 'MUSIC',
    sfx: 'EFFECTS',
    quality: 'PICTURE QUALITY',
    qualityLevels: ['LOW', 'MEDIUM', 'HIGH'] as readonly string[],
    screenShake: 'SCREEN SHAKE',
    reduceFlashing: 'REDUCE FLASHING',
    on: 'ON',
    off: 'OFF',
    done: 'DONE',
    keys: '↑↓ SELECT · ←→ ADJUST · ENTER TOGGLE · ESC DONE',
  },

  tabloid: {
    masthead: 'THE WARD SEVEN WITNESS',
    motto: '"IF IT FELL DOWN, WE WERE THERE"',
    edition: 'LATE CITY EDITION',
    vol: 'VOL. 77 · NO. {n}',
    price: 'ONE TOKEN',
    headline: 'THE CITY GOT SMALLER.',
    extra: 'EXTRA!',
    subClear: [
      'CONTAINMENT ASSET "FULLY DECOMMISSIONED," CONFIRMS NOBODY AT HALVARD',
      'SUBJECT BEATS THE BIG MACHINE, THEN EATS A SMALLER MACHINE TO CELEBRATE',
      'OFFICIALS CONCEDE THE SKYLINE "WAS ALWAYS MORE OF A DRAFT"',
    ],
    subDead: [
      'SUBJECT DOWNED AT LAST; CITY CLAIMS VICTORY ON A TECHNICALITY',
      'CREATURE FINALLY LIES DOWN, ACROSS SEVERAL ADDRESSES',
      'HALVARD CIVIL DEFENSE INVOICES CITY FOR "SUCCESS"',
    ],
    caption: 'ABOVE: {name}, SIZE {size}, PHOTOGRAPHED FROM A DISTANCE THE PHOTOGRAPHER DESCRIBES AS "NOT ENOUGH."',
    noPhoto: 'PHOTO UNAVAILABLE — PHOTOGRAPHER ALSO UNAVAILABLE',
    byline: 'BY THE WITNESS CITY DESK, FROM A SAFE-ISH DISTANCE',
    bodyClear: [
      '{boss} was declared "fully decommissioned" at {time} into the broadcast after what Halvard Civil Defense called "a very large disagreement."',
      '{tons} tons of municipal property were reported "relocated internally." Ward Seven insurers have stopped answering the phone.',
      'The planning department has scheduled a hearing on whether {blocks} blocks can be listed as "a view."',
    ],
    bodyDead: [
      '{name} came to rest at {time} into the broadcast, across an area the parks department has asked to keep.',
      '{tons} tons of municipal property were reported "relocated internally." Ward Seven insurers have stopped answering the phone.',
      'Halvard Civil Defense called the outcome "a win for procedure" and asked residents to disregard the missing streets.',
    ],
    sidebar: [
      'LETTERS: "MY BALCONY WAS A SNACK" — P. 4',
      'WEATHER: FOOTSTEPS, CLEARING LATER',
      'CLASSIFIEDS: SLIGHTLY CHEWED BUS, OBO',
    ],
    numbersTitle: 'BY THE NUMBERS',
    stats: {
      time: 'TIME ON AIR',
      size: 'PEAK SIZE',
      level: 'LEVEL',
      tonnage: 'TONNAGE',
      floors: 'FLOORS EATEN',
      buildings: 'BUILDINGS LEVELED',
      blocks: 'BLOCKS LEVELED',
      crushed: 'UNITS CRUSHED',
      kills: 'UNITS DECOMMISSIONED',
      boss: 'CONTAINMENT',
    },
    bossBeaten: '{boss}: DECOMMISSIONED',
    bossStanding: '{boss}: STILL STANDING ({pct}% INTACT)',
    bossAbsent: 'NOT DEPLOYED',
    retry: 'RETRY',
    select: 'CHANGE TITAN',
    title: 'TITLE',
    keyRetry: 'R',
    keySelect: 'C',
    keyTitle: 'T',
  },
} as const;

/** Full-width broadcast banners (Broadcast.alert). Every AlertKey. */
export const ALERTS: Record<AlertKey, { title: string; sub: string }> = {
  contractors: { title: 'HALVARD CIVIL DEFENSE DEPLOYED', sub: 'CROSSING WARDENS DISPATCHED — PLEASE REMAIN BEHIND THE PAINTED LINE' },
  squads: { title: 'PICKET SQUADS ON SCENE', sub: 'FORMATION ADVISED. FORMATION NOT GUARANTEED.' },
  drones: { title: 'GNAT SWARM AIRBORNE', sub: 'DIVE-BOMBS PAINT A SMALL PINK CIRCLE FIRST — STEP OUT OF IT' },
  vehicles: { title: 'HOPPERS ON THE AVENUES', sub: 'ROCKET PODS ARMED — PINK CIRCLES MEAN MOVE, NOT PARK' },
  armor: { title: 'ARMOR ROLLING IN', sub: 'TORTOISES ADVANCE AT A CIVIC PACE — STAY OUT OF THE PAINTED LANES' },
  artillery: { title: 'STILT MORTARS ON THE SKYLINE', sub: 'SHELLS LOBBED FROM BLOCKS AWAY — WATCH THE SHADOWS ON THE STREET' },
  elite: { title: 'RAMROD DEPLOYED', sub: 'ELITE BREACH-DOZER CHARGING — SIDESTEP THE LANE, CLAIM THE CRATE' },
  boss: { title: 'CONTAINMENT ASSET INBOUND', sub: "HALVARD'S LARGEST INVOICE HAS ARRIVED IN PERSON" },
  bossPhase2: { title: 'CONTAINMENT ESCALATION', sub: 'THE ASSET HAS UNLOCKED NEW PROCEDURES' },
  bossPhase3: { title: 'FINAL CONTAINMENT PROTOCOL', sub: 'EVERYTHING IT HAS, ALL AT ONCE — HOLD YOUR GROUND' },
  lowHp: { title: 'SUBJECT APPEARS WINDED', sub: 'EAT RUBBLE — THE CITY IS ALSO A PANTRY' },
  chest: { title: 'SUPPLY CRATE RECOVERED', sub: 'HALVARD PROPERTY — MUTATION REPORT INCOMING' },
};

/** Size-up sting sub-lines, index = RankIndex (0 = Size I, used on the open slate). */
export const RANK_SUBS: string[] = [
  'SIZE I CONFIRMED — SUBJECT STILL FITS IN A CROSSWALK',
  'SIZE II CONFIRMED — ZONING NO LONGER APPLIES',
  'SIZE III CONFIRMED — SKYLINE PLACED UNDER REVIEW',
  'SIZE IV CONFIRMED — RESIDENTS ADVISED TO BE ELSEWHERE',
  'SIZE V CONFIRMED — THE CITY IS NOW MORE OF A SUGGESTION',
];

/** Bottom crawl headlines (≥ 24, all original, all deadpan). */
export const TICKER: string[] = [
  'COUNCIL VOTES 6–1 TO RECLASSIFY FOOTPRINTS AS "SEASONAL PONDS"',
  'PARKING ENFORCEMENT ISSUES 14 TICKETS TO CREATURE; CREATURE EATS THE TICKETS',
  'TRANSIT AUTHORITY: ALL LINES RUNNING, JUST NOT WHERE THEY USED TO',
  'LIBRARY EXTENDS ALL DUE DATES "UNTIL FURTHER BUILDINGS"',
  'FORECAST: CLEAR SKIES WITH A 90% CHANCE OF ROOF',
  "MAYOR'S OFFICE RELOCATED TO MAYOR'S CAR, THEN TO MAYOR'S BICYCLE",
  'LOCAL MAN REPORTS BEING "STEPPED NEAR"; DESCRIBES EXPERIENCE AS "A LOT"',
  'PLANNING DEPT. APPROVES NEW PARK WHERE THE BANK WAS',
  'SANITATION ASKS RESIDENTS TO SORT RUBBLE BY FLOOR NUMBER',
  'HALVARD CIVIL DEFENSE SHARES UP 40% ON "GROWTH OPPORTUNITIES"',
  'SCHOOLS CLOSED. SCHOOL ALSO CLOSED.',
  'BRIDGE INSPECTORS CONFIRM BRIDGE WAS, AT ONE POINT, A BRIDGE',
  'PIGEONS EVACUATE IN ORDERLY FASHION, SHAMING EVERYONE',
  'INSURERS CLARIFY: "ACT OF NATURE" DOES NOT COVER "ACT OF JAW"',
  'ZOO REPORTS ALL ANIMALS ACCOUNTED FOR, PLUS ONE',
  'RING ROAD TRAFFIC MOVING WELL, MOSTLY AWAY',
  'CITY HALL CLOCK TOWER NOW "MORE OF A CLOCK STUMP"',
  'BAKERY OFFERS 2-FOR-1 ON ANYTHING NOT YET STEPPED ON',
  'SEISMOLOGISTS DOWNGRADE THIS MORNING\'S EARTHQUAKE TO "FOOTSTEP"',
  'ELEVATOR CERTIFICATES NOW VALID FOR "WHATEVER FLOORS REMAIN"',
  'FIRE DEPT. REMINDS PUBLIC THAT HYDRANTS ARE NOT SNACKS',
  'REAL ESTATE: GROUND-FLOOR UNITS NOW ONLY FLOOR UNITS',
  'COMMUTERS ADVISED TO ALLOW EXTRA TIME AND EXTRA DISTANCE',
  'LOST & FOUND RECEIVES ONE (1) BUS, SLIGHTLY CHEWED',
  'OPINION: IS THE CREATURE REALLY SO DIFFERENT FROM A PROPERTY DEVELOPER?',
  'SPORTS: HOME TEAM FORFEITS AFTER STADIUM IS BRIEFLY WORN AS A HAT',
  'CRANE OPERATORS\' UNION ISSUES STATEMENT: "THE BIG ONE IS NOT OURS"',
  'WHITE STACKS PLOW ROUTES SUSPENDED; SNOW ALSO SUSPENDED, IN MID-AIR',
  'HARBORMASTER: LOCKWATER TIDES NOW "MOSTLY STREET"',
  'TOURISM BOARD UNVEILS NEW SLOGAN: "STILL MOSTLY HERE"',
  'NOISE COMPLAINTS UP 3,000%; COMPLAINTS DEPARTMENT BUILDING DOWN 100%',
  'HALVARD SPOKESPERSON: "WE HAVE A PLAN. WE ALSO HAVE A BIGGER PLAN."',
];

/** Comic burst words per event family (fx lane / HUD pops). Keys mirror SimEvent types where one exists. */
export const BURST_WORDS: Record<string, string[]> = {
  smash: ['KRUNCH!', 'SKRAKK!', 'KRAK!', 'CHOMPF!'],
  propDestroyed: ['KRUNCH!', 'PLINK!', 'SKRNCH!', 'KA-TONK!'],
  floorBreak: ['SKRAKK!', 'KRAKOOM!', 'GRONK!'],
  buildingCollapse: ['THOOM!', 'KA-THOOOM!', 'WHUMP!', 'BRRRUMBLE!'],
  bump: ['BONK!', 'DUNK!', 'THUD.'],
  crush: ['SPLNT!', 'SKWONCH!', 'CLANK-BOING!', 'PFLAT!'],
  enemyKilled: ['POP!', 'SPRANG!', 'KLUNK!', 'FZZT!'],
  bite: ['CHOMP!', 'SNAP!', 'GNASH!'],
  arc: ['BZZAK!', 'ZZRAK!', 'KSSHT!'],
  wireDetonate: ['KRA-BZZAK!', 'ZAPPOW!', 'FZZOOM!'],
  pulse: ['WHUMP!', 'THUMM!', 'BWOMP!'],
  stomp: ['THOOM!', 'KA-WHOMP!', 'BLAM!'],
  vent: ['FWASH!', 'WHOOOSH!', 'KA-FWOOM!'],
  vine: ['THWAPP!', 'SWISH-CRACK!', 'WHIPT!'],
  spore: ['PFFFT!', 'POOF!', 'FWUFF!'],
  bloomSpawn: ['SPROING!', 'BLOOP!'],
  dash: ['FWOOSH!', 'ZWIP!', 'VRRMM!'],
  ability: ['FWASH!', 'SHOOMP!', 'KRA-KOOM!'],
  explosion: ['KA-BLAM!', 'BOOM!', 'FWASH!'],
  titanHurt: ['OOF!', 'KLANG!', 'WHAM!'],
  levelUp: ['DING!', 'BRRING!'],
  rankUp: ['GRRROWWW!', 'KA-THUMMM!', 'BIGGER!'],
  bossHit: ['KLANNG!', 'SKRANK!', 'DOONG!'],
  bossStagger: ['KRRRONK!', 'WOBBLE!', 'GRRNNK!'],
  bossDefeated: ['KA-THOOOOM!', 'KRASSSH!', 'TIMBERRR!'],
  pickup: ['TINK!', 'CLINK!', 'PLIK!'],
  chest: ['KA-CHUNK!', 'CLUNK!'],
  generic: ['WHUMP!', 'KRUNCH!', 'THOOM!'],
};
