// Colosseum — the fighting population, and the rules of the munus.
//
// Grounded in the actual scholarship, which contradicts the popular picture in
// several ways this game deliberately gets right. The corrections that shaped
// this file:
//
//  * PAIRINGS WERE ENGINEERED, NOT RANDOM. Combatants were matched
//    different-but-equivalent: big shield against small shield, reach against
//    armour. Four types fought ONLY their own kind (provocator, eques,
//    essedarius, paegniarius).
//  * THE RETIARIUS DID NOT NORMALLY FIGHT THE MURMILLO. The secutor was
//    invented as his counter — a murmillo with a smooth featureless helmet so
//    the net has nothing to catch.
//  * ETHNIC TYPES WERE COSTUMES, NOT ETHNICITIES. A captured Dacian was
//    retrained into a standard Roman armatura; he did not fight in native kit.
//    Samnite and Gallus had died out before the Colosseum was built. So origin
//    lives here as BACKGROUND — name, look, crowd reaction — never as a
//    separate fighting style. (This is the honest version of "slaves from
//    other countries".)
//  * NOXII WERE NOT GLADIATORS and did not fight them; they were executed at
//    midday, between the morning beasts and the afternoon bouts.
//  * BESTIARII AND VENATORES WERE NOT GLADIATORS either — a separate school
//    (the Ludus Matutinus). Beast work is its own career track.
//  * MOST BOUTS DID NOT END IN DEATH. Missio was the norm; roughly a 1-in-10
//    chance of death per gladiator per bout in the 1st century.
//  * IT WAS A REFEREED SPORT. The summa rudis could caution, separate, pause
//    for rest, or stop a bout outright.
//  * THE SURRENDER SIGNAL WAS AD DIGITUM — the beaten man raises a FINGER.
//    "Thumbs down = death" is not established; pollice verso is too vague to
//    reconstruct, and the leading argument runs the opposite way.

// ---------------------------------------------------------------------------
// Armaturae
// ---------------------------------------------------------------------------

/**
 * `loadout` maps to weapons.js ids. `pairs` lists canonical opponents.
 * `mirrorOnly` marks the four types that historically fought only their own kind.
 */
export const ARMATURA_ROSTER = {
  murmillo: {
    id: "murmillo", name: "Murmillo", class: "scutarius",
    loadout: { weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae"] },
    pairs: ["thraex", "hoplomachus"], style: "pressure",
    helmetCrest: 0x8e2f22,
    blurb: "A legionary in arena dress. Walks you down behind a body-length shield.",
    weakness: "Only ONE greave, on the shield leg. The right leg is the standing target.",
    attested: "high",
  },
  secutor: {
    id: "secutor", name: "Secutor", class: "scutarius",
    loadout: { weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae", "lorica"] },
    pairs: ["retiarius"], style: "pressure",
    helmetCrest: 0x6f6a5c, smoothHelm: true,
    blurb: "The pursuer — built for one job: catch the net-man. Smooth helm, nothing to snag.",
    weakness: "Two tiny eye-holes and no airflow. He is on a timer and he knows it.",
    attested: "high",
  },
  retiarius: {
    id: "retiarius", name: "Retiarius", class: "rete",
    loadout: { weapon: "trident", shield: "none", armour: ["manica"] },
    pairs: ["secutor"], style: "spacer",
    galerus: true,
    blurb: "Net, trident and a bare head. Wins at reach, dies the moment he is cornered.",
    weakness: "Unarmoured above the left shoulder. One clean hit ends him.",
    attested: "high",
  },
  thraex: {
    id: "thraex", name: "Thraex", class: "parmularius",
    loadout: { weapon: "sica", shield: "parmula", armour: ["galea", "manica", "ocreae"] },
    pairs: ["murmillo", "hoplomachus"], style: "flanker",
    helmetCrest: 0x7d6a52, griffinCrest: true,
    blurb: "The hooker. A curved sica made to reach AROUND a shield onto the shoulder behind it.",
    weakness: "The parmula covers almost nothing. Let a murmillo inside and it is over.",
    attested: "high",
  },
  hoplomachus: {
    id: "hoplomachus", name: "Hoplomachus", class: "parmularius",
    loadout: { weapon: "hasta", shield: "parmula", armour: ["galea", "manica", "ocreae"] },
    pairs: ["murmillo", "thraex"], style: "spacer",
    helmetCrest: 0x6f7a86, twoPhase: true,
    blurb: "Spear first, then sword and buckler. A pseudo-Greek hoplite against a pseudo-Roman.",
    weakness: "Phase two is desperate — a tiny shield and a short blade against a scutum.",
    attested: "high",
  },
  provocator: {
    id: "provocator", name: "Provocator", class: "scutarius",
    loadout: { weapon: "gladius", shield: "scutum", armour: ["galea", "manica", "ocreae"] },
    pairs: ["provocator"], mirrorOnly: true, style: "pressure",
    helmetCrest: 0x9c8760, cardiophylax: true,
    blurb: "The closest thing to a real legionary duel — and the one type that fought only itself.",
    weakness: "No asymmetry to exploit. Whoever tires first loses.",
    attested: "high",
  },
  dimachaerus: {
    id: "dimachaerus", name: "Dimachaerus", class: "duo",
    loadout: { weapon: "dimachaerus", shield: "none", armour: ["manica", "ocreae"] },
    pairs: ["thraex", "murmillo", "dimachaerus"], style: "aggressor",
    blurb: "Two blades, no shield. Every parry is made with steel and nerve.",
    weakness: "Nothing between him and a mistake.",
    attested: "medium",
  },
  eques: {
    id: "eques", name: "Eques", class: "mounted",
    loadout: { weapon: "hasta", shield: "parmula", armour: ["galea", "manica"] },
    pairs: ["eques"], mirrorOnly: true, style: "spacer", mounted: true,
    blurb: "Enters on horseback with a lance, dismounts to finish with the sword. Opened the day's card.",
    weakness: "Unhorsed, he is a lightly-armoured swordsman.",
    attested: "high",
  },
  minotaur: {
    id: "minotaur", name: "The Bull of Knossos", class: "spectacle",
    loadout: { weapon: "spatha", shield: "none", armour: [] },
    pairs: [], style: "pressure",
    blurb: "A staged mythological pageant: a giant in a bull mask billed as the Minotaur, armed with a cleaving blade. The mob adores the theatre.",
    weakness: "No shield, no armour — everything is committed to the blow.",
    attested: "theatrical",
  },
  scissor: {
    id: "scissor", name: "Scissor", class: "specialist",
    loadout: { weapon: "sica", shield: "none", armour: ["galea", "manica", "lorica"] },
    pairs: ["retiarius"], style: "pressure",
    blurb: "An armoured tube on the left arm ending in a crescent blade. Parries the trident and cuts the net.",
    weakness: "Reconstructed from thin evidence — and slow.",
    attested: "low",
  },
  paegniarius: {
    id: "paegniarius", name: "Paegniarius", class: "interval",
    loadout: { weapon: "rudis", shield: "none", armour: [] },
    pairs: ["paegniarius"], mirrorOnly: true, style: "flanker",
    blurb: "The midday interval act — blunt wood, no armour, no blood. Where a tiro learns the guard.",
    weakness: "Nothing to hide behind, and nothing that can kill you.",
    attested: "high",
  },
  crupellarius: {
    id: "crupellarius", name: "Crupellarius", class: "specialist",
    loadout: { weapon: "gladius", shield: "none", armour: ["galea", "manica", "ocreae", "lorica"] },
    pairs: ["murmillo", "dimachaerus"], style: "pressure",
    blurb: "Gaulish, encased head to foot in iron. An immovable object that wins by outlasting.",
    weakness: "No agility whatsoever. Exhaust him and he cannot answer.",
    attested: "low",
  },
};

/** The four types that only ever met their own kind. */
export const MIRROR_ONLY = Object.values(ARMATURA_ROSTER).filter((a) => a.mirrorOnly).map((a) => a.id);

/**
 * Canonical cards, in rough order of how often they actually appear in the
 * evidence. `contested` flags the one the iconography argues against.
 */
export const CANONICAL_PAIRINGS = [
  { a: "murmillo", b: "thraex", note: "THE duel of the 1st century — big shield against small shield." },
  { a: "retiarius", b: "secutor", note: "The famous one, and the only case where an armatura was invented as a counter." },
  { a: "murmillo", b: "hoplomachus", note: "The reach duel: spear phase, then a desperate close." },
  { a: "thraex", b: "hoplomachus", note: "Two parmularii — decided purely by weapon geometry, curve against point." },
  { a: "provocator", b: "provocator", note: "The mirror match. Symmetry instead of asymmetry." },
  { a: "eques", b: "eques", note: "Mounted openers, bright tunics, a clean two-phase spectacle." },
  { a: "retiarius", b: "murmillo", note: "CONTESTED — literary sources say yes, the iconography overwhelmingly says secutor.", contested: true },
];

// ---------------------------------------------------------------------------
// Origins — background, NOT a fighting style
// ---------------------------------------------------------------------------

/**
 * Where a fighter came from. Captives were retrained into Roman armaturae, so
 * origin changes a fighter's NAME, LOOK and how the crowd receives him — never
 * his kit. Getting this right is the difference between history and costume.
 */
export const ORIGINS = {
  thracian:  { id: "thracian",  name: "Thracian",  region: "Thrace",            skin: 0xd8b48c, hair: 0x3b2a1c, crowd: 0.05, names: ["Spiculus", "Zeuxis", "Bato", "Rhescuporis", "Auluporis"] },
  gaul:      { id: "gaul",      name: "Gaul",      region: "Gallia",            skin: 0xe2c19a, hair: 0xa8703a, crowd: 0.0,  names: ["Crixus", "Oenomaus", "Vercingetorix", "Diviciacus", "Ambiorix"] },
  german:    { id: "german",    name: "German",    region: "Germania",          skin: 0xe6c8a4, hair: 0xc9a24a, crowd: 0.0,  names: ["Arminius", "Segestes", "Chariovalda", "Marbod", "Inguiomer"] },
  dacian:    { id: "dacian",    name: "Dacian",    region: "Dacia",             skin: 0xd9b489, hair: 0x4a3320, crowd: 0.08, names: ["Decebalus", "Diegis", "Bicilis", "Susagus"] },
  briton:    { id: "briton",    name: "Briton",    region: "Britannia",         skin: 0xe8cba8, hair: 0xb35c2a, crowd: 0.1,  names: ["Caratacus", "Togodumnus", "Venutius", "Cogidubnus"] },
  numidian:  { id: "numidian",  name: "Numidian",  region: "Numidia",           skin: 0x8a5a34, hair: 0x1d1410, crowd: 0.05, names: ["Jugurtha", "Masinissa", "Gulussa", "Hiempsal"] },
  syrian:    { id: "syrian",    name: "Syrian",    region: "Syria",             skin: 0xc79a68, hair: 0x241a12, crowd: 0.0,  names: ["Antiochus", "Zabdas", "Odaenathus", "Malichus"] },
  greek:     { id: "greek",     name: "Greek",     region: "Achaea",            skin: 0xd6ac82, hair: 0x2b1e14, crowd: 0.05, names: ["Kallistratos", "Nikanor", "Theron", "Demetrios"] },
  egyptian:  { id: "egyptian",  name: "Egyptian",  region: "Aegyptus",          skin: 0xa9723f, hair: 0x181110, crowd: 0.0,  names: ["Petosiris", "Harmais", "Amenhotep", "Psenamun"] },
  roman:     { id: "roman",     name: "Roman",     region: "Italia",            skin: 0xdfb68f, hair: 0x33241a, crowd: 0.15, names: ["Flamma", "Priscus", "Verus", "Tetraites", "Columbus", "Hermes"] },
};

// ---------------------------------------------------------------------------
// Named champions — boss bouts
// ---------------------------------------------------------------------------

/**
 * Real attested figures where possible. Flamma's tombstone at Lilybaeum is the
 * best-documented career on record; Priscus and Verus are named by Martial as
 * the pair who fought to a standing draw and were BOTH freed at Titus's games.
 */
export const CHAMPIONS = [
  {
    id: "tetraites", name: "Tetraites", armatura: "murmillo", origin: "gaul",
    rank: "veteranus", skill: "veteranus", hpMult: 1.15,
    title: "The Painted Name",
    blurb: "His victories were painted on cups sold as far as Britain and Gaul. He fights like a man who knows he is already famous.",
    attested: "Named on glass vessels found across the western provinces.",
    trait: "relentless",
  },
  {
    id: "spiculus", name: "Spiculus", armatura: "thraex", origin: "thracian",
    rank: "primus", skill: "primus", hpMult: 1.2,
    title: "Nero's Favourite",
    blurb: "Nero gave him palaces and estates. He fights with the ease of a man with nothing left to prove.",
    attested: "Suetonius records Nero's lavish gifts to him.",
    trait: "duelist",
  },
  {
    id: "verus", name: "Verus", armatura: "secutor", origin: "roman",
    rank: "primus", skill: "primus", hpMult: 1.2,
    title: "Of the Inaugural Games",
    blurb: "Half of the most famous bout ever fought. He does not tire and he does not yield.",
    attested: "Martial, De Spectaculis 29 — the draw with Priscus at Titus's games.",
    trait: "iron",
    pairedWith: "priscus",
  },
  {
    id: "priscus", name: "Priscus", armatura: "murmillo", origin: "gaul",
    rank: "champion", skill: "champion", hpMult: 1.25,
    title: "Of the Inaugural Games",
    blurb: "The other half. Titus freed them both rather than choose between them.",
    attested: "Martial, De Spectaculis 29.",
    trait: "iron",
    pairedWith: "verus",
  },
  {
    id: "flamma", name: "Flamma", armatura: "secutor", origin: "syrian",
    rank: "champion", skill: "champion", hpMult: 1.35,
    title: "Who Refused the Rudis",
    blurb: "Thirty-four fights. Twenty-one wins, nine draws, four defeats survived. Offered freedom four times and refused it every time.",
    attested: "Funerary inscription at Lilybaeum, Sicily — the best-documented gladiator career we have.",
    trait: "unyielding",
  },
  {
    id: "commodus", name: "Commodus", armatura: "secutor", origin: "roman",
    rank: "legend", skill: "legend", hpMult: 1.5,
    title: "The Emperor on the Sand",
    blurb: "An emperor who fought in his own arena and was never permitted to lose. The crowd cheers because it must.",
    attested: "Cassius Dio and the Historia Augusta record his arena appearances.",
    trait: "emperor",
  },
];

// ---------------------------------------------------------------------------
// The venatio
// ---------------------------------------------------------------------------

/** `asset` refers to assets/beasts/<asset>.glb; null means not yet available. */
export const BEAST_ROSTER = [
  { id: "tiger",     name: "Tiger",     asset: "tiger",   profile: "tiger",   tier: 1, origin: "India / Persia", note: "The best-documented cat in the arena after the lion." },
  { id: "panther",   name: "Panther",   asset: "panther", profile: "panther", tier: 1, origin: "Africa",         note: "Fast, nervous, hit-and-run." },
  { id: "lion",      name: "Lion",      asset: null,      profile: "lion",    tier: 2, origin: "Numidia",        note: "The signature beast of the games. Asset needs a primitive merge and borrowed clips." },
  { id: "boar",      name: "Boar",      asset: null,      profile: "tiger",   tier: 1, origin: "Italy / Gaul",   note: "Common venatio quarry. Asset on F: needs a merge." },
  { id: "bison",     name: "Aurochs",   asset: "bison",   profile: "bison",   tier: 2, origin: "Germania",       note: "A real staged body with its own charge — no longer a tiger wearing a bull's name." },
  { id: "crocodile", name: "Crocodile", asset: null,      profile: "panther", tier: 3, origin: "Aegyptus",       note: "Staged in flooded arenas. Asset needs a merge." },
];

// ---------------------------------------------------------------------------
// Rules of the munus
// ---------------------------------------------------------------------------

export const MUNUS = {
  /** The order of a real day's programme. */
  programme: [
    { id: "pompa",     name: "Pompa",              time: "morning", desc: "The procession. Fighters parade; the crowd picks favourites before a blow is struck." },
    { id: "venatio",   name: "Venatio",            time: "morning", desc: "The beast hunt. Venatores and bestiarii — a separate profession from the gladiators." },
    { id: "meridiani", name: "Meridiani",          time: "midday",  desc: "The executions. Noxii, not gladiators. Most of the audience went to lunch." },
    { id: "munera",    name: "Munera Gladiatoria", time: "afternoon", desc: "The main card. Engineered pairs, a referee, and a crowd that decides who lives." },
  ],

  /** Surrender and reprieve — using the signal that is actually attested. */
  surrender: {
    signal: "ad digitum",
    desc: "A beaten fighter raises one finger to the summa rudis. The referee steps in and the editor decides.",
    missioChance: 0.9,
    note: "Missio was the norm. Trained gladiators were expensive; roughly 1 in 10 bouts ended in a death.",
  },

  /** The referee is a real actor in the fight, not set dressing. */
  referee: {
    title: "Summa Rudis",
    powers: ["caution", "separate", "pause for rest", "stop the bout"],
    note: "The Zliten mosaic shows a referee physically restraining a winner from the killing blow.",
  },

  awards: [
    { id: "palma",  name: "Palm of Victory", desc: "Awarded for a win.", gold: 0 },
    { id: "corona", name: "Corona",          desc: "For an exceptional performance.", gold: 120 },
    { id: "rudis",  name: "Rudis",           desc: "The wooden sword. Freedom.", gold: 0, endsCareer: true },
  ],
};

// ---------------------------------------------------------------------------
// Match types
// ---------------------------------------------------------------------------

export const MATCH_TYPES = {
  single:     { id: "single",     name: "Single Pair",   desc: "One canonical pairing, as the games intended." },
  duo:        { id: "duo",        name: "2 v 2",         desc: "Two pairs on the sand at once. Attested as gregatim — group fighting." },
  team:       { id: "team",       name: "Team Munus",    desc: "Troupe against troupe. The editor bought a spectacle, not a duel." },
  handicap:   { id: "handicap",   name: "1 v 2",         desc: "One fighter against two. A punishment card, or a chance to make a name." },
  tertiarius: { id: "tertiarius", name: "Tertiarius",    desc: "Win, and a fresh unadvertised third fighter walks out to meet you." },
  survival:   { id: "survival",   name: "Sine Missione", desc: "Wave after wave, no reprieve. Officially banned under Augustus — which is why the crowd loves it." },
  venatio:    { id: "venatio",    name: "Venatio",       desc: "The beast hunt. They come up out of the hypogeum." },
  joust:      { id: "joust",      name: "Eques Tilt",     desc: "Mounted openers. Lances at the gallop down the barrier; unhorse him or out-point him in six passes." },
  spectacle:  { id: "spectacle",  name: "Myth Pageant",   desc: "The editor stages the old stories with living men. Tonight: the labyrinth's bull." },
  // Gladiators normally fought paired — ORDINARII. Sometimes they were sent in
  // as CATERVARII, "in tumultuous bodies", without science: several mutually
  // hostile parties on the sand at once, every man for his own side. It is the
  // one attested format where being outnumbered is the point rather than a
  // mistake, and where the pressure on any one fighter divides because
  // everybody else has their own enemy to worry about.
  catervarii: { id: "catervarii", name: "Catervarii",    desc: "Not a pairing — a melee. Several parties, all hostile, and the sand decides." },
  pons:       { id: "pons",       name: "The Pons",      desc: "A retiarius on a raised bridge with a pile of stones, against two secutores below. An attested spectacle variant." },
  champion:   { id: "champion",   name: "Named Bout",    desc: "A champion whose name the crowd already knows." },
  paegniarius:{ id: "paegniarius",name: "Paegniarii",    desc: "Blunted weapons, played for laughs in the midday interval. Nobody dies." },
};

/**
 * Build the campaign ladder. Generated rather than hand-listed so the
 * canonical pairings stay authoritative and a rebalance is one edit.
 */
export function buildLadder() {
  const L = [];
  const add = (m) => { L.push({ ...m, index: L.length + 1, id: m.id || `match_${L.length + 1}` }); };

  // --- Tiro: learn the trade -------------------------------------------
  add({ id: "t1", rank: "tiro", type: "paegniarius", name: "Wooden Swords", opponents: [{ armatura: "paegniarius", skill: "tutor" }], purse: 40, lethal: false,
        desc: "Blunted weapons in the midday interval. Nobody dies. Learn the guard." });
  add({ id: "t2", rank: "tiro", type: "single", name: "First Sand", opponents: [{ armatura: "thraex", skill: "tiro" }], purse: 60,
        desc: "A thraex, as tired and frightened as you are." });
  add({ id: "t3", rank: "tiro", type: "venatio", name: "The Hunt Begins", beasts: ["panther"], purse: 75,
        desc: "A panther out of the hypogeum. Fast, and it will not stand and trade." });
  add({ id: "t4", rank: "tiro", type: "single", name: "Small Shield", opponents: [{ armatura: "hoplomachus", skill: "tiro" }], purse: 80,
        desc: "A spear that reaches you before you reach him." });

  // --- Gregarius: the canonical cards ----------------------------------
  add({ id: "g1", rank: "gregarius", type: "single", name: "Scutum and Sica", opponents: [{ armatura: "thraex", skill: "gregarius" }], purse: 110,
        desc: "The duel of the age: big shield against the curved blade that goes around it." });
  add({ id: "g2", rank: "gregarius", type: "venatio", name: "Striped Death", beasts: ["tiger"], purse: 130,
        desc: "A tiger. It will circle until you are tired, then cover six metres in a blink." });
  add({ id: "g3", rank: "gregarius", type: "duo", name: "Gregatim", opponents: [{ armatura: "thraex", skill: "gregarius" }, { armatura: "hoplomachus", skill: "tiro" }], ally: { armatura: "murmillo", skill: "gregarius" }, purse: 160,
        desc: "Two pairs on the sand at once. Your partner is not your friend, only your side." });
  add({ id: "g4", rank: "gregarius", type: "single", name: "The Net", opponents: [{ armatura: "retiarius", skill: "gregarius" }], purse: 150,
        desc: "Reach, evasion and one throw that ends it. Corner him." });
  add({ id: "g5", rank: "gregarius", type: "champion", name: "Tetraites", champion: "tetraites", purse: 240,
        desc: "His name is painted on cups sold as far as Britain." });

  add({ id: "j1", rank: "gregarius", type: "joust", name: "The Opening Card", joust: { skill: 0.3, name: "Vespillo" }, purse: 150,
        desc: "The equites open the day. Six passes down the tilt; keep the lance couched late." });

  // --- Veteranus: pressure ----------------------------------------------
  add({ id: "v1", rank: "veteranus", type: "single", name: "The Pursuer", opponents: [{ armatura: "secutor", skill: "veteranus" }], purse: 190,
        desc: "Smooth helm, two eye-holes, no intention of letting you breathe." });
  add({ id: "v2", rank: "veteranus", type: "handicap", name: "Two Against One", opponents: [{ armatura: "thraex", skill: "gregarius" }, { armatura: "dimachaerus", skill: "gregarius" }], purse: 260,
        desc: "A punishment card. Survive it and the crowd will remember." });
  add({ id: "v3", rank: "veteranus", type: "venatio", name: "Numidian Lion", beasts: ["lion"], purse: 250,
        desc: "The signature beast of the games. Heavier than the tiger and far less patient." });
  add({ id: "v4", rank: "veteranus", type: "tertiarius", name: "The Substitute", opponents: [{ armatura: "murmillo", skill: "veteranus" }], tertiarius: { armatura: "provocator", skill: "veteranus" }, purse: 300,
        desc: "Win, and a fresh man you were never told about walks out of the gate." });
  add({ id: "v5", rank: "veteranus", type: "champion", name: "Spiculus", champion: "spiculus", purse: 380,
        desc: "Nero gave him palaces. He fights like a man with nothing to prove." });

  add({ id: "j2", rank: "veteranus", type: "joust", name: "Lances at Noon", joust: { skill: 0.55, name: "Celadus" }, purse: 260,
        desc: "A veteran eques with a straight back and a patient couch." });

  // --- Primus Palus: spectacle ------------------------------------------
  add({ id: "p1", rank: "primus", type: "team", name: "Troupe Against Troupe", opponents: [{ armatura: "murmillo", skill: "primus" }, { armatura: "thraex", skill: "veteranus" }, { armatura: "hoplomachus", skill: "veteranus" }], allies: [{ armatura: "secutor", skill: "veteranus" }, { armatura: "dimachaerus", skill: "veteranus" }], purse: 420,
        desc: "The editor did not buy a duel. He bought a battle." });
  add({ id: "p2", rank: "primus", type: "pons", name: "The Bridge", opponents: [{ armatura: "secutor", skill: "primus" }, { armatura: "secutor", skill: "veteranus" }], purse: 460,
        desc: "A retiarius on a raised bridge with a pile of stones, and two secutores climbing toward him." });
  add({ id: "p3", rank: "primus", type: "survival", name: "Sine Missione", waves: 5, purse: 520,
        desc: "No reprieve. Augustus banned this. The crowd never forgave him." });
  add({ id: "p4", rank: "primus", type: "champion", name: "Verus", champion: "verus", purse: 560,
        desc: "Half of the most famous bout ever fought." });

  add({ id: "j3", rank: "primus", type: "joust", name: "The Emperor's Eques", joust: { skill: 0.85, name: "Incitatus" }, purse: 420,
        desc: "He has never been unhorsed. The crowd comes early just to watch him mount." });

  add({ id: "m1", rank: "primus", type: "spectacle", name: "The Bull of Knossos", opponents: [{ armatura: "minotaur", skill: "primus" }], purse: 380,
        desc: "A myth staged in sand and blood: a giant in the bull mask, billed as the Minotaur. The crowd knows it is theatre. The blade is not." });

  // --- Champion ----------------------------------------------------------
  add({ id: "c1", rank: "champion", type: "single", name: "Iron Gaul", opponents: [{ armatura: "crupellarius", skill: "champion" }], purse: 600,
        desc: "Encased head to foot in iron. You cannot hurt him quickly. Make him carry it." });
  add({ id: "c2", rank: "champion", type: "venatio", name: "The Aurochs", beasts: ["bison"], purse: 620,
        desc: "Germania sent something that does not circle and does not stop." });
  add({ id: "c3", rank: "champion", type: "team", name: "The Great Munus", opponents: [{ armatura: "secutor", skill: "champion" }, { armatura: "murmillo", skill: "primus" }, { armatura: "retiarius", skill: "primus" }, { armatura: "thraex", skill: "primus" }], allies: [{ armatura: "murmillo", skill: "primus" }, { armatura: "hoplomachus", skill: "primus" }], purse: 750,
        desc: "Four against three. The editor is spending a fortune and expects blood for it." });
  // --- Catervarii: the free-for-all -------------------------------------
  // Two rival parties AND the player, all mutually hostile. Nobody is anyone's
  // ally: the two AI factions fight each other as readily as they fight you,
  // which is precisely what makes being outnumbered survivable — the incoming
  // attention divides instead of all landing on one man.
  add({ id: "k1", rank: "gregarius", type: "catervarii", name: "Tumultuous Bodies",
        factions: [[{ armatura: "thraex", skill: "tiro" }],
                   [{ armatura: "murmillo", skill: "tiro" }]],
        purse: 200,
        desc: "Three on the sand and no pairing. Let them find each other first." });
  add({ id: "k2", rank: "veteranus", type: "catervarii", name: "The Scattered School",
        factions: [[{ armatura: "hoplomachus", skill: "gregarius" }, { armatura: "thraex", skill: "tiro" }],
                   [{ armatura: "dimachaerus", skill: "gregarius" }, { armatura: "retiarius", skill: "tiro" }]],
        purse: 420,
        desc: "Two troupes turned loose at once. Five men, three sides, one door out." });
  // 3-vs-3. Not a scatter of four parties — two troupes and a line, which is
  // what a catervarii actually was when the editor wanted a spectacle rather
  // than a scramble. The player fights WITH two and against three.
  add({ id: "k3", rank: "champion", type: "catervarii", name: "Troupe Against Troupe",
        allies: [{ armatura: "murmillo", skill: "veteranus" }, { armatura: "hoplomachus", skill: "veteranus" }],
        factions: [[{ armatura: "secutor", skill: "veteranus" },
                    { armatura: "crupellarius", skill: "gregarius" },
                    { armatura: "thraex", skill: "veteranus" }]],
        purse: 900,
        desc: "Three a side. Pick your man, trust the two beside you, and do not get surrounded." });

  add({ id: "c4", rank: "champion", type: "champion", name: "Priscus", champion: "priscus", purse: 800,
        desc: "The other half of the draw that Titus refused to break." });

  // --- Legend -------------------------------------------------------------
  add({ id: "l1", rank: "legend", type: "survival", name: "Thirty-Four Fights", waves: 8, purse: 1000,
        desc: "Flamma's record, compressed into one afternoon." });
  add({ id: "l2", rank: "legend", type: "champion", name: "Flamma", champion: "flamma", purse: 1200,
        desc: "Offered the rudis four times. Refused it four times. He does not understand surrender." });
  add({ id: "l3", rank: "legend", type: "champion", name: "The Emperor", champion: "commodus", purse: 1600,
        desc: "He has never been permitted to lose. The crowd cheers because it must." });

  return L;
}

export const LADDER = buildLadder();

/** Pick a historically defensible opponent for a given player armatura. */
export function canonicalOpponent(playerArmaturaId, rng = Math.random) {
  const a = ARMATURA_ROSTER[playerArmaturaId];
  if (!a) return "thraex";
  if (a.mirrorOnly) return a.id;
  const pool = (a.pairs || []).filter((p) => p !== a.id);
  return pool.length ? pool[Math.floor(rng() * pool.length)] : "thraex";
}

/**
 * A named, origin-flavoured opponent. Origin is background, never a style.
 *
 * `taken` is a Set of names already used this match. Without it two fighters on
 * the same sand can share a name — with only 4-5 names per origin a 6-man team
 * bout collides often, and "Marbod kills Marbod" destroys the fiction instantly.
 */
export function makeOpponent(armaturaId, { skill = "gregarius", originId = null, rng = Math.random, taken = null } = {}) {
  const a = ARMATURA_ROSTER[armaturaId] || ARMATURA_ROSTER.thraex;
  const keys = Object.keys(ORIGINS);
  let origin = ORIGINS[originId] || ORIGINS[keys[Math.floor(rng() * keys.length)]];

  let name = origin.names[Math.floor(rng() * origin.names.length)];
  if (taken) {
    // Try this origin's remaining names, then any origin, then add a cognomen.
    let tries = 0;
    while (taken.has(name) && tries < 60) {
      tries++;
      if (tries > 24) origin = ORIGINS[keys[Math.floor(rng() * keys.length)]];
      name = origin.names[Math.floor(rng() * origin.names.length)];
    }
    if (taken.has(name)) {
      const cognomina = ["Maior", "Minor", "Secundus", "Tertius", "Ferox", "Celer", "Niger"];
      name = `${name} ${cognomina[Math.floor(rng() * cognomina.length)]}`;
    }
    taken.add(name);
  }
  return {
    name, armatura: a.id, armaturaName: a.name,
    origin: origin.id, originName: origin.name, region: origin.region,
    skin: origin.skin, hair: origin.hair, crowdBias: origin.crowd,
    loadout: { ...a.loadout }, style: a.style, skill,
    blurb: `${name} of ${origin.region} — trained to the ${a.name}.`,
  };
}
