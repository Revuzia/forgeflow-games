/**
 * CHROMA HIDE — runtime/help_text.js
 * The How to Play content, kept as data so ui.js stays import-free (every module is
 * loaded with a ?v= cache-buster, so a static import there would ship an uncacheable copy).
 */
export const HELP_SECTIONS = [
  {
    "title": "You are a hider",
    "lines": [
      "Press <b>F</b> to paint. Eyedrop a nearby surface with <b>Space</b>, match its colour, then match its finish with the metal and roughness sliders — a glossy body shines wrong against a matt wall.",
      "The panel shows a live <b>colour match %</b>. Above ~85% you are genuinely hard to pick out; below 30% you are a person-shaped stain.",
      "<b>Coverage counts.</b> One dab of the right colour on a white body scores nothing — the whole body is compared against the surface you are standing against."
    ]
  },
  {
    "title": "Hiding",
    "lines": [
      "<b>R</b> cycles eight poses. A flat or balled pose lowers your silhouette so low cover actually hides you; stretching raises it.",
      "<b>E</b> clings to whatever you are facing — a wall, the side of a crate, a desk top, or the floor to lie down. While clung, <b>A</b>/<b>D</b> turn you and <b>Space</b>/<b>Ctrl</b> slide you along the surface.",
      "<b>C</b> drops a decoy wearing your exact paint and pose. A seeker has to spend a bullet to learn it is not you. Two per round.",
      "<b>Movement breaks camouflage</b> — a moving body scores a quarter of its blend. Holding still is the skill."
    ]
  },
  {
    "title": "How hiders score",
    "lines": [
      "You score for <b>every second you spend inside a seeker's line of sight without being caught</b>. Hiding in a cupboard all round scores nothing.",
      "So the loop is deliberate: get seen, don't get identified. Better paint buys you longer in the open.",
      "<b>1</b> whistles to bait a seeker closer for more of that time. Your body also whistles on its own every 45 seconds — you will be told when it does.",
      "Hiders win if at least one survives the timer."
    ]
  },
  {
    "title": "You are a seeker",
    "lines": [
      "<b>LMB</b> shoots. Seeing a hider is not enough — you have to hit them, and your crosshair has to be roughly level.",
      "<b>Ammo is limited.</b> A miss costs a shot, a hit refunds one, and a shot at a moving, exposed target is free. Run every seeker dry and the hiders win.",
      "Camouflage makes a hider take up to <b>4× longer to identify</b> and shrinks the range you can spot them at, so a well-painted body can survive you walking past."
    ]
  },
  {
    "title": "Everything else",
    "lines": [
      "<b>V</b> first/third person · <b>Q</b> emote · <b>Esc</b> pauses · <b>1-4</b> pick a paint tool while painting.",
      "Modes: <b>Normal</b> fixed teams · <b>Infection</b> caught hiders join the hunt · <b>Double</b> everyone hides then everyone hunts, most finds wins · <b>Reverse</b> one hider is revealed and everyone races to find them.",
      "Body size is a real trade: a small build tucks into cover a large one cannot use, a large one banks line-of-sight points faster."
    ]
  }
];
