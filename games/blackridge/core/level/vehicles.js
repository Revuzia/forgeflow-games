// core/level/vehicles.js [A3] — HERO-GRADE prop silhouettes for the three
// asset families a cold critic keeps calling placeholder geometry.
//
// WHY THIS FILE EXISTS (iter06 cold-critic verdict, ranked fix #2, 3/3 critics
// AND all three blind verdicts):
//   "a flat faceted teal/blue solid with a plain grey cylinder for a wheel and
//    zero texture" (critic-a) / "the teal sedan and the smooth black ellipsoid"
//    (critic-b) / "a flat teal low-poly wedge on grey cylinder wheels" (c).
//   Sandbags: "smooth olive lozenges" / "identical lumpy sandbag potatoes" /
//   "untextured tan lumps" — wording UNCHANGED from iter05 despite a verified
//   hessian weave.  And critic-c's first blind-verdict item, "the untextured
//   clay ramp filling the lower-left of S1", was measured live this session to
//   be `props_car` INSTANCE 5 AT 2.09 m — not a ramp at all.  A car two metres
//   from the eye is a hero prop and was being drawn as a wedge.
//
// THE ROOT DEFECT IS MESH, NOT MATERIAL.  iter06 textured these assets and the
// texture landed (nobody says "white clay" any more); the SILHOUETTE wave never
// happened.  The cc0-city vehicle GLBs carry one undifferentiated `body` mesh:
// no door shutlines, no window frames, no mirrors, no lamps, no wheel arches,
// no tread — 2032 triangles of smooth wedge.  A heuristic material split by
// height band (the old `splitVehicleBody`) can paint a wedge four colours; it
// cannot give a wedge a B-pillar.  So the vehicles are BUILT here rather than
// imported, from an automotive parts vocabulary:
//
//   greenhouse narrower than the body (tumblehome) so A/B/C pillars exist as
//   real geometry -> recessed side glass between them -> door shutlines proud
//   of the flank -> wheel arches notched THROUGH the extruded shell onto a dark
//   underbody -> arch lips -> bumpers wider than the flank -> lamp buckets with
//   chrome reflectors behind glass -> door mirrors on stalks (the single
//   biggest silhouette break) -> handles, sill trim, wipers, exhaust -> and
//   tyres whose tread is castellated GEOMETRY, not a dark cylinder.
//
// Everything here is deterministic (fixed seeds, no Math.random) so the shot
// battery stays diffable frame to frame, and every part lands in one of the
// five vehicle materials already compiled in materials.js — carPaint (the only
// one that takes the per-instance body tint), carGlass, carTrim, carChrome,
// rubber.  No new material, no new program, NO LIGHT AND NO EMISSIVE: iter07
// ranked fix #1 is retiring additive light with no visible emitter, and a
// parked car's lamps read at night off the environment cube, which is exactly
// what a chrome reflector behind a glass lens is for.

import * as THREE from "three";

// ---------------------------------------------------------------- helpers
function det(seed) {                       // deterministic stream (no Math.random)
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// mergeGeometries refuses a mixed indexed/non-indexed set, and ExtrudeGeometry
// is the one primitive three ships non-indexed.
function indexed(g) {
  if (!g.index) g.setIndex([...Array(g.getAttribute("position").count).keys()]);
  return g;
}

const box = (mat, w, h, d, x = 0, y = 0, z = 0, ry = 0, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return { geo: g, mat };
};

const cylZ = (mat, r, len, x, y, z, seg = 8) => {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return { geo: g, mat };
};

/** Winding is decided numerically, never by hand: append one quad to a
 *  position/index pair and flip it if its normal opposes `out`. */
function quadInto(pos, idx, i0, i1, i2, i3, out) {
  const g = (i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
  const a = g(i0), b = g(i1), c = g(i2);
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  if (nx * out[0] + ny * out[1] + nz * out[2] >= 0) idx.push(i0, i1, i2, i0, i2, i3);
  else idx.push(i0, i2, i1, i0, i3, i2);
}

/** Planar polygon from world points, fan-triangulated, wound so the face
 *  normal points along `outward`. */
function panel(mat, pts, outward) {
  const pos = [];
  for (const p of pts) pos.push(p[0], p[1], p[2]);
  const idx = [];
  const a = pts[0], b = pts[1], c = pts[2];
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const flip = nx * outward[0] + ny * outward[1] + nz * outward[2] < 0;
  for (let i = 1; i < pts.length - 1; i++) {
    if (flip) idx.push(0, i + 1, i); else idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, mat };
}

/** Side glass / trim panel on an X flank, authored in (z, y) profile space. */
const flank = (mat, x, zy) =>
  panel(mat, zy.map((p) => [x, p[1], p[0]]), [Math.sign(x), 0, 0]);

/** Body shell: a (z,y) side profile extruded across the full width in X.
 *  Wheel arches are notches in the BOTTOM edge of the profile, so they cut a
 *  real opening through the shell — which is what makes an arch read as an
 *  arch instead of as a black shape painted on a wedge. */
function shell(mat, prof, width) {
  const s = new THREE.Shape();
  s.moveTo(prof[0][0], prof[0][1]);
  for (let i = 1; i < prof.length; i++) s.lineTo(prof[i][0], prof[i][1]);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 3 });
  g.rotateY(-Math.PI / 2);      // shape-x -> world +z, shape-z -> world -x
  g.translate(width / 2, 0, 0);
  return { geo: indexed(g), mat };
}

/** Wheel-arch notch in a bottom edge, travelling +z.
 *  `cy` is the arch's CENTRE height, which is NOT the sill: a semicircle struck
 *  from the sill line has to be ~40% wider than the wheel to clear its crown,
 *  and the first build did exactly that — the close-up came back with a small
 *  wheel sitting inside a cavernous opening, reading as a lifted rally car.
 *  Striking the arc from the axle height instead and dropping short vertical
 *  returns to the sill gives the 6-8 cm of daylight a parked car actually has. */
function arch(cz, r, y0, cy = null, n = 10) {
  const c = cy == null ? y0 : cy;
  const out = [];
  if (c !== y0) out.push([cz - r - 0.022, y0]);
  for (let i = 0; i <= n; i++) {
    const t = Math.PI * (1 - i / n);
    out.push([cz + r * Math.cos(t), c + r * Math.sin(t)]);
  }
  if (c !== y0) out.push([cz + r + 0.022, y0]);
  return out;
}

/** Arch lip: the flare that separates a car's shoulder from its flank, built
 *  on both flanks at once. */
function archLip(mat, cz, r, y0, x, tube = 0.014) {
  const g = new THREE.TorusGeometry(r, tube, 4, 8, Math.PI);
  g.rotateY(Math.PI / 2);
  g.translate(x, y0, cz);
  const g2 = g.clone();
  g2.translate(-2 * x, 0, 0);
  return [{ geo: g, mat }, { geo: g2, mat }];
}

/** One road wheel: castellated tread, sidewalls, and a rim face with spoke
 *  voids on the outboard side.  iter06 named this exactly — "a plain grey
 *  cylinder for a wheel" — so the tread is blocks and grooves in geometry. */
function wheelParts(M, r, halfW, x, y, z, side, blocks = 14) {
  const parts = [];
  const rIn = r - 0.030, rOut = r + 0.018;   // groove floor / block crown
  const pos = [], idx = [];
  const put = (ang, rad, sx) => {
    pos.push(x + sx * halfW, y + Math.sin(ang) * rad, z + Math.cos(ang) * rad);
    return pos.length / 3 - 1;
  };
  for (let i = 0; i < blocks; i++) {
    const a0 = (i / blocks) * Math.PI * 2, a1 = ((i + 1) / blocks) * Math.PI * 2;
    const rr = (i % 2) ? rOut : rIn;
    const rn = ((i + 1) % 2) ? rOut : rIn;
    const am = (a0 + a1) / 2;
    const i0 = put(a0, rr, -1), i1 = put(a0, rr, 1), i2 = put(a1, rr, 1), i3 = put(a1, rr, -1);
    quadInto(pos, idx, i0, i1, i2, i3, [0, Math.sin(am), Math.cos(am)]);   // tread face
    const i4 = put(a1, rn, 1), i5 = put(a1, rn, -1);
    const tSign = rn > rr ? -1 : 1;                                        // groove wall
    quadInto(pos, idx, i3, i2, i4, i5, [0, tSign * Math.cos(a1), -tSign * Math.sin(a1)]);
  }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  tg.setIndex(idx);
  tg.computeVertexNormals();
  parts.push({ geo: tg, mat: M.rubber });

  // sidewalls (a wheel is seen from inside the arch as well as from outside)
  for (const sx of [-1, 1]) {
    const g = new THREE.RingGeometry(r * 0.55, rIn + 0.006, 16);
    g.rotateY(sx > 0 ? Math.PI / 2 : -Math.PI / 2);
    g.translate(x + sx * halfW, y, z);
    parts.push({ geo: g, mat: M.rubber });
  }
  // Rim on the outboard face. The dish is DARK and only the lip and the nave
  // are bright: a full-face chrome disc read as a pale dinner plate filling the
  // arch in the first close-up, which is a different placeholder, not a wheel.
  const face = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const rimX = x + side * (halfW - 0.018);
  const back = new THREE.CircleGeometry(r * 0.55, 16);       // dark well behind
  back.rotateY(face); back.translate(x + side * (halfW - 0.055), y, z);
  parts.push({ geo: back, mat: M.rubber });
  const lip = new THREE.RingGeometry(r * 0.47, r * 0.555, 16);
  lip.rotateY(face); lip.translate(x + side * (halfW - 0.008), y, z);
  parts.push({ geo: lip, mat: M.carChrome });
  const dish = new THREE.RingGeometry(r * 0.155, r * 0.475, 16);
  dish.rotateY(face); dish.translate(rimX, y, z);
  parts.push({ geo: dish, mat: M.carChrome });
  for (let i = 0; i < 5; i++) {                              // spoke voids
    const a = (i / 5) * Math.PI * 2 + 0.31;
    const v = new THREE.CircleGeometry(r * 0.115, 10);
    v.rotateY(face);
    v.translate(rimX + side * 0.003, y + Math.sin(a) * r * 0.315, z + Math.cos(a) * r * 0.315);
    parts.push({ geo: v, mat: M.carTrim });
  }
  // The nave is the ONE part of a wheel that must read in every light: a
  // metal-only wheel goes black under a muzzle flash (metals have no diffuse
  // term) and a dielectric-only wheel goes black under the ambient night. One
  // of each, so the wheel is never a hole in the arch.
  const cap = new THREE.CircleGeometry(r * 0.165, 10);
  cap.rotateY(face); cap.translate(rimX + side * 0.010, y, z);
  parts.push({ geo: cap, mat: M.carPaint });
  return parts;
}

// ========================================================= CAR (sedan/estate)
// Layout footprint: 1.90 w x 1.30 h x 4.40 long (layout.js `p("pl_car_*")`).
function buildCar(M, variant) {
  const P = [];
  const HW = 0.86;          // lower-body half width
  const CW = 0.822;         // cabin half width — the tumblehome that makes pillars
  const SILL = 0.215, BELT = 0.86;
  const AR = 0.385, AZ = 1.40, ACY = 0.312;    // arch radius / axle z / arch centre
  const estate = variant === 1;

  // ---- lower body: one closed side profile, arches notched into its floor
  const prof = [
    [-2.16, 0.34], [-2.02, 0.235], [-1.84, SILL],
    ...arch(-AZ, AR, SILL, ACY),
    [-0.98, SILL], [0, 0.198], [0.98, SILL],
    ...arch(AZ, AR, SILL, ACY),
    [1.84, SILL], [2.02, 0.235], [2.16, 0.34],
    [2.205, 0.45], [2.215, 0.56], [2.19, 0.655], [2.125, 0.728], [1.95, 0.785],
    [1.55, 0.822], [1.12, 0.845], [0.98, BELT],
  ];
  if (estate) prof.push([-1.98, BELT], [-2.13, 0.83], [-2.20, 0.66], [-2.20, 0.45]);
  else prof.push([-1.68, BELT], [-1.86, 0.845], [-2.06, 0.80], [-2.16, 0.72],
                 [-2.20, 0.60], [-2.20, 0.45]);
  P.push(shell(M.carPaint, prof, HW * 2));

  // ---- cabin: NARROWER than the body, so A/B/C pillars are geometry
  const cab = estate
    ? [[0.98, 0.855], [0.86, 0.90], [0.40, 1.245], [0.24, 1.30],
       [-1.44, 1.30], [-1.62, 1.24], [-1.74, 0.99], [-1.76, 0.855]]
    : [[0.98, 0.855], [0.86, 0.90], [0.40, 1.245], [0.24, 1.30],
       [-0.74, 1.305], [-1.00, 1.28], [-1.46, 0.955], [-1.58, 0.87], [-1.58, 0.855]];
  P.push(shell(M.carPaint, cab, CW * 2));

  // ---- belly pan + arch liners.  The extruded shell's arch notches cut a
  // TUNNEL clean through the car, so something has to close it — but the pan
  // must stay INBOARD of the wheels or it swallows them (measured: the first
  // build put the pan at the full half-width and S1 came back with four empty
  // black arches and no tyres at all).
  P.push(box(M.carTrim, 1.15, 0.52, 3.74, 0, 0.44, 0));
  for (const az of [AZ, -AZ]) for (const sx of [-1, 1]) {
    P.push(box(M.carTrim, 0.285, 0.12, 0.80, sx * 0.7175, 0.660, az));   // arch liner
  }

  // ---- glazing, recessed 8 mm inside the cabin flank, pillars between panes
  const gx = CW + 0.008;
  const dlo = estate
    ? [[[0.76, 0.935], [0.06, 0.935], [0.06, 1.265], [0.44, 1.19]],
       [[-0.06, 0.935], [-0.76, 0.935], [-0.76, 1.27], [-0.06, 1.275]],
       [[-0.88, 0.945], [-1.52, 0.985], [-1.52, 1.245], [-0.88, 1.27]]]
    : [[[0.76, 0.935], [0.06, 0.935], [0.06, 1.265], [0.44, 1.19]],
       [[-0.06, 0.935], [-0.74, 0.935], [-0.74, 1.265], [-0.06, 1.275]],
       [[-0.86, 0.945], [-1.16, 0.99], [-1.10, 1.20], [-0.86, 1.255]]];
  for (const sx of [-1, 1]) for (const w of dlo) P.push(flank(M.carGlass, sx * gx, w));

  // windscreen + backlight, sitting 7 mm proud of the rake they glaze
  P.push(panel(M.carGlass, [
    [-0.735, 0.923, 0.841], [0.735, 0.923, 0.841],
    [0.680, 1.234, 0.427], [-0.680, 1.234, 0.427],
  ], [0, 0.80, 0.60]));
  P.push(estate
    ? panel(M.carGlass, [
        [-0.66, 0.998, -1.748], [0.66, 0.998, -1.748],
        [0.68, 1.242, -1.632], [-0.68, 1.242, -1.632]], [0, 0.42, -0.91])
    : panel(M.carGlass, [
        [-0.66, 0.980, -1.436], [0.66, 0.980, -1.436],
        [0.70, 1.266, -1.032], [-0.70, 1.266, -1.032]], [0, 0.82, -0.58]));

  // ---- brightwork: the belt strip that stops the flank being one value
  for (const sx of [-1, 1]) {
    P.push(box(M.carChrome, 0.014, 0.024, estate ? 2.34 : 2.02,
      sx * (CW + 0.012), 0.922, estate ? -0.30 : -0.15));
  }

  // ---- DOOR SHUTLINES.  A car's strongest structural read is its panel gaps
  // and the GLB had none.  4 mm proud and dark: at 2 m that is a shadow gap.
  for (const sx of [-1, 1]) for (const gz of [0.86, 0.02, estate ? -0.86 : -0.82]) {
    P.push(box(M.carTrim, 0.009, 0.630, 0.018, sx * (HW + 0.003), 0.545, gz));
  }
  P.push(box(M.carTrim, 1.54, 0.010, 0.026, 0, 0.868, 0.995));                    // cowl gap
  // Bonnet power dome. S1's nearest car is 2.09 m from the eye and the frame is
  // its BONNET — the one panel with no shutline, no glass and no bumper on it,
  // and a flat one at that distance is what critic-c read as "an untextured
  // clay ramp". A raised centre section with its own edges gives the plane a
  // form line instead of a fold in a card.
  P.push(box(M.carPaint, 0.66, 0.024, 1.06, 0, 0.810, 1.555, 0, 0.119));
  for (const sx of [-1, 1])
    P.push(box(M.carTrim, 0.012, 0.014, 1.06, sx * 0.334, 0.812, 1.555, 0, 0.119));
  for (const sx of [-1, 1]) {                                                     // bonnet gaps
    P.push(box(M.carTrim, 0.026, 0.010, 1.17, sx * 0.575, 0.806, 1.565, 0, 0.119));
  }
  P.push(box(M.carTrim, 1.48, 0.010, 0.026, 0, 0.868, estate ? -1.94 : -1.70));   // boot gap

  // ---- sills, handles, filler cap, door mirrors
  for (const sx of [-1, 1]) {
    P.push(box(M.carTrim, 0.034, 0.105, 1.86, sx * 0.852, 0.258, 0));
    P.push(box(M.carChrome, 0.016, 0.036, 0.135, sx * (HW + 0.006), 0.738, 0.31));
    P.push(box(M.carChrome, 0.016, 0.036, 0.135, sx * (HW + 0.006), 0.738, -0.41));
    P.push(box(M.carTrim, 0.012, 0.145, 0.145, sx * (HW + 0.003), 0.615, -1.05));
    P.push(box(M.carTrim, 0.105, 0.048, 0.052, sx * 0.845, 0.908, 0.80));
    P.push(box(M.carPaint, 0.105, 0.098, 0.145, sx * 0.945, 0.928, 0.79));
    P.push(box(M.carGlass, 0.014, 0.076, 0.112, sx * 0.996, 0.928, 0.783));
  }

  // ---- front end: bumper wider than the flank, grille, lamp buckets
  P.push(box(M.carTrim, 1.80, 0.215, 0.215, 0, 0.395, 2.145));
  P.push(box(M.carTrim, 1.16, 0.215, 0.045, 0, 0.600, 2.176));                // grille well
  for (const gy of [0.500, 0.700]) P.push(box(M.carChrome, 1.22, 0.028, 0.030, 0, gy, 2.192));
  for (const sx of [-1, 1]) P.push(box(M.carChrome, 0.028, 0.228, 0.030, sx * 0.596, 0.600, 2.192));
  for (let i = 0; i < 7; i++)                                                  // vanes
    P.push(box(M.carChrome, 0.022, 0.190, 0.022, -0.45 + i * 0.15, 0.600, 2.190));
  P.push(box(M.carTrim, 0.92, 0.105, 0.05, 0, 0.330, 2.212));                 // lower intake
  for (let i = 0; i < 5; i++)
    P.push(box(M.carTrim, 0.020, 0.090, 0.022, -0.32 + i * 0.16, 0.330, 2.226));
  for (const sx of [-1, 1]) {
    P.push(box(M.carChrome, 0.335, 0.150, 0.075, sx * 0.605, 0.672, 2.155));   // reflector
    P.push(box(M.carGlass, 0.305, 0.125, 0.040, sx * 0.605, 0.672, 2.190));    // lens
    P.push(box(M.carChrome, 0.115, 0.055, 0.030, sx * 0.660, 0.325, 2.215));   // indicator
  }
  P.push(box(M.carChrome, 0.315, 0.105, 0.022, 0, 0.402, 2.252));              // plate
  P.push(box(M.carChrome, 1.68, 0.020, 0.030, 0, 0.735, 2.132));              // bonnet lead edge
  for (const sx of [-1, 1]) {
    P.push(box(M.carChrome, 0.365, 0.030, 0.024, sx * 0.605, 0.752, 2.170));  // lamp bezel top
    P.push(box(M.carChrome, 0.365, 0.030, 0.024, sx * 0.605, 0.592, 2.170));  // lamp bezel foot
  }

  // ---- rear end
  P.push(box(M.carTrim, 1.80, 0.215, 0.215, 0, 0.395, -2.145));
  for (const sx of [-1, 1]) {
    P.push(box(M.carTrim, 0.325, 0.245, 0.065, sx * 0.615, 0.685, -2.160));
    P.push(box(M.carChrome, 0.275, 0.195, 0.030, sx * 0.615, 0.685, -2.196));
  }
  P.push(box(M.carChrome, 0.315, 0.105, 0.022, 0, 0.402, -2.252));
  P.push(cylZ(M.carChrome, 0.036, 0.17, -0.55, 0.262, -2.222, 8));

  // ---- THE HORIZONTAL PLANES.  S1's nearest car is 2.09 m from the eye and
  // the frame is filled by its bonnet, cowl and roof seen from above — the one
  // part of a car that carries no shutline, no glass and no bumper, which is
  // why critic-c read it as "an untextured clay ramp ... occupying roughly a
  // fifth of the frame". Everything below exists to put incident on those
  // planes at arm's length: a slatted cowl vent, roof drip rails, a glass
  // sunroof and A-pillar trim.
  P.push(box(M.carTrim, 1.30, 0.030, 0.115, 0, 0.872, 0.925));                 // cowl vent well
  for (let i = 0; i < 5; i++) P.push(box(M.carChrome, 1.24, 0.012, 0.014, 0, 0.888, 0.876 + i * 0.024));
  for (const sx of [-1, 1]) {
    P.push(box(M.carTrim, 0.026, 0.026, 1.62, sx * 0.782, 1.292, -0.32));      // roof drip rail
  }
  P.push(box(M.carGlass, 0.60, 0.016, 0.52, 0, 1.312, -0.06));                 // sunroof
  P.push(box(M.carTrim, 0.66, 0.012, 0.58, 0, 1.303, -0.06));                  // its aperture
  // ---- wipers + roof furniture
  for (const sx of [-1, 1]) P.push(box(M.carTrim, 0.56, 0.014, 0.024, sx * 0.33, 0.888, 0.945, sx * 0.22));
  if (estate) {
    for (const sx of [-1, 1]) {
      P.push(box(M.carChrome, 0.028, 0.028, 2.10, sx * 0.60, 1.322, -0.55));
      for (const fz of [0.40, -0.55, -1.48]) P.push(box(M.carTrim, 0.034, 0.034, 0.075, sx * 0.60, 1.302, fz));
    }
    P.push(box(M.carTrim, 1.10, 0.050, 0.16, 0, 1.300, -1.50, 0, -0.30));
  } else {
    P.push(box(M.carTrim, 0.045, 0.060, 0.165, 0, 1.290, -0.72));              // shark fin
  }

  // ---- wheels + arch lips
  for (const az of [AZ, -AZ]) {
    P.push(...archLip(M.carPaint, az, AR - 0.006, ACY, HW - 0.010, 0.013));
    P.push(...wheelParts(M, 0.335, 0.118, 0.700, 0.335, az, 1));
    P.push(...wheelParts(M, 0.335, 0.118, -0.700, 0.335, az, -1));
  }
  return P;
}

// ================================================================== PANEL VAN
// Layout footprint: 2.20 w x 2.40 h x 5.20 long.
function buildVan(M) {
  const P = [];
  const HW = 1.02, SILL = 0.245, AR = 0.475, ACY = 0.375;  // struck from the axle
  const AZF = 1.55, AZR = -1.75;
  const prof = [
    [-2.56, 0.40], [-2.42, 0.27], [-2.30, SILL],
    ...arch(AZR, AR, SILL, ACY), [-1.25, SILL], [0.55, 0.225], [1.05, SILL],
    ...arch(AZF, AR, SILL, ACY),
    [2.10, SILL], [2.34, 0.27], [2.50, 0.36],
    [2.56, 0.50], [2.56, 0.88], [2.48, 1.02], [2.26, 1.09], [2.06, 1.12],
    [1.44, 2.02], [1.30, 2.20],                       // windscreen rake
    [1.18, 2.34], [-2.34, 2.38], [-2.48, 2.24],       // roof
    [-2.56, 1.60],
  ];
  P.push(shell(M.carPaint, prof, HW * 2));
  // belly pan inboard of the 0.835 m wheel centres, plus arch liners (see the
  // note in buildCar: a full-width pan hides the wheels inside itself)
  P.push(box(M.carTrim, 1.30, 0.60, 4.50, 0, 0.50, -0.10));
  for (const az of [AZF, AZR]) for (const sx of [-1, 1]) {
    P.push(box(M.carTrim, 0.33, 0.12, 1.00, sx * 0.840, 0.830, az));
  }

  P.push(panel(M.carGlass, [
    [-0.86, 1.135, 2.062], [0.86, 1.135, 2.062],
    [0.80, 2.020, 1.462], [-0.80, 2.020, 1.462],
  ], [0, 0.55, 0.83]));
  for (const sx of [-1, 1]) {
    P.push(flank(M.carGlass, sx * (HW + 0.008),
      [[1.28, 1.28], [0.62, 1.28], [0.62, 1.93], [1.24, 1.99]]));
    P.push(box(M.carGlass, 0.62, 0.52, 0.030, sx * 0.47, 1.83, -2.578));
  }

  // slab-breaking hardware: swage lines, rubbing strip, sliding-door track,
  // shutlines.  A van flank with nothing on it is the classic blockout tell.
  for (const sx of [-1, 1]) {
    const x = sx * (HW + 0.005);
    P.push(box(M.carTrim, 0.014, 0.075, 3.60, x, 0.95, -0.55));
    P.push(box(M.carChrome, 0.012, 0.030, 3.40, x, 1.34, -0.60));
    for (const gy of [1.62, 2.02]) P.push(box(M.carTrim, 0.010, 0.018, 3.30, x, gy, -0.60));
    for (const gz of [1.24, 0.28, -1.06]) P.push(box(M.carTrim, 0.012, 1.90, 0.026, x, 1.36, gz));
    P.push(box(M.carChrome, 0.016, 0.038, 0.14, x, 1.44, 0.90));
    P.push(box(M.carChrome, 0.016, 0.038, 0.14, x, 1.30, -0.90));
    P.push(box(M.carTrim, 0.040, 0.115, 1.90, sx * (HW - 0.012), 0.28, -0.55));
    P.push(box(M.carTrim, 0.16, 0.045, 0.055, sx * 1.09, 1.86, 1.30));         // mirror arm
    P.push(box(M.carTrim, 0.055, 0.42, 0.155, sx * 1.20, 1.72, 1.30));
    P.push(box(M.carGlass, 0.014, 0.36, 0.125, sx * 1.234, 1.72, 1.294));
    P.push(box(M.carChrome, 0.38, 0.19, 0.08, sx * 0.70, 0.80, 2.520));        // headlamp
    P.push(box(M.carGlass, 0.35, 0.16, 0.045, sx * 0.70, 0.80, 2.558));
    P.push(box(M.carTrim, 0.325, 0.26, 0.075, sx * 0.72, 1.90, -2.545));       // tail lamp
    P.push(box(M.carChrome, 0.275, 0.21, 0.032, sx * 0.72, 1.90, -2.582));
    P.push(box(M.carTrim, 0.44, 0.30, 0.030, sx * 0.62, 0.18, -2.36, 0, 0.12));// mudflap
    P.push(box(M.carTrim, 0.60, 0.016, 0.026, sx * 0.35, 1.145, 2.082, sx * 0.20));
  }
  P.push(box(M.carTrim, 0.026, 1.95, 0.012, 0, 1.36, -2.575));                 // barn-door split
  for (const gy of [0.85, 1.90]) for (const sx of [-1, 1])
    P.push(box(M.carChrome, 0.075, 0.075, 0.030, sx * 0.90, gy, -2.578));

  P.push(box(M.carTrim, 2.12, 0.24, 0.24, 0, 0.42, 2.50));
  P.push(box(M.carTrim, 1.35, 0.26, 0.05, 0, 0.80, 2.545));
  for (const gy of [0.72, 0.82, 0.92]) P.push(box(M.carChrome, 1.24, 0.022, 0.024, 0, gy, 2.562));
  P.push(box(M.carChrome, 0.34, 0.11, 0.024, 0, 0.44, 2.610));
  P.push(box(M.carTrim, 1.10, 0.13, 0.60, 0, 2.42, 1.55));                     // roof vent
  P.push(box(M.carTrim, 0.42, 0.16, 0.42, -0.55, 2.43, -1.20));                // roof pod

  for (const az of [AZF, AZR]) {
    P.push(...archLip(M.carPaint, az, AR - 0.008, ACY, HW - 0.012, 0.016));
    P.push(...wheelParts(M, 0.415, 0.135, 0.835, 0.415, az, 1, 16));
    P.push(...wheelParts(M, 0.415, 0.135, -0.835, 0.415, az, -1, 16));
  }
  return P;
}

// ==================================================================== LORRY
// Layout footprint: 2.50 w x 3.00 h x 7.00 long.
function buildTruck(M) {
  const P = [];
  const HW = 1.16;
  // chassis rails + crossmembers under the box: a truck with no chassis reads
  // as a crate on wheels, which is precisely the S8 "featureless centre box"
  for (const sx of [-1, 1]) P.push(box(M.carTrim, 0.13, 0.22, 6.55, sx * 0.60, 0.72, -0.10));
  for (const cz of [-3.0, -1.1, 0.6, 2.2]) P.push(box(M.carTrim, 1.20, 0.10, 0.14, 0, 0.70, cz));

  // the cab's own front wheel arch is notched into its floor — without it the
  // 0.505 m tyre is buried 0.39 m inside the cab shell and simply vanishes
  const cab = [
    [1.18, 0.62], [1.78, 0.62], ...arch(2.45, 0.575, 0.62, 0.505), [3.12, 0.62],
    [3.42, 0.62], [3.48, 0.82], [3.48, 1.42], [3.40, 1.60],
    [3.10, 1.72], [2.62, 2.52], [2.50, 2.66], [1.18, 2.68],
  ];
  P.push(shell(M.carPaint, cab, HW * 2));
  P.push(panel(M.carGlass, [
    [-1.02, 1.742, 3.102], [1.02, 1.742, 3.102],
    [0.94, 2.512, 2.637], [-0.94, 2.512, 2.637],
  ], [0, 0.51, 0.86]));
  for (const sx of [-1, 1]) {
    P.push(flank(M.carGlass, sx * (HW + 0.008), [[2.44, 1.80], [1.42, 1.80], [1.42, 2.48], [2.38, 2.48]]));
    P.push(box(M.carTrim, 0.014, 1.98, 0.028, sx * (HW + 0.005), 1.66, 1.32));
    P.push(box(M.carChrome, 0.018, 0.042, 0.16, sx * (HW + 0.007), 1.70, 1.55));
    P.push(box(M.carTrim, 0.34, 0.05, 0.42, sx * 1.06, 1.02, 1.90));
    P.push(box(M.carTrim, 0.34, 0.05, 0.42, sx * 1.06, 0.62, 1.90));
    P.push(box(M.carTrim, 0.07, 0.90, 0.07, sx * 1.24, 2.20, 2.55));           // mirror arm
    P.push(box(M.carTrim, 0.06, 0.52, 0.18, sx * 1.32, 2.14, 2.55));
    P.push(box(M.carGlass, 0.015, 0.46, 0.15, sx * 1.352, 2.14, 2.545));
    P.push(box(M.carChrome, 0.44, 0.22, 0.09, sx * 0.66, 1.05, 3.440));
    P.push(box(M.carGlass, 0.40, 0.19, 0.05, sx * 0.66, 1.05, 3.482));
  }
  P.push(box(M.carTrim, 2.20, 0.30, 0.26, 0, 0.66, 3.46));
  P.push(box(M.carTrim, 1.70, 0.55, 0.06, 0, 1.42, 3.472));
  for (let i = 0; i < 5; i++) P.push(box(M.carChrome, 1.58, 0.032, 0.030, 0, 1.20 + i * 0.11, 3.492));
  P.push(box(M.carPaint, 2.00, 0.34, 0.55, 0, 2.80, 2.45, 0, -0.34));          // roof deflector

  // the cargo box floor sits ABOVE the rear tyres (crown 1.01 m) and on top of
  // the chassis, so the rails, the axles and the wheels all stay visible —
  // which is also what stops a lorry reading as "a bare rectangular prism"
  P.push(box(M.carPaint, HW * 2 + 0.06, 1.92, 4.50, 0, 2.02, -1.15));          // cargo box
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 8; i++)
      P.push(box(M.carTrim, 0.020, 1.80, 0.05, sx * (HW + 0.036), 2.02, -3.28 + i * 0.58));
    P.push(box(M.carChrome, 0.030, 0.075, 4.40, sx * (HW + 0.036), 1.16, -1.15));
    P.push(box(M.carChrome, 0.09, 0.42, 0.09, sx * (HW + 0.02), 0.86, -3.05));  // underrun leg
    P.push(box(M.carChrome, 0.06, 0.06, 1.30, sx * (HW + 0.02), 0.66, -3.05));  // underrun bar
    P.push(box(M.carTrim, 0.50, 0.42, 0.032, sx * 0.72, 0.24, -3.16, 0, 0.10));
    P.push(box(M.carTrim, 0.44, 0.10, 1.55, sx * 1.00, 1.03, -1.95));           // rear mudguard
    P.push(box(M.carTrim, 0.34, 0.30, 0.075, sx * 0.80, 0.72, -3.400));
    P.push(box(M.carChrome, 0.28, 0.24, 0.032, sx * 0.80, 0.72, -3.434));
  }
  for (let i = 0; i < 6; i++)
    P.push(box(M.carChrome, 2.24, 0.20, 0.035, 0, 1.20 + i * 0.28, -3.412));   // roller slats
  P.push(box(M.carTrim, 2.30, 0.10, 0.12, 0, 2.92, -3.40));

  for (const az of [2.45, -1.35, -2.55]) {
    P.push(...wheelParts(M, 0.505, 0.155, 1.00, 0.505, az, 1, 16));
    P.push(...wheelParts(M, 0.505, 0.155, -1.00, 0.505, az, -1, 16));
  }
  return P;
}

/** kind -> parts.  `variant` picks a second silhouette so a street of fifteen
 *  cars is not fifteen copies of one prototype (the D7 copy-paste cap). */
export function buildVehicle(kind, M, variant = 0) {
  if (kind === "van") return buildVan(M);
  if (kind === "truck") return buildTruck(M);
  return buildCar(M, variant);
}

// ================================================================= SANDBAGS
// iter06: "smooth olive lozenges" / "identical lumpy sandbag potatoes" /
// "untextured tan lumps" — 3/3 critics, wording UNCHANGED from iter05 even
// though the hessian weave was verified legible at 5x.  A texture that needs
// magnification did not fix the frame; what a cold eye reads at battery framing
// is the SILHOUETTE, and every bag was a smoothed sphere at the same yaw inside
// the same 3-2-2 stack repeated across all nine emplacements.
//
// Two things change.  (1) The bag: a filled hessian sack is not an ellipsoid —
// it is flat on top where the course above sits on it, flat underneath, pinched
// into two folded EARS at the sewn ends, ridged along its seam and creased by
// its own fill.  (2) The stack: two prototypes with different course counts and
// bonds, plus a slumped course and spoil bags bedded into the mud, so no two
// emplacements share an outline.
function sandbag(M, cx, cy, cz, sx, sy, sz, yaw, tilt, tone, damp, seed) {
  // 14x9: S5's tram-platform camera stands 1.95 m from pf_nest_r, so ONE bag
  // owns a corner of a graded frame — measured live, that is what critic-c's
  // "khaki mitten-lumps in the bottom corners" actually were, NOT the gloves.
  const g = new THREE.SphereGeometry(0.5, 14, 9);
  const p = g.getAttribute("position");
  const r = det(seed);
  const w1 = 3.1 + r() * 2.4, w2 = 4.3 + r() * 2.6, ph = r() * 6.28;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // EARS at the SEWN ENDS, i.e. along the bag's LONG axis (X, the axis the
    // caller stretches along the wall).  The first build put them on Z, the
    // short axis, which splayed every bag sideways into a flat disc — the
    // close-up came back reading as a stack of pitta breads.
    const t = Math.max(0, Math.abs(x / 0.5) - 0.48) / 0.52;
    z *= 1 + t * 0.55; y *= 1 - t * 0.72; x *= 1 - t * 0.05;
    // SEWN CREST: the closed top of a filled sack narrows to a ridge, and that
    // ridge is the single feature that separates a sack from a pebble at 2 m.
    const ny = y / 0.5;
    if (ny > 0.68) z *= 1 - ((ny - 0.68) / 0.32) * 0.48;
    y = y > 0 ? y * 0.88 : y * (0.78 + damp * 0.10);      // settled crown / flat foot
    const k = 1 + 0.105 * Math.sin(w1 * z + ph) * Math.cos(w2 * x + ph * 0.7)
                + 0.060 * Math.sin(w2 * y * 2.0 + ph)
                + 0.045 * Math.sin(w1 * 1.9 * x + ph * 1.6) * Math.cos(w2 * 1.4 * z + ph);
    x *= k; z *= k;
    if (Math.abs(y) < 0.05) { z *= 1.05; }                // side seam
    p.setXYZ(i, x, y, z);
  }
  g.scale(sx, sy, sz);
  g.rotateZ(tilt);
  g.rotateY(yaw);
  g.translate(cx, cy, cz);
  g.computeVertexNormals();
  // per-bag tone + damp gradient toward the foot, baked to vertex colour so
  // ONE instanced prototype still shows a dozen different sacks
  const col = new Float32Array(p.count * 3);
  const tint = new THREE.Color(tone);
  const bb = new THREE.Box3().setFromBufferAttribute(p);
  const span = Math.max(1e-4, bb.max.y - bb.min.y);
  for (let i = 0; i < p.count; i++) {
    const f = (p.getY(i) - bb.min.y) / span;
    const kk = 0.44 + 0.56 * Math.min(1, f / 0.55);
    col[i * 3] = tint.r * kk;
    col[i * 3 + 1] = tint.g * kk * (1 - damp * 0.10);
    col[i * 3 + 2] = tint.b * kk * (1 - damp * 0.17);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return { geo: g, mat: M.sandbag };
}

const SACK_TONES = [0xefe7d4, 0xdcd0b4, 0xc2b596, 0xa89a7c, 0xcfc0a0, 0x9d8f74];

export function buildSandbags(M, w, h, d, variant = 0) {
  const parts = [];
  const r = det(variant ? 8821 : 11);
  const rows = variant ? [4, 3, 3, 2] : [3, 3, 2];
  // Course PITCH drives bag height, not the other way round.  Bags are authored
  // ~34% taller than the pitch so each course beds into the one below and the
  // wall has no daylight through it — the first build sized bags off a fraction
  // of the footprint and left a visible gap between every course.
  const pitch = h / (rows.length + 0.30);
  let s = 0;
  for (let row = 0; row < rows.length; row++) {
    const n = rows[row];
    const bw = w / (n + 0.12);
    const bond = ((row + variant) % 2) * bw * 0.5;
    const cy = pitch * (0.52 + row);
    for (let i = 0; i < n; i++) {
      // Bags are laid as STRETCHERS — long axis along the wall, ~2.5x longer
      // than deep — and alternate front/back file within a course.  Authored
      // deeper than long (the first pass) they overlapped into one continuous
      // bolster per course and the stack read as four stacked cushions.
      parts.push(sandbag(M,
        (i - (n - 1) / 2) * bw + bond + (r() - 0.5) * bw * 0.10,
        cy * (0.97 + r() * 0.07),
        ((i % 2) ? 1 : -1) * d * 0.15 + (r() - 0.5) * d * 0.12,
        bw * (0.86 + r() * 0.12), pitch * 1.34 * (0.90 + r() * 0.20), d * (0.40 + r() * 0.10),
        (r() - 0.5) * 0.46, (r() - 0.5) * 0.20,
        SACK_TONES[(row * 2 + i + ((r() * 3) | 0)) % SACK_TONES.length], r(), 900 + s++));
    }
  }
  // a course that has slumped off the end — the emplacement has been rained on,
  // not stacked in a shop, and this is what stops two protos sharing an outline
  for (let i = 0; i < (variant ? 2 : 1); i++) {
    parts.push(sandbag(M,
      (variant ? -1 : 1) * w * (0.42 + r() * 0.10), pitch * 0.46, d * (0.30 + r() * 0.22),
      w * 0.30, pitch * 1.15, d * 0.55,
      1.15 + r() * 0.5, 0.42, SACK_TONES[(3 + i) % SACK_TONES.length], 0.9, 940 + i));
  }
  // spoil bags bedded into the mud at the base
  for (let i = 0; i < 2; i++) {
    parts.push(sandbag(M,
      (r() - 0.5) * w * 0.85, pitch * 0.20, (r() - 0.5) * d * 0.5 + d * 0.30,
      w * (0.28 + r() * 0.14), pitch * 0.70, d * (0.34 + r() * 0.16),
      r() * Math.PI, 0, SACK_TONES[3], 1.0, 960 + i));
  }
  return parts;
}

// =============================================================== TRASH BAGS
// critic-b named this in the SAME clause as the car: "the teal sedan and the
// smooth black ellipsoid in C1_02.png".  Three smoothed spheres are a doctrine
// §7 primitive standing in a graded foreground.  A refuse sack has a gathered,
// twisted neck, radial pull-folds running down from it, a flat load-bearing
// base — and there is spilled cardboard next to it, because this is an alley.
export function buildTrashBags(M, w, h, d) {
  const parts = [];
  const r = det(5);
  const sack = (cx, cy, cz, sx, sy, sz, yaw, seed) => {
    // 16x12, not 12x8: the lump frequencies below sit near Nyquist on a coarse
    // sphere and smooth vertex normals then average them away entirely — the
    // first pass authored ~15% relief and rendered a glassy egg.
    const g = new THREE.SphereGeometry(0.5, 16, 12);
    const p = g.getAttribute("position");
    const rr = det(seed);
    const lobes = 5 + ((rr() * 3) | 0), ph = rr() * 6.28;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = x / 0.5, ny = y / 0.5, nz = z / 0.5;
      const ang = Math.atan2(z, x);
      // What a cold eye reads on a refuse sack is IRREGULARITY.  The first build
      // pinched a narrow smooth neck onto a smooth belly and the close-up came
      // back with three glossy pot-bellied URNS, which is a different
      // placeholder, not a fix.  Three octaves of lump, a gather only at the
      // very top, and a slumped foot.
      const lump = 1
        + 0.190 * Math.sin(2.6 * nx + ph) * Math.cos(2.2 * nz + ph * 0.6)
        + 0.120 * Math.sin(4.0 * nz + ph * 1.9) * Math.cos(3.4 * ny + ph * 0.3)
        + 0.105 * Math.sin(lobes * ang + ph + ny * 2.4);
      const nk = ny > 0.66 ? 1 - ((ny - 0.66) / 0.34) * 0.52 : 1;   // gather at the tie
      const slump = 1 + 0.15 * Math.max(0, -ny - 0.10);             // sits and spreads
      x *= nk * lump * slump; z *= nk * lump * slump;
      if (ny < -0.72) y = -0.36;                                    // flat foot
      p.setXYZ(i, x, y * 1.02, z);
    }
    g.scale(sx, sy, sz);
    g.rotateY(yaw);
    g.translate(cx, cy, cz);
    g.computeVertexNormals();
    return { geo: g, mat: M.trashBag };
  };
  for (let i = 0; i < 3; i++) {
    const yaw = r() * Math.PI * 2;
    const cx = (r() - 0.5) * w * 0.52, cz = (r() - 0.5) * d * 0.52;
    const sy = h * (0.50 + r() * 0.20);
    parts.push(sack(cx, sy * 0.52, cz, w * (0.42 + r() * 0.10), sy,
      d * (0.42 + r() * 0.10), yaw, 700 + i));
    // the tie: gathered polythene twisted into a leaning spike
    const tie = new THREE.CylinderGeometry(0.012, 0.055, h * 0.20, 6);
    tie.rotateZ((r() - 0.5) * 0.7);
    tie.translate(cx, sy * 0.98, cz);
    parts.push({ geo: tie, mat: M.trashBag });
  }
  parts.push(box(M.woodDark, w * 0.46, h * 0.30, d * 0.30, w * 0.24, h * 0.15, -d * 0.22, 0.42));
  parts.push(box(M.woodDark, w * 0.30, h * 0.20, d * 0.26, -w * 0.30, h * 0.10, d * 0.30, -0.7));
  parts.push(box(M.woodDark, w * 0.22, h * 0.05, d * 0.20, w * 0.05, h * 0.03, d * 0.40, 1.1));
  return parts;
}
