// GENESIS — the UI's icon set (CONTRACT.md §16): fine-line glyphs for every power in powers.json (its `icon` key), the
// thirteen power categories, overlays and the UI's own buttons. Drawn in code like everything else in GENESIS: a small
// vocabulary of primitives (peak, wave, cloud, drop, flame, leaf, person, hand, star …) composed per icon, in a 24-unit
// box, stroked with currentColor (styles.css .gn-ico) so they take the panel's ivory / gold. An unknown key (a mod's
// power) gets its category's glyph, never a blank.

const P = (d: string): string => `<path d="${d}"/>`;
const F = (d: string): string => `<path class="f" d="${d}"/>`;
const CI = (cx: number, cy: number, r: number): string => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const DOT = (cx: number, cy: number, r = 1.05): string => `<circle class="f" cx="${cx}" cy="${cy}" r="${r}"/>`;
const G = (t: string, ...inner: string[]): string => `<g transform="${t}">${inner.join('')}</g>`;
/** a glyph moved and scaled (stroke width stays — styles.css sets vector-effect) */
const at = (x: number, y: number, s: number, ...inner: string[]): string => G(`translate(${x} ${y}) scale(${s})`, ...inner);

// ── primitives (24 × 24) ──
const ground = P('M3 20.5h18');
const peak = P('M2.5 19l6.5-10 3.6 5.2 2.6-3.6 6.3 8.4');
const bigPeak = P('M3.5 19.5L12 6l8.5 13.5');
const wave = (y: number): string => P(`M3 ${y}c1.5-1.7 3-1.7 4.5 0s3 1.7 4.5 0 3-1.7 4.5 0 3 1.7 4.5 0`);
const drop = P('M12 3.2c3.1 4.1 5.6 7.1 5.6 10.3a5.6 5.6 0 0 1-11.2 0c0-3.2 2.5-6.2 5.6-10.3z');
const cloud = P('M7 17.5h10.5a3.5 3.5 0 0 0 .5-6.96 5 5 0 0 0-9.6-1.3A3.75 3.75 0 0 0 7 17.5z');
const cloudHi = P('M7 13.5h10.5a3.2 3.2 0 0 0 .5-6.36 4.6 4.6 0 0 0-8.9-1.2A3.4 3.4 0 0 0 7 13.5z');
const flame = P('M12 2.8c.8 3.2 5.4 5.3 5.4 10.6a5.4 5.4 0 0 1-10.8 0c0-2.7 1.4-4.4 2.5-5.4.3 2.2 1.2 3.3 2.4 3.8-.4-3.3.8-6.2.5-9z');
const leaf = P('M12 21v-8.5M12 12.5C12 8.4 9.2 6.2 4.6 6.2c0 4.3 2.9 6.3 7.4 6.3zM12 10.5c0-3.4 2.6-5.6 7.4-5.6 0 3.8-2.6 5.6-7.4 5.6z');
const conifer = P('M12 21.5v-4M12 2.8L6.3 11h3.1l-4.1 6.5h13.4L14.6 11h3.1z');
const broadTree = P('M12 21.5v-6.5M12 15l-2.5-2.5M12 13.5l3-2.3M12 2.8a6.2 6.2 0 0 0-5.8 8.4A4.2 4.2 0 0 0 8.5 18h7a4.2 4.2 0 0 0 2.3-6.8A6.2 6.2 0 0 0 12 2.8z');
const sunRays = P('M12 2.2v2.3M12 19.5v2.3M2.2 12h2.3M19.5 12h2.3M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M5.1 18.9l1.6-1.6M17.3 6.7l1.6-1.6');
const sun = CI(12, 12, 4.2) + sunRays;
const moonP = P('M15.5 3.4a8.6 8.6 0 1 0 5.2 13.1A7.2 7.2 0 0 1 15.5 3.4z');
const bolt = P('M13.4 2.2L5.8 13.2h5.4l-1.1 8.6 7.9-11.6h-5.5z');
const star5 = P('M12 2.8l2.7 5.7 6.2.8-4.6 4.3 1.2 6.2L12 16.8l-5.5 3 1.2-6.2-4.6-4.3 6.2-.8z');
const person = CI(12, 5.4, 2.4) + P('M12 8.3v6.6M7.6 11.2l4.4-1.4 4.4 1.4M12 14.9l-3.3 5.8M12 14.9l3.3 5.8');
const personAt = (x: number, y: number, s = 0.62): string => at(x, y, s, person);
const openHand = P('M8.2 12.5V5.6a1.4 1.4 0 0 1 2.8 0v5.6M11 11V4.2a1.4 1.4 0 0 1 2.8 0V11M13.8 11.2V5.4a1.4 1.4 0 0 1 2.8 0v7.1M8.2 12.4l-1.6-2.1a1.5 1.5 0 0 0-2.4 1.7l3.1 5.2a7 7 0 0 0 6 3.4h.6a5 5 0 0 0 5-5V8.1a1.4 1.4 0 0 0-2.8 0');
const fist = P('M7.2 9.6a1.6 1.6 0 0 1 3.2 0M10.4 9.2a1.6 1.6 0 0 1 3.2 0M13.6 9.4a1.6 1.6 0 0 1 3.2 0v4.8a6 6 0 0 1-6 6h-.4a5 5 0 0 1-4.7-3.3l-1.1-3.1a1.6 1.6 0 0 1 2.9-1.3l.9 1.6V9.6M10.4 9.2v3.2M13.6 9.4v3');
const globe = CI(12, 12, 8.6) + P('M3.4 12h17.2M12 3.4c2.6 2.4 3.9 5.3 3.9 8.6s-1.3 6.2-3.9 8.6c-2.6-2.4-3.9-5.3-3.9-8.6S9.4 5.8 12 3.4z');
const ringWorld = CI(12, 12, 5.6) + P('M3.2 15.4c-1.4 1.7 .4 2.9 4.2 2.4 4.4-.6 10.6-3.4 12.6-6.1 1.2-1.7-.2-2.7-3.2-2.5');
const house = P('M4 11.2L12 5l8 6.2M6.2 9.6V19h11.6V9.6M10.2 19v-4.6h3.6V19');
const book = P('M12 6.8c-2.3-1.6-5.2-2-8.5-1.5v13c3.3-.5 6.2 0 8.5 1.5 2.3-1.5 5.2-2 8.5-1.5v-13c-3.3-.5-6.2-.1-8.5 1.5zM12 6.8v13');
const scroll = P('M7 4.5h11a2 2 0 0 1 0 4h-1.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1 0-4h1V6.5a2 2 0 0 1 2-2zM9.6 9h4.5M9.6 12h4.5M7 16h6.5');
const heart = P('M12 20s-7.8-4.6-7.8-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.8 2.4C19.8 15.4 12 20 12 20z');
const skull = P('M12 3.5a7.2 7.2 0 0 0-7.2 7.2c0 2.4 1.1 4 2.7 5.1v2.7h9v-2.7c1.6-1.1 2.7-2.7 2.7-5.1A7.2 7.2 0 0 0 12 3.5zM10 18.5v-2M14 18.5v-2') + DOT(9.2, 11.2, 1.5) + DOT(14.8, 11.2, 1.5);
const cross = P('M12 5v14M5 12h14');
const xMark = P('M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8');
const plusSmall = (x: number, y: number): string => P(`M${x} ${y - 2.6}v5.2M${x - 2.6} ${y}h5.2`);
const minusSmall = (x: number, y: number): string => P(`M${x - 2.6} ${y}h5.2`);
const arrowUp = (x = 12, y0 = 12, y1 = 3.5): string => P(`M${x} ${y0}V${y1}M${x - 3.2} ${y1 + 3.2}L${x} ${y1}l3.2 3.2`);
const arrowDown = (x = 12, y0 = 3.5, y1 = 12): string => P(`M${x} ${y0}V${y1}M${x - 3.2} ${y1 - 3.2}L${x} ${y1}l3.2-3.2`);
const arrowRight = (y = 12, x0 = 4, x1 = 20): string => P(`M${x0} ${y}H${x1}M${x1 - 3.2} ${y - 3.2}L${x1} ${y}l-3.2 3.2`);
const circArrow = P('M19.2 12a7.2 7.2 0 1 1-2.1-5.1M19.4 4.6v3.6h-3.6');
const clockFace = CI(12, 12, 8.6) + P('M12 7v5.2l3.4 2.1');
const hourglassP = P('M7 3.2h10M7 20.8h10M8 3.2c0 4.6 7.9 5.6 7.9 8.8S8 16.2 8 20.8M16 3.2c0 4.6-7.9 5.6-7.9 8.8s7.9 4.2 7.9 8.8');
const germ = CI(12, 12, 4.6) + P('M12 3.2v4.2M12 16.6v4.2M3.2 12h4.2M16.6 12h4.2M5.8 5.8l2.9 2.9M15.3 15.3l2.9 2.9M5.8 18.2l2.9-2.9M15.3 8.7l2.9-2.9') + DOT(10.6, 11, 1) + DOT(13.4, 13.2, 1);
const paw = P('M12 12.4c-3 0-5.4 2.6-5.4 4.8 0 1.6 1.3 2.6 2.8 2.6 1 0 1.7-.5 2.6-.5s1.6.5 2.6.5c1.5 0 2.8-1 2.8-2.6 0-2.2-2.4-4.8-5.4-4.8z') + CI(6, 9.4, 1.7) + CI(9.6, 5.8, 1.8) + CI(14.4, 5.8, 1.8) + CI(18, 9.4, 1.7);
const swordsP = P('M4 4l9.5 9.5M4 4h3.3L15 11.7M4 4v3.3l7.7 7.7M20 4l-9.5 9.5M20 4h-3.3L9 11.7M20 4v3.3l-7.7 7.7M14.6 16.4l2.6 2.6M9.4 16.4L6.8 19M17.2 19l1.6 1.6M6.8 19l-1.6 1.6');
const doveP = P('M20.5 6.5c-1.6-.3-2.8.1-3.6 1.2l-2.6 3.6C11 15.5 6.6 16 3.5 15.5c2.2 2.4 5.6 3.6 9 2.8 3.6-.9 5.7-3.7 5.9-7.3l2.1-2.2-2.1-.4M14.3 11.3c-1.1-3.1-3.4-5.4-6.8-6.1.4 3 2 5.6 4.4 7.2') + DOT(17.8, 7.9, 0.8);
const flask = P('M9.5 3.5h5M10.3 3.5v5.4l-5.1 8.6a2 2 0 0 0 1.7 3h10.2a2 2 0 0 0 1.7-3l-5.1-8.6V3.5M7.6 14h8.8');
const bulb = P('M9 17.8h6M9.8 20.6h4.4M12 3.2a6 6 0 0 0-3.6 10.8c.6.5 1 1.3 1 2.1v1.7h5.2v-1.7c0-.8.4-1.6 1-2.1A6 6 0 0 0 12 3.2z');
const giftP = P('M4 9.5h16v3.2H4zM5.4 12.7V20h13.2v-7.3M12 9.5V20M12 9.5C10.6 6.4 7.2 5.4 7.2 7.4 7.2 9 10.4 9.5 12 9.5zM12 9.5c1.4-3.1 4.8-4.1 4.8-2.1 0 1.6-3.2 2.1-4.8 2.1z');
const wheat = P('M12 21V7.5M12 9.6c-1.6-.6-2.6-2-2.6-3.8 1.6.6 2.6 2 2.6 3.8zM12 9.6c1.6-.6 2.6-2 2.6-3.8-1.6.6-2.6 2-2.6 3.8zM12 13.6c-1.6-.6-2.6-2-2.6-3.8 1.6.6 2.6 2 2.6 3.8zM12 13.6c1.6-.6 2.6-2 2.6-3.8-1.6.6-2.6 2-2.6 3.8zM12 17.6c-1.6-.6-2.6-2-2.6-3.8 1.6.6 2.6 2 2.6 3.8zM12 17.6c1.6-.6 2.6-2 2.6-3.8-1.6.6-2.6 2-2.6 3.8zM12 7.5V3.2');
const breadP = P('M4.6 12.4a4.2 4.2 0 0 1 2.3-7.6c1.5 0 2.4.5 3 1.1a6.6 6.6 0 0 1 4.2 0c.6-.6 1.5-1.1 3-1.1a4.2 4.2 0 0 1 2.3 7.6V19a1.2 1.2 0 0 1-1.2 1.2H5.8A1.2 1.2 0 0 1 4.6 19zM9.4 9.6l-1 2.4M12.6 9.6l-1 2.4M15.8 9.6l-1 2.4');
const shieldP = P('M12 3.2l7.4 2.7v5.7c0 4.6-3.1 8.2-7.4 9.4-4.3-1.2-7.4-4.8-7.4-9.4V5.9z');
const chain = P('M9.6 14.4l4.8-4.8M10.4 7.6l1.4-1.4a3.4 3.4 0 0 1 4.8 4.8l-1.4 1.4M13.6 16.4l-1.4 1.4a3.4 3.4 0 0 1-4.8-4.8l1.4-1.4');
const tagP = P('M3.6 12.6V4.4a.8.8 0 0 1 .8-.8h8.2l8 8a1.6 1.6 0 0 1 0 2.3l-6.3 6.3a1.6 1.6 0 0 1-2.3 0z') + DOT(8, 8, 1.4);
const pinP = P('M12 21.3s-6.3-6.1-6.3-11a6.3 6.3 0 0 1 12.6 0c0 4.9-6.3 11-6.3 11z') + CI(12, 10.2, 2.3);
const crownP = P('M4 17.5L3 7.5l5 4.2 4-6.4 4 6.4 5-4.2-1 10zM4.6 20.5h14.8');
const tabletP = P('M5 20.5V7.5a3.5 3.5 0 0 1 7 0v13zM12 20.5V7.5a3.5 3.5 0 0 1 7 0v13zM7 10h3M7 13h3M7 16h3M14 10h3M14 13h3M14 16h3');
const rocketP = P('M12 2.6c3.2 2.4 4.4 6 4.2 10.4l-1.9 3.4H9.7L7.8 13c-.2-4.4 1-8 4.2-10.4zM7.8 13l-2.6 3v3.2l3.6-1.6M16.2 13l2.6 3v3.2l-3.6-1.6M10.4 16.4l-.4 3.4 2 1.6 2-1.6-.4-3.4') + CI(12, 9, 1.6);
const magnetP = P('M5.5 4.5h4v7.8a2.5 2.5 0 0 0 5 0V4.5h4v7.8a6.5 6.5 0 0 1-13 0zM5.5 8h4M14.5 8h4');
const thermo = P('M12 3a2.2 2.2 0 0 0-2.2 2.2v8.6a4 4 0 1 0 4.4 0V5.2A2.2 2.2 0 0 0 12 3zM12 9v7');
const eyeP = P('M2.6 12s3.4-6.2 9.4-6.2 9.4 6.2 9.4 6.2-3.4 6.2-9.4 6.2S2.6 12 2.6 12z') + CI(12, 12, 2.8);
const snowflake = P('M12 2.6v18.8M3.9 7.3l16.2 9.4M3.9 16.7l16.2-9.4M9.6 3.8L12 6.2l2.4-2.4M9.6 20.2L12 17.8l2.4 2.4M3.6 10.6l3.2.8-.8 3.2M20.4 10.6l-3.2.8.8 3.2');
const tornado = P('M3.5 4.5h17M5.5 8.5h13M8 12.5h9M10 16.5h5.5M11.5 20.5h2.5');
const volcano = P('M3 20.5l5.6-9.6h6.8l5.6 9.6M8.6 10.9l1.6-1.4h3.6l1.6 1.4M11 7.6c-.8-1.2-.2-2.6 1-3.2M12.6 6.6c1.2-.6 1.4-2 .8-3.2M14.4 7c1-.2 1.8-1 1.8-2.2');
const meteor = CI(15.6, 8.4, 3.3) + P('M13.2 10.8L3.6 20.4M11.6 7.8L4.4 15M16.2 12.4l-6.8 6.8');
const fogLines = P('M3.5 9h17M3.5 12.5h13M7 16h13.5M3.5 19.5h11');
const windLines = P('M3 9h11.5a2.6 2.6 0 1 0-2.6-2.6M3 13h15a2.6 2.6 0 1 1-2.6 2.6M3 17h8');
const rainL = P('M8.5 20l-1 2M12 20l-1 2M15.5 20l-1 2');
const ff = P('M4 6.5l7 5.5-7 5.5zM12 6.5l7 5.5-7 5.5z');
const rew = P('M20 6.5l-7 5.5 7 5.5zM12 6.5L5 12l7 5.5z');
const stepP = P('M6 6l8 6-8 6zM17 6v12');
const orbitP = P('M2.8 12c0-2.6 4.1-4.6 9.2-4.6s9.2 2 9.2 4.6-4.1 4.6-9.2 4.6S2.8 14.6 2.8 12z') + CI(12, 12, 2.6) + DOT(19.4, 10.2, 1.5);
const sliders = P('M5 4v16M12 4v16M19 4v16') + CI(5, 15, 2) + CI(12, 8, 2) + CI(19, 13, 2);
const atom = CI(7.4, 14.6, 3.2) + CI(15.6, 8.4, 3.6) + CI(16.4, 17, 2.2) + CI(6.6, 6.2, 1.8);

const SVG_OPEN = '<svg class="gn-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">';

/** composed icons by key */
const ICONS: Record<string, string> = {
  // ── Shape ──
  mountain: peak + ground + arrowUp(19, 9, 3),
  valley: P('M2.5 6.5l6 10h7l6-10') + ground + arrowDown(12, 3, 9.5),
  flatten: P('M3 15h18M3 19h18') + P('M8 4l4 4 4-4M8 11l4-3 4 3'),
  smooth: P('M3 11.5c3-3.5 4.5 3 9 0s6 3.5 9 0') + P('M3 17.5h18'),
  rough: P('M2.5 15l2.5-5 2 3.4 2.4-6 2.4 5.4 1.8-2.8 2.4 5 2-3.2 2.5 3.2') + ground,
  crater: P('M2.5 12.5c1.6 0 2.2-1.6 3.3-1.6 1.5 0 1.6 6.6 6.2 6.6s4.7-6.6 6.2-6.6c1.1 0 1.7 1.6 3.3 1.6') + P('M8 6.5l-1-2M12 5.5V3M16 6.5l1-2'),
  peaks: P('M1.8 19l4.4-7.6 2.6 3.6L13 6.4l4 7 1.8-2.6 3.4 8.2') + ground,
  sea: wave(13) + wave(17.2) + P('M3 7l3 3h12l3-3'),
  sand: P('M2.5 17.5c3.2-4.6 7-5.6 10.2-4.2 2.6 1.1 4.3.5 8.8-2.3') + ground + DOT(7, 9, 0.9) + DOT(11, 6.6, 0.9) + DOT(15.2, 8.2, 0.9) + DOT(18.4, 5.8, 0.9),
  snow: at(6, 2, 0.5, snowflake) + ground + P('M3 17c3-1.6 6-1.6 9 0s6 1.6 9 0'),
  soil: P('M3 12.5h18') + ground + DOT(6.4, 15.4) + DOT(10.6, 17.4) + DOT(15, 15.2) + DOT(18.4, 17.8) + at(6.5, 0.5, 0.45, leaf),
  ash: P('M3 17.5h18') + ground + DOT(6, 8.5, 0.9) + DOT(9.6, 5.4, 0.9) + DOT(12.6, 10.4, 0.9) + DOT(16, 6.6, 0.9) + DOT(18.6, 11.4, 0.9) + DOT(8.4, 13.4, 0.9),
  ice: P('M4 20.5l2.4-9 5.6-6.5 5.6 6.5 2.4 9M8.6 11.5h6.8M12 5v6.5'),
  rock: P('M3.5 19.5l2.2-7.2 4.4-4.6 6.2 1.6 3.2 5.4.9 4.8zM10.1 7.7l1.3 4.9 4.9 1.1M11.4 12.6l-4.9 3.4'),
  lava: P('M3 20.5h18M4.6 20.5c.8-4 2.4-6.4 4.4-7.6 1.2-.7 1.6-2 1-3.6 3.4 1 5.2 3.6 5.2 6.8 0 1.6-.4 3-1 4.4') + P('M16.2 10.6c.8-1 1.8-1.4 3-1.2M13.6 6.4c.4-1.2 1.4-2 2.6-2.2') + DOT(18.4, 14.6, 1.1),
  pin: pinP,
  pave: P('M7.5 3.5L4.5 20.5M16.5 3.5l3 17M12 4v2.5M12 9.5v3M12 15.5v3'),
  // ── Water ──
  water: drop + P('M9 14.5a3 3 0 0 0 3 3'),
  dry: drop + P('M5 5l14 14'),
  drain: P('M4 6.5h16l-5.6 7v6l-4.8 1.6v-7.6z'),
  rain: cloudHi + P('M8.2 16.5l-1.2 3M12 16.5l-1.2 3M15.8 16.5l-1.2 3'),
  flood: house + wave(17.4) + P('M3 21c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0'),
  wave: P('M2.5 19.5c3.6 0 5.2-2.4 6-6.2C9.6 8 12.5 4.5 17 4.5c2.2 0 3.6.9 4.4 2.2-2.6-.4-4.4.8-4.4 3.3 0 2 1.4 3 3.4 3') + ground,
  'sea-up': wave(17) + arrowUp(12, 12, 3.5),
  'sea-down': wave(9) + arrowDown(12, 12, 20.5),
  spring: P('M3 20.5h18M12 20.5v-7') + P('M12 13.5c-1.6-3-4.6-3.4-6.6-2.2M12 13.5c1.6-3 4.6-3.4 6.6-2.2M12 13.5c0-4 .8-7 0-9.5') + DOT(6.2, 6.6, 0.9) + DOT(17.8, 6.6, 0.9),
  river: P('M7 2.5c1.8 3 .2 5-1.6 7.4C3.6 12.4 4.4 15 7.8 16.4c3 1.2 4.6 3.2 3.8 5.1M12.6 2.5c1.8 3 .2 5-1.6 7.4-1.8 2.5-1 5.1 2.4 6.5 3 1.2 4.6 3.2 3.8 5.1'),
  'water-miracle': drop + at(13, 1.5, 0.42, star5),
  // ── Sky ──
  storm: cloudHi + P('M12.6 14.5l-2.2 3.6h3l-1.8 3.6'),
  snowflake,
  blizzard: cloudHi + P('M3 17h10.5a2.2 2.2 0 1 0-2.2-2.2M6 20.5h12.5') + DOT(17.6, 16.6, 0.9) + DOT(20.2, 18.8, 0.9) + DOT(4.2, 14.4, 0.8),
  hail: cloudHi + CI(8.2, 18, 1.3) + CI(12.4, 20, 1.3) + CI(16.2, 17.6, 1.3),
  fog: at(3, -2, 0.75, cloud) + fogLines.replace('M3.5 9h17M3.5 12.5h13', 'M3.5 14h17'),
  sandstorm: windLines + DOT(19.6, 18.4, 0.9) + DOT(17.2, 20.6, 0.9) + DOT(13.4, 19.6, 0.9) + DOT(20.8, 5.2, 0.8),
  ashfall: cloudHi + DOT(8.2, 17.4, 0.95) + DOT(11.4, 19.6, 0.95) + DOT(14.6, 17.2, 0.95) + DOT(16.8, 20.2, 0.95) + DOT(9.4, 21.2, 0.95),
  acid: cloudHi + P('M9 16.5c-.9 1.3-1.4 2.2-1.4 3a1.4 1.4 0 0 0 2.8 0c0-.8-.5-1.7-1.4-3zM15 16.5c-.9 1.3-1.4 2.2-1.4 3a1.4 1.4 0 0 0 2.8 0c0-.8-.5-1.7-1.4-3z'),
  blood: cloudHi + F('M12 15.8c-1.2 1.7-1.9 2.9-1.9 3.9a1.9 1.9 0 0 0 3.8 0c0-1-.7-2.2-1.9-3.9z') + P('M7.6 16.6l-.8 2M16.4 16.6l-.8 2'),
  sun,
  cold: thermo + P('M17.4 4.2v5M14.9 6.7h5'),
  aurora: P('M3 19.5c2-6 4-8.5 6-8.5s2.2 3.5 4.2 3.5S17 7 21 4.5') + P('M3 15.5c2-3.5 3.7-5 5.4-5M15.6 12c1.6-2.2 3.4-3.6 5.4-4.1') + ground,
  monsoon: cloudHi + P('M6.6 15.8l-1.6 4M10 15.8l-1.6 4M13.4 15.8l-1.6 4M16.8 15.8l-1.6 4'),
  cloud,
  clear: at(1, 1, 0.92, sun),
  'sun-clear': at(-1, -1, 0.7, sun) + P('M11.5 21h8a2.6 2.6 0 0 0 .3-5.2 3.7 3.7 0 0 0-7.1-1A2.8 2.8 0 0 0 11.5 21z') + P('M3 21L21 3'),
  'globe-weather': globe + at(12.5, 0.5, 0.45, cloud),
  season: CI(12, 12, 8.6) + P('M12 3.4v17.2M3.4 12h17.2') + at(3.6, 3.4, 0.33, leaf) + at(13, 13, 0.33, snowflake) + at(13.2, 3.4, 0.33, sun),
  'storm-miracle': cloudHi + P('M9 14.5l-1.6 3h2.4l-1.4 3.2M15.2 14.5l-1.6 3h2.4l-1.4 3.2'),
  lightning: bolt,
  calm: P('M3 9c2.6-2 5.2-2 7.8 0s5.2 2 7.8 0M3 14c2.6-2 5.2-2 7.8 0s5.2 2 7.8 0') + P('M5 19h14'),
  'new-weather': cloudHi + plusSmall(12, 18.5),
  // ── Time ──
  clock: clockFace,
  day: P('M12 3.4a8.6 8.6 0 0 1 0 17.2z') + CI(12, 12, 8.6),
  'sun-stop': at(-1.5, -1.5, 0.75, sun) + P('M15.6 14.5v6.5M19.6 14.5v6.5'),
  year: CI(12, 12, 8.6) + DOT(12, 3.4, 1.6) + P('M12 12l4.4-4.4') + P('M12 7v1.4M17 12h-1.4M12 17v-1.4M7 12h1.4'),
  tilt: CI(12, 12, 6.4) + P('M7.2 3.4l9.6 17.2M5.6 12h12.8'),
  speed: ff,
  step: stepP,
  rewind: rew,
  history: circArrow.replace('M19.2 12a7.2 7.2 0 1 1-2.1-5.1M19.4 4.6v3.6h-3.6', 'M4.8 12a7.2 7.2 0 1 0 2.1-5.1M4.6 4.6v3.6h3.6') + P('M12 8v4.2l2.8 1.8'),
  hourglass: hourglassP,
  // ── Worlds ──
  air: P('M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h8'),
  vacuum: `<circle cx="12" cy="12" r="8.6" stroke-dasharray="2.4 2.6"/>` + P('M8.6 12h6.8'),
  gases: atom,
  star: star5,
  'sun-bright': sun + P('M18.6 2.6v3.6M16.8 4.4h3.6'),
  gravity: P('M12 3.5v8M8.8 8.3L12 11.5l3.2-3.2M6 3.5v5M3.8 6.3L6 8.5l2.2-2.2M18 3.5v5M15.8 6.3L18 8.5l2.2-2.2') + P('M3 15h18') + P('M5 19.5h14'),
  magnet: magnetP,
  spin: CI(12, 12, 6) + P('M12 2.4v19.2M6 12h12') + P('M3.4 9.2a9.2 9.2 0 0 1 4.2-5.4M7.6 3.8l.4 3.2-3.2.4'),
  thermometer: thermo + P('M16.6 5.5h3M16.6 8.5h2M16.6 11.5h3'),
  orbit: orbitP,
  'new-world': CI(11, 13, 7) + P('M5.4 9.4c2.6 1.6 4.8 1.2 6.6-.6M8 19.2c.8-2.6 2.6-3.6 5.2-3') + plusSmall(19.5, 4.5),
  crack: CI(12, 12, 8.6) + P('M10.4 3.6l2 4.4-2.6 2.6 3.2 3.4-1.6 3.4 1.2 3'),
  erase: CI(12, 12, 8.6) + xMark.replace('M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8', 'M8 8l8 8M16 8l-8 8'),
  moon: moonP,
  'moon-fall': at(9, 0, 0.55, moonP) + CI(9, 16.5, 4) + P('M15.8 9.4l-3.4 3.4M13 8.4l-2.4 2.4'),
  seed: P('M12 3.5c3.4 2.6 5.4 6 5.4 9.6A5.4 5.4 0 0 1 12 18.5a5.4 5.4 0 0 1-5.4-5.4c0-3.6 2-7 5.4-9.6zM12 8v10.5') + ground,
  // ── Life ──
  sprout: leaf + ground,
  tree: conifer,
  'forest-miracle': at(-2, 0, 0.9, conifer) + at(9.5, 5, 0.6, broadTree) + at(14, 0, 0.36, star5),
  biome: P('M3.5 20.5V8.5l4.5-4 4.5 3 4-3 4 4v12') + P('M3.5 14.5l4.5-2.5 4.5 2 4-2 4 2.5M8 4.5V12M16.5 4.5V12'),
  paw,
  'new-beast': at(-1, 2, 0.8, paw) + plusSmall(19.4, 4.6),
  cull: at(0, 3, 0.75, paw) + minusSmall(19, 4.6),
  breed: at(-2.5, 3.5, 0.62, paw) + at(8, 3.5, 0.62, paw) + plusSmall(12, 4),
  'skull-paw': at(-1, 2, 0.8, paw) + xMark.replace('M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8', 'M16 2.5l5 5M21 2.5l-5 5'),
  death: skull,
  heal: CI(12, 12, 8.6) + cross.replace('M12 5v14M5 12h14', 'M12 7.5v9M7.5 12h9'),
  'heal-miracle': cross.replace('M12 5v14M5 12h14', 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z') + at(15, 0.5, 0.36, star5),
  bread: breadP,
  fertility: heart + P('M12 16.5v-6M9 13.5h6'),
  bless: P('M12 7.5v12M9 10.5h6') + P('M5.6 4.6c1.6-1.4 3.8-2 6.4-2s4.8.6 6.4 2') + DOT(4.2, 9, 0.8) + DOT(19.8, 9, 0.8),
  curse: skull.replace(DOT(9.2, 11.2, 1.5) + DOT(14.8, 11.2, 1.5), '') + P('M8.2 10.4l2.2 1.4M15.8 10.4l-2.2 1.4'),
  // ── Peoples ──
  people: personAt(-0.5, 3.6) + personAt(9.4, 3.6) + personAt(4.4, 7.4, 0.68),
  move: personAt(-1, 4, 0.7) + arrowRight(12, 11, 21),
  possess: person.replace(CI(12, 5.4, 2.4), '') + CI(12, 5.4, 2.4) + at(14, 0.5, 0.4, eyeP),
  walk: CI(13.4, 4.2, 2.1) + P('M12.6 7.4l-2.6 5.2 3.2 2.6-1.6 5.8M10 12.6l-3.6 2.6M12.6 7.4l3.6 3 2.8-.4M13.2 15.2l3.4 2.4'),
  act: person + P('M17.8 5l2.6-2.6M19.6 8.2h2.6M17.8 2v-.1'),
  strike: personAt(-2, 4.5, 0.72) + bolt.replace('M13.4 2.2L5.8 13.2h5.4l-1.1 8.6 7.9-11.6h-5.5z', 'M19 2.2l-4.4 6.4h3.2l-.7 5 4.6-6.8h-3.2z'),
  'heal-one': personAt(-2, 4.5, 0.72) + plusSmall(18, 6),
  disciple: person + P('M8.6 3.2c1-.9 2.1-1.4 3.4-1.4s2.4.5 3.4 1.4'),
  orders: scroll,
  spark: P('M12 2.8l1.7 5.5 5.5 1.7-5.5 1.7L12 17.2l-1.7-5.5L4.8 10l5.5-1.7z') + P('M18.4 15.6l.8 2.4 2.4.8-2.4.8-.8 2.4-.8-2.4-2.4-.8 2.4-.8z'),
  name: tagP,
  found: house + P('M17 3.5v5M14.5 6h5'),
  raze: house + P('M3 3l18 18'),
  gift: giftP,
  logs: P('M4.2 15.6l13-6.2M5.8 19.6l13-6.2') + CI(4.6, 17.6, 2.1) + CI(18.6, 11.4, 2.1) + P('M8 4.5l2.6 4.4M12 3.5l1 5'),
  split: P('M3 11.2L10.2 5.6M21 11.2l-7.2-5.6M5 9.8V19h5.2M19 9.8V19h-5.2M12 3v18.5'),
  merge: P('M4 4.5c0 6 8 6 8 11.5v4.5M20 4.5c0 6-8 6-8 11.5') + P('M2 8.5l2-4 2 4M18 8.5l2-4 2 4'),
  dove: doveP,
  swords: swordsP,
  sign: P('M12 21.5V3M12 4.5h7l2 2.5-2 2.5h-7M12 11h-7l-2 2.5 2 2.5h7'),
  // ── Ideas ──
  book,
  scroll,
  forget: at(-1, 0, 0.82, bulb) + P('M14.8 3.5l6.2 6.2M21 3.5l-6.2 6.2'),
  'gift-box': giftP,
  idea: bulb,
  artifact: P('M12 2.8l6.4 3.7v7.4L12 17.6l-6.4-3.7V6.5zM12 10.2l6.4-3.7M12 10.2v7.4M12 10.2L5.6 6.5') + P('M7 20.8h10'),
  'paw-new': at(-1, 3, 0.75, paw) + at(12, 0, 0.48, giftP),
  crop: wheat,
  germ,
  strangers: personAt(-1.6, 3.8, 0.7) + personAt(8.4, 3.8, 0.7) + P('M10.8 10.4h2.4'),
  flask,
  withdraw: at(-2, 0, 0.82, giftP) + P('M15.5 18.5h6'),
  invent: P('M14.6 3.4l6 6-9.8 9.8-6.6.6.6-6.6zM12.4 5.6l6 6') + P('M4.8 15.2l4 4'),
  lightbulb: bulb + P('M10.6 10.4l1.4 1.6 1.4-1.6'),
  // ── Fire ──
  fire: flame,
  'no-fire': flame + P('M4 4l16 16'),
  flame: flame + at(14.4, 1, 0.4, star5),
  fireball: CI(14.4, 9.6, 4.2) + P('M11.4 12.6l-7.8 7.8M10.2 9.2l-6 6M14.6 14.2l-5 5') + P('M13 8.4c1-.6 2.2-.4 2.9.4'),
  firestorm: at(-3, 1, 0.72, flame) + at(7.6, -0.6, 0.78, flame) + P('M2.5 20.5h19'),
  // ── Disasters ──
  'd-meteor': meteor + ground.replace('M3 20.5h18', 'M14 20.5h7'),
  'd-meteor-shower': at(2.5, -1.5, 0.62, meteor) + at(-2.6, 4, 0.5, meteor) + at(9.6, 8.8, 0.5, meteor),
  'd-comet': CI(16.6, 7.4, 2.6) + P('M14.6 9.4c-3.6 3.2-7.6 6.6-11.6 11.1M14.2 6.2c-2.8.8-6.8 3.2-10.6 7.4M17.8 10c-.8 2.8-3.2 6.8-7.4 10.6'),
  'd-swarm': P('M12 9.4c-1.6 0-2.6 1.4-2.6 3.4s1 3.6 2.6 3.6 2.6-1.6 2.6-3.6-1-3.4-2.6-3.4zM9.6 11.4L6 9.4M14.4 11.4L18 9.4M9.4 14L5.6 15M14.6 14l3.8 1M10.8 9.6l-1.4-2.4M13.2 9.6l1.4-2.4') + DOT(4, 4.6, 0.8) + DOT(20, 4.2, 0.8) + DOT(3.6, 19.6, 0.8) + DOT(19.4, 20, 0.8) + DOT(12, 21, 0.8),
  'd-volcano': volcano,
  'd-supervolcano': volcano + P('M5 5.5c0-1.6 1.4-2.6 3-2.4M19 5.5c0-1.6-1.4-2.6-3-2.4') + DOT(4, 8.2, 0.9) + DOT(20, 8.2, 0.9),
  'd-quake': P('M2.5 12h3.2l1.6-4.4 2.4 9.6 2.4-12.4 2.4 11.2 1.8-4.6 1.6 1.6h3.6') + P('M3 20.5h6.6l1.4-1.4 1.4 1.4H21'),
  'd-sinkhole': P('M2.5 9.5h4.2M17.3 9.5h4.2M6.7 9.5c.8 6.6 2.6 10 5.3 10s4.5-3.4 5.3-10') + P('M9.8 14.5c.6 1.6 1.4 2.4 2.2 2.4s1.6-.8 2.2-2.4'),
  'd-rift': P('M3 20.5h6M15 20.5h6M9 20.5l1.4-4.2-2-3.2 2.6-3.4-1.4-3.4 1.8-3.8M15 20.5l-1.4-4.2 2-3.2-2.6-3.4 1.4-3.4-1.8-3.8') + DOT(12, 12.6, 0.9),
  'd-flood': house + wave(15.6) + wave(19.8),
  'd-tsunami': P('M2 19.5c4.2 0 6-2.6 6.8-6.6.9-4.4 3.6-8.4 8.4-8.4 2.2 0 3.6 1 4.4 2.2-2.6-.4-4.4 1-4.4 3.6 0 2.2 1.4 3.4 3.6 3.4') + P('M14.5 15.5c1.8 1.4 3.6 1.4 6.5 0') + ground,
  'd-drought': P('M2.5 20.5h19M5 20.5l2.4-3.6 3 1.8 2-3.2 2.4 2.4 2.6-3') + at(6, -2, 0.6, sun),
  'd-hurricane': P('M12 12m-2.4 0a2.4 2.4 0 1 0 4.8 0 2.4 2.4 0 1 0-4.8 0') + P('M12 3.2c-4.6 0-8.6 3.2-8.6 7.6 2.2-2.4 5-3.4 8-3.2M12 20.8c4.6 0 8.6-3.2 8.6-7.6-2.2 2.4-5 3.4-8 3.2'),
  'd-tornado': tornado,
  'd-wildfire': at(-3.4, 2, 0.72, flame) + at(5, 3.6, 0.6, conifer) + at(9.6, 0, 0.6, flame),
  'd-firestorm': at(-3, 1, 0.72, flame) + at(7.6, -0.6, 0.78, flame) + P('M2.5 21c3.2-1.4 6.4-1.4 9.5 0s6.3 1.4 9.5 0'),
  'd-plague': skull.replace(DOT(9.2, 11.2, 1.5) + DOT(14.8, 11.2, 1.5), DOT(9.2, 11.2, 1.3) + DOT(14.8, 11.2, 1.3)) + DOT(3.6, 4.6, 0.8) + DOT(20.4, 4.6, 0.8) + DOT(3.2, 17.4, 0.8) + DOT(20.8, 17.4, 0.8),
  'd-blight': wheat + P('M4 4l16 16'),
  'd-infestation': P('M8 6.6c-1.4 0-2.4 1.2-2.4 2.8s1 3 2.4 3 2.4-1.4 2.4-3S9.4 6.6 8 6.6zM16 11.6c-1.4 0-2.4 1.2-2.4 2.8s1 3 2.4 3 2.4-1.4 2.4-3-1-2.8-2.4-2.8zM5.8 8.4L3.4 7M10.2 8.4l2.4-1.4M5.6 11.4L3 12.4M13.8 13.4l-2.4-1.4M18.2 13.4l2.4-1.4M18.4 16.4l2.6 1') + ground.replace('M3 20.5h18', 'M3 21h18'),
  'd-solar-flare': CI(12, 12, 4.4) + P('M12 2.6v3M12 18.4v3M2.6 12h3M18.4 12h3') + P('M16.2 7.6c2.6-2.6 4.6-2.4 5.2-.8-.4 1.8-2.4 2.6-4.8 2.8') + P('M5.4 5.4l1.8 1.8M5.4 18.6l1.8-1.8M18.6 18.6l-1.8-1.8'),
  'd-impact-winter': at(-2, -2, 0.7, meteor) + at(9.5, 9.5, 0.55, snowflake),
  'd-gravity-slip': P('M12 20.5v-8M8.8 15.7l3.2-3.2 3.2 3.2') + P('M3 20.5h18') + CI(6.4, 6.6, 1.8) + CI(17.4, 4.4, 1.5) + CI(12, 6.6, 1.2),
  'd-magnetic-storm': magnetP + bolt.replace('M13.4 2.2L5.8 13.2h5.4l-1.1 8.6 7.9-11.6h-5.5z', 'M13.6 13.4l-2.6 3.8h2.2l-.6 4.2 3-4.6h-2.2z'),
  'd-eclipse': CI(12, 12, 6.6) + F('M15.6 6.8a6.6 6.6 0 1 1-8.8 8.8 7.6 7.6 0 0 0 8.8-8.8z') + P('M12 2.2v1.6M12 20.2v1.6M2.2 12h1.6M20.2 12h1.6'),
  'd-moon-fall': at(5, -1, 0.62, moonP) + CI(12, 17.6, 3) + P('M3 21h18M8 12.6l-2-2M15.6 12.6l2-2'),
  'd-rogue-flyby': ringWorld + P('M2 4.5l3 1.6M4 2.4l2.4 2.6'),
  'd-acid-rain': cloudHi + P('M9 16.5c-.9 1.3-1.4 2.2-1.4 3a1.4 1.4 0 0 0 2.8 0c0-.8-.5-1.7-1.4-3zM15 16.5c-.9 1.3-1.4 2.2-1.4 3a1.4 1.4 0 0 0 2.8 0c0-.8-.5-1.7-1.4-3z') + DOT(12, 20.4, 0.8),
  'd-ice-age': globe + at(12.6, 12.6, 0.44, snowflake),
  'd-heat-wave': at(-2, -2, 0.62, sun) + P('M8 21c0-2 2-2.4 2-4.4S8 14.2 8 12.4M12.8 21c0-2 2-2.4 2-4.4s-2-2.4-2-4.2M17.6 21c0-2 2-2.4 2-4.4s-2-2.4-2-4.2'),
  'd-dust-bowl': P('M2.5 20.5h19') + P('M3.5 16.5c2.6-2.6 6.4-3 9.4-1.4 2.6 1.4 5.2 1 7.6-1') + DOT(6.4, 9.6, 0.9) + DOT(10, 7, 0.9) + DOT(13.6, 9.8, 0.9) + DOT(17.2, 7.2, 0.9) + DOT(19.6, 10.4, 0.9) + DOT(4, 5.6, 0.8),
  'd-glass-storm': windLines + P('M17.4 17.2l1.6-2.6 1.6 2.6zM14.4 20.8l1.2-2 1.2 2zM19.6 21.2l1-1.6 1 1.6z'),
  'd-overgrowth': P('M12 21V9M12 13c-3.6 0-6-2.4-6-6 3.6 0 6 2.4 6 6zM12 11c0-3.2 2.2-5.4 5.4-5.4 0 3.2-2.2 5.4-5.4 5.4z') + P('M4 21c1-3.4 2.6-5.2 5-5.6M20 21c-1-3.4-2.6-5.2-5-5.6M12 9c.2-2.4 1.2-4.2 3-5.6'),
  'd-leviathan': P('M2.5 17.5c2 0 2.8-1.6 4.4-1.6s2.4 1.6 4.2 1.6 2.4-1.6 4.2-1.6 2.6 1.6 4.2 1.6') + P('M6.4 15.6c.4-5.2 3-8.8 7.2-9.6 2.6-.5 4.8.4 6.2 2.2-2.4-.2-3.8.8-4.2 2.6M15.6 11c1.6-.2 2.8.4 3.6 1.6') + DOT(17.6, 8.8, 0.9) + ground.replace('M3 20.5h18', 'M3 21h18'),
  'd-forgetting-fog': fogLines + at(10, -0.5, 0.5, bulb),
  'd-stampede': at(-2.5, 5, 0.6, paw) + at(5, 5, 0.6, paw) + at(12.5, 5, 0.6, paw) + P('M3 3.5l3 2M8.6 3l2.2 2.2M14.6 3l1.8 2.4'),
  stop: P('M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z') + P('M8.6 12h6.8'),
  scale: P('M4 20l6-6M20 4l-6 6M4 14v6h6M20 10V4h-6M14 20h6v-6M10 4H4v6M4 4l6 6M20 20l-6-6'),
  'move-d': P('M12 3v18M3 12h18M9 5.6L12 3l3 2.6M9 18.4l3 2.6 3-2.6M5.6 9L3 12l2.6 3M18.4 9L21 12l-2.6 3'),
  freeze: snowflake,
  'star-fall': at(5, -0.5, 0.6, star5) + P('M10.4 11.4L4 17.8M13.4 13.2L8.2 18.4M8.4 9.8l-4.6 4.6') + ground.replace('M3 20.5h18', 'M3 21h11'),
  // ── Hand ──
  grab: fist,
  throw: at(-3, 3, 0.78, openHand) + P('M15.6 6.4c2-1.6 3.8-1.8 5.6-1.2M17 9.6c1.6-.4 3-.2 4.2.6') + CI(18, 3.2, 1.4),
  'open-hand': openHand,
  place: at(0, -2.6, 0.82, openHand) + P('M5 21.5h14'),
  drop: at(0, -3.4, 0.78, openHand) + arrowDown(19.4, 13, 21),
  slap: openHand + P('M2.4 6.4l2.2 1.6M2 10.6h2.6M3 14.4l2.2-1'),
  stroke: openHand + P('M3 21.5c2.8-1.6 5.6-1.6 8.4 0s5.6 1.6 8.4 0'),
  shield: shieldP,
  cast: openHand + at(13.6, -0.6, 0.42, star5),
  // ── Creature ──
  creature: P('M6.6 8.6c-1.6-1.4-1.8-3.6-.6-5 1.4.4 2.4 1.4 2.8 2.8M17.4 8.6c1.6-1.4 1.8-3.6.6-5-1.4.4-2.4 1.4-2.8 2.8M12 6c-4 0-7 3-7 7 0 4.4 3.2 7.6 7 7.6s7-3.2 7-7.6c0-4-3-7-7-7zM9.6 16.6c1.4 1 3.4 1 4.8 0') + DOT(9.4, 12, 1.2) + DOT(14.6, 12, 1.2),
  leash: chain + P('M3.5 20.5l3-3M20.5 3.5l-3 3'),
  unleash: P('M9.6 14.4l1.4-1.4M13 11l1.4-1.4M10.4 7.6l1.4-1.4a3.4 3.4 0 0 1 4.8 4.8l-1.4 1.4M13.6 16.4l-1.4 1.4a3.4 3.4 0 0 1-4.8-4.8l1.4-1.4') + P('M4 4l2.4 2.4M20 20l-2.4-2.4'),
  mode: sliders,
  treat: P('M9.8 6.6a2.4 2.4 0 1 0-3.2 3.2l7.6 7.6a2.4 2.4 0 1 0 3.2-3.2zM14.2 17.4a2.4 2.4 0 1 0 3.2-3.2M9.8 6.6a2.4 2.4 0 1 0-3.2 3.2'),
  stick: P('M5 20L18.5 5.5M16.2 5.4l2.6-2.6M14.8 9.4l2.2-.2M9.4 14.2l-.6 2.2'),
  show: eyeP + at(13.8, 12.6, 0.42, openHand),
  go: P('M4 19.5l4.5-9.2 4.6 5.4L20 4.5M14.6 4.5H20V10'),
  'name-c': tagP,
  grow: P('M4 20h16M7 20v-4.6M12 20V10.6M17 20V5') + P('M14.6 7.4L17 5l2.4 2.4'),
  free: P('M5 21V9a7 7 0 0 1 14 0M9 21V11M15 21v-6M5 15h4') + P('M17.4 13l3.6-3.6M18.2 9.4h2.8v2.8'),
  // ── Laws ──
  law: tabletP,
  restraint: P('M12 3.5v17M6 20.5h12M4.5 7h15M4.5 7L2 13.5a3 3 0 0 0 5 0zM19.5 7L17 13.5a3 3 0 0 0 5 0z'),
  rival: crownP + P('M12 9.8v4.4'),
  banish: crownP + P('M3 3l18 18'),
  tablet: tabletP,
  'volcano-law': volcano + P('M17.2 3.2h3.6v3.6h-3.6z'),
  dna: P('M7 3c0 4.4 10 4.8 10 9s-10 4.6-10 9M17 3c0 4.4-10 4.8-10 9s10 4.6 10 9M8.6 6h6.8M8.4 18h7.2M10.2 9h3.6M10.2 15h3.6'),
  // ── space ──
  'w-rocket': rocketP,
  'w-recall': at(-2.5, 0, 0.82, rocketP) + P('M15.6 20.4h4.2a1.6 1.6 0 0 0 0-3.2h-3M17.4 22.2l-1.8-1.8 1.8-1.8'),
  'w-smite-ship': at(-2.5, 0, 0.82, rocketP) + P('M15.2 15.2l5.6 5.6M20.8 15.2l-5.6 5.6'),
  'w-flare': sun.replace(CI(12, 12, 4.2), CI(12, 12, 3.4)) + P('M14.4 9.6c2.6-2.4 5.6-2.8 7-1.6'),
  // ── categories ──
  'cat-shape': peak + ground,
  'cat-water': drop,
  'cat-sky': cloud + P('M8.6 20.4l-.8 1.6M12.4 20.4l-.8 1.6M16.2 20.4l-.8 1.6'),
  'cat-life': leaf + ground,
  'cat-peoples': personAt(-0.5, 3.6) + personAt(9.4, 3.6) + personAt(4.4, 7.4, 0.68),
  'cat-ideas': bulb,
  'cat-fire': flame,
  'cat-disasters': meteor + ground.replace('M3 20.5h18', 'M14 20.5h7'),
  'cat-hand': openHand,
  'cat-creature': '',
  'cat-worlds': ringWorld,
  'cat-time': hourglassP,
  'cat-laws': tabletP,
  // ── UI ──
  search: CI(10.6, 10.6, 6.2) + P('M15.2 15.2l5.6 5.6'),
  palette: CI(10.6, 10.6, 6.2) + P('M15.2 15.2l5.6 5.6') + P('M8.2 10.6h4.8M10.6 8.2v4.8'),
  radial: CI(12, 12, 8.6) + CI(12, 12, 3) + P('M12 3.4V9M12 15v5.6M3.4 12H9M15 12h5.6'),
  words: P('M4 6h16M4 10.5h10M4 15h13M4 19.5h7'),
  gesture: P('M4.2 17.4c2.6-6 5.2-9 7.8-9 3.6 0 1 8.6 4.4 8.6 1.6 0 2.8-2 3.8-5.6') + DOT(4.2, 17.4, 1.2),
  chronicle: book,
  overlay: P('M12 3.4L2.8 8.2 12 13l9.2-4.8zM2.8 12.2L12 17l9.2-4.8M2.8 16.2L12 21l9.2-4.8'),
  settings: CI(12, 12, 3) + P('M12 2.8v2.6M12 18.6v2.6M2.8 12h2.6M18.6 12h2.6M5.5 5.5l1.8 1.8M16.7 16.7l1.8 1.8M5.5 18.5l1.8-1.8M16.7 7.3l1.8-1.8') + CI(12, 12, 6.4),
  help: CI(12, 12, 8.6) + P('M9.6 9.4a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8v.8') + DOT(12, 17, 1.05),
  save: P('M5 3.5h11.5L20.5 7.5v13h-15.5zM8 3.5v5h7.5v-5M8 20.5v-6.5h8v6.5'),
  menu: P('M4 7h16M4 12h16M4 17h16'),
  close: P('M6.5 6.5l11 11M17.5 6.5l-11 11'),
  eye: eyeP,
  follow: CI(12, 12, 7.6) + CI(12, 12, 2.6) + P('M12 2.4v3M12 18.6v3M2.4 12h3M18.6 12h3'),
  target: CI(12, 12, 7.6) + CI(12, 12, 2.6) + P('M12 2.4v3M12 18.6v3M2.4 12h3M18.6 12h3'),
  play: P('M7 4.5l12 7.5-12 7.5z'),
  pause: P('M8 5v14M16 5v14'),
  plus: cross,
  minus: P('M5 12h14'),
  check: P('M4.5 12.5l5 5 10-11'),
  download: P('M12 3.5v12M7 10.5l5 5 5-5M4.5 20.5h15'),
  upload: P('M12 15.5v-12M7 8.5l5-5 5 5M4.5 20.5h15'),
  keyboard: P('M3 6.5h18v11H3zM6.5 10h1M10 10h1M13.5 10h1M17 10h1M7.5 13.5h9'),
  gamepad: P('M7.2 7.5h9.6a4.6 4.6 0 0 1 4.4 3.4l1 3.8a2.8 2.8 0 0 1-4.9 2.5l-1.6-1.9H8.3l-1.6 1.9a2.8 2.8 0 0 1-4.9-2.5l1-3.8a4.6 4.6 0 0 1 4.4-3.4zM7.5 10.5v3M6 12h3') + DOT(15.6, 11, 0.9) + DOT(17.6, 13, 0.9),
  mouse: P('M12 3a5.5 5.5 0 0 0-5.5 5.5v7a5.5 5.5 0 0 0 11 0v-7A5.5 5.5 0 0 0 12 3zM12 3v6M6.5 9h11'),
  layers: P('M12 3.4L2.8 8.2 12 13l9.2-4.8zM2.8 12.2L12 17l9.2-4.8'),
  sound: P('M4 9.5h3.6L12 5.5v13l-4.4-4H4zM15.4 9a4 4 0 0 1 0 6M17.8 6.4a7.6 7.6 0 0 1 0 11.2'),
  world: globe,
  pinHere: pinP,
  brush: P('M18.8 3.4a1.8 1.8 0 0 1 2.6 2.6l-8.6 8.6-2.6-2.6zM10.2 12c-2.2 0-4 1.6-4 3.8 0 1.4-.8 2.4-2.6 3 4 1.6 8.8.6 9.2-4.2'),
  worship: P('M12 21.5c-4.4-2.6-7.4-6.2-7.4-10.2a4.6 4.6 0 0 1 7.4-3.6 4.6 4.6 0 0 1 7.4 3.6c0 4-3 7.6-7.4 10.2z') + P('M12 3V1.6M7.6 4.2L6.8 3M16.4 4.2l.8-1.2'),
  fear: skull,
};
ICONS['cat-creature'] = ICONS.creature;

const CATEGORY_ICON: Record<string, string> = {
  Shape: 'cat-shape', Water: 'cat-water', Sky: 'cat-sky', Life: 'cat-life', Peoples: 'cat-peoples', Ideas: 'cat-ideas', Fire: 'cat-fire',
  Disasters: 'cat-disasters', Hand: 'cat-hand', Creature: 'cat-creature', Worlds: 'cat-worlds', Time: 'cat-time', Laws: 'cat-laws',
};

/** an icon's SVG markup; an unknown key falls back to its category's glyph, else a star */
export function icon(key: string | null | undefined, category?: string): string {
  const k = key ?? '';
  const body = ICONS[k] ?? (category && ICONS[CATEGORY_ICON[category] ?? ''] ) ?? ICONS.star;
  return `${SVG_OPEN}${body}</svg>`;
}

export function categoryIcon(category: string): string {
  return icon(CATEGORY_ICON[category] ?? 'star');
}

export function hasIcon(key: string): boolean { return key in ICONS; }

/** every icon key (the icon sheet in tests / dev) */
export function iconKeys(): string[] { return Object.keys(ICONS); }
