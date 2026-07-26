// Colosseum — the dimensional spec for the Flavian Amphitheatre.
//
// Numbers are the real archaeological figures (metres) so the arena reads at
// true scale next to a 1.8 m fighter. Sources agree on these within ~1 m:
//   exterior ellipse ...... 189 x 156, height 48 (4 storeys)
//   arena floor (harena) ..  87 x  55
//   podium wall ...........  ~4 (kept spectators out of reach of the beasts)
//   ground-level arcades ..  80 (76 numbered public + 4 axial ceremonial)
//   capacity .............. ~50,000 (we seat ~24,000 visible + far-tier fill)
//
// Everything downstream (crowd seeding, arch instancing, camera limits, gate
// placement, movement clamping) derives from this one table, so changing a
// dimension here changes the whole building coherently.

export const ARENA = {
  // --- the fighting surface -------------------------------------------------
  floor: {
    a: 43.5,          // semi-major (x) — 87 m across
    b: 27.5,          // semi-minor (z) — 55 m across
    y: 0,             // sand sits at world y=0; everything else is relative
    sandDepth: 0.35,  // visual thickness of the sand bed over the substructure
  },

  // Fighters are clamped just inside the podium so they never clip the wall.
  playable: { margin: 1.6 },

  // --- podium: the sheer wall between sand and the first seats --------------
  podium: {
    height: 4.0,
    thickness: 1.1,
    // Marble facing above a rough travertine base — two bands, one mesh.
    baseBand: 1.2,
  },

  // --- cavea: the four seating tiers ---------------------------------------
  // Each tier is a stepped ellipse. `rows` steps of (rise, run) each, starting
  // at the previous tier's top. A praecinctio (walkway) separates the tiers.
  tiers: [
    // Podium tier — senators, on marble seats, closest and lowest.
    { id: "podium",   rows: 6,  rise: 0.42, run: 0.95, gap: 2.4, seatColor: 0xe8e2d2, density: 0.62, name: "Podium" },
    // Maenianum primum — equestrians.
    { id: "primum",   rows: 14, rise: 0.44, run: 0.80, gap: 2.2, seatColor: 0xd8cfba, density: 0.86, name: "Maenianum Primum" },
    // Maenianum secundum — ordinary citizens, the densest band.
    { id: "secundum", rows: 18, rise: 0.46, run: 0.74, gap: 2.6, seatColor: 0xc9bda4, density: 0.95, name: "Maenianum Secundum" },
    // Summum in ligneis — the wooden gallery, steepest and furthest.
    { id: "summum",   rows: 16, rise: 0.50, run: 0.66, gap: 0.0, seatColor: 0x9d8a6e, density: 0.80, name: "Maenianum Summum" },
  ],

  // --- outer shell: the arcaded facade -------------------------------------
  facade: {
    arches: 80,        // ground-level arcade count (the real building's 80)
    storeys: 3,        // three arcaded storeys + a solid attic
    storeyHeight: 10.5,
    atticHeight: 13.0,
    archWidth: 4.2,
    archHeight: 7.0,
    pierWidth: 2.4,
    // Superimposed orders, bottom to top — Tuscan, Ionic, Corinthian.
    orders: ["tuscan", "ionic", "corinthian"],
    // Statues stood in the arches of the 2nd and 3rd storeys.
    statueStoreys: [1, 2],
  },

  // --- velarium: the retractable awning ------------------------------------
  velarium: {
    masts: 40,          // corbels/masts around the attic
    mastHeight: 7.0,
    coverage: 0.55,     // fraction of the opening the sail ring covers
    innerRatio: 0.42,   // inner opening as a fraction of the attic ellipse
  },

  // --- hypogeum: the two-level basement -------------------------------------
  hypogeum: {
    depth: 6.0,
    // Trapdoors on the arena floor, placed on an inner ellipse. Beast lifts
    // come up through these; each is a pair of hinged leaves.
    lifts: 8,
    liftRadiusRatio: 0.62,   // fraction of the floor semi-axes
    liftSize: { w: 3.2, d: 3.2 },
    liftTravel: 6.0,
    // Corridor walls visible through an open trap.
    wallColor: 0x4a4038,
  },

  // --- the four ceremonial gates -------------------------------------------
  // Angles are measured on the ellipse: 0 = +x (east), PI/2 = +z (south).
  gates: [
    {
      id: "triumphalis",
      name: "Porta Triumphalis",
      theta: Math.PI,          // west end of the major axis — the grand entrance
      width: 7.2, height: 6.4,
      role: "player",
      desc: "The Gate of Triumph. Fighters enter to the crowd's roar.",
    },
    {
      id: "libitinaria",
      name: "Porta Libitinaria",
      theta: 0,                // east end — the dead were dragged out here
      width: 6.0, height: 5.6,
      role: "dead",
      desc: "The Gate of Libitina, goddess of funerals. The dead leave here.",
    },
    {
      id: "beast_north",
      name: "Beast Gate — North",
      theta: -Math.PI / 2,
      width: 5.0, height: 4.6,
      role: "beast",
      desc: "Portcullis to the beast pens.",
    },
    {
      id: "beast_south",
      name: "Beast Gate — South",
      theta: Math.PI / 2,
      width: 5.0, height: 4.6,
      role: "beast",
      desc: "Portcullis to the beast pens.",
    },
  ],

  // --- crowd ----------------------------------------------------------------
  crowd: {
    // Visible instanced spectators. 24k at ~40 tris each is ~1M tris in ONE
    // draw call — comfortably inside budget on a mid GPU, and the far tiers
    // drop to a flattened impostor form in the vertex shader.
    maxInstances: 24000,
    seatPitch: 0.62,      // along-row spacing between spectators
    // Roman crowd palette: undyed wool, ochre, madder red, muted blues.
    palette: [
      0xd9cfbb, 0xc8bda6, 0xb9a98d, 0xe3dbc9, 0xa8926f,
      0x9c5b46, 0xb5734f, 0x7d6a52, 0x6f7a86, 0x8a8f7a,
      0xcbb9a0, 0xaf9c85, 0x8f5f52, 0x6d6455, 0xded5c0,
    ],
  },

  // --- lighting / time of day ----------------------------------------------
  // Games ran through the day; the sun angle sets the shadow that cuts across
  // the sand, which is the single most cinematic thing in the whole scene.
  timeOfDay: {
    morning:  { azimuth: 1.05, elevation: 0.42, sun: 0xffd9a8, ambient: 0x6f7d96, intensity: 2.6, fog: 0xcfc4ac, exposure: 1.05 },
    midday:   { azimuth: 0.30, elevation: 1.18, sun: 0xfff3dc, ambient: 0x8fa0b8, intensity: 3.2, fog: 0xd8cfba, exposure: 1.00 },
    afternoon:{ azimuth: -0.85, elevation: 0.62, sun: 0xffc98a, ambient: 0x7d86a0, intensity: 2.8, fog: 0xd2bfa0, exposure: 1.08 },
    dusk:     { azimuth: -1.35, elevation: 0.20, sun: 0xff9b52, ambient: 0x4e4a68, intensity: 2.1, fog: 0xb08a68, exposure: 1.18 },
  },
};

// Derived once so callers never recompute (and never disagree).
ARENA.playable.a = ARENA.floor.a - ARENA.playable.margin;
ARENA.playable.b = ARENA.floor.b - ARENA.playable.margin;

/** Total seated rows across every tier — used to size the crowd buffers. */
export const TOTAL_ROWS = ARENA.tiers.reduce((n, t) => n + t.rows, 0);

/**
 * Cumulative geometry of the cavea: for each tier, the inner semi-axes and the
 * height at which its first row sits. Walked by both the seating-mesh builder
 * and the crowd seeder so the two can never drift apart.
 */
export function caveaLayout(spec = ARENA) {
  const out = [];
  let a = spec.floor.a + spec.podium.thickness;
  let b = spec.floor.b + spec.podium.thickness;
  let y = spec.podium.height;
  for (const t of spec.tiers) {
    const startA = a, startB = b, startY = y;
    a += t.rows * t.run;
    b += t.rows * t.run;
    y += t.rows * t.rise;
    out.push({ ...t, startA, startB, startY, endA: a, endB: b, endY: y });
    a += t.gap;
    b += t.gap;
  }
  return out;
}
