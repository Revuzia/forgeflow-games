// Chapter looks ("storybook kiln works", DESIGN-V2.md section 2). A level picks one with its optional
// `theme` field (LEVELS.md). Every theme is its own place AND its own time of day - light, not
// darkness, is what tells the chapters apart:
//   Water  (teal / cream / coral)
//     'slip'   the slip room        dawn mist: peach sky, teal glazed tile, cream walls, coral brick
//     'loft'   the drying loft      golden morning: honey boards, whitewash, teal nosings, big blue sky
//     'kiln'   the great kiln       amber dusk: coral firebrick, plum walls, rose-and-gold sky
//   Fire   (charcoal / ember / gold - dark only where fire should glow against it)
//     'pilot'  the pilot gallery    blue hour: slate flags, blue-charcoal brick, gold edges, lit windows
//     'flue'   the flue             night inside the stack: soot brick, a red glow from below, sparks
//     'wire'   the switch room      deep night, a gold moon: charcoal enamel with brass inlay
//   Clay   (terracotta / sage / bone) - placeholders until the Thrown Road has levels
//     'wedge'  the wedging yard     fresh morning: terracotta tile, bone plaster, sage timber
//     'bisque' the bisque store     high noon: bone-white ware, terracotta brick, hard light
//     'glost'  the glost kiln       sunset: celadon glaze, bone tile, coral sky
// Missing or unknown values fall back to 'slip' (never throw: level data is authored by hand).
// Pure data, no three.js import, so Node tests can check it.
//
// Units. Light colours are LINEAR rgb multipliers of the painted colour: a face in full sun shows
// its paint times (hemi sky + key), a face in shadow shows its paint times hemi alone - which is
// why shadows are coloured, never grey. Paint colours are '#rrggbb' sRGB, as drawn.

export const THEME_NAMES = ['slip', 'loft', 'kiln', 'pilot', 'flue', 'wire', 'wedge', 'bisque', 'glost'];
export const DEFAULT_THEME = 'slip';

// A paint is one drawn 2 m x 2 m swatch (textures.js): kind = the line-work, tones = flat fills,
// line = its own ink (a dark cousin of the fill, never black).
const metal = (tones, line, rivet) => ({ kind: 'metal', tones, line, rivet });
const clay = { kind: 'clay', tones: ['#d98a5c', '#cf7d52'], line: '#8a4628' };

/** The six block materials (LEVELS.md `mat`) painted from a theme's paints: floor / floorAlt / wall / brick / cap / dark / metal / clay. */
function surfaces(o = {}) {
  return {
    tile: { top: 'floor', side: 'wall', topTint: 1, sideTint: 1, glaze: o.glaze === undefined ? 0.5 : o.glaze },
    cream: { top: 'floorAlt', side: 'wallAlt', topTint: 1, sideTint: 1, glaze: o.glazeAlt === undefined ? 0.3 : o.glazeAlt },
    brick: { top: 'cap', side: 'brick', topTint: 1, sideTint: 1, glaze: 0 },
    dark: { top: 'dark', side: 'dark', topTint: 0.92, sideTint: 1, glaze: 0 },
    metal: { top: 'metal', side: 'metal', topTint: 1, sideTint: 0.96, glaze: 0.35 },
    clay: { top: 'clay', side: 'clay', topTint: 1, sideTint: 0.95, glaze: 0 },
  };
}

export const THEMES = {
  // ------------------------------------------------------------------------------------ WATER
  slip: {
    name: 'slip', campaign: 'water', time: 'dawn mist',
    hemi: [[0.52, 0.52, 0.72], [0.44, 0.38, 0.46]], key: [[0.6, 0.5, 0.36]],
    sun: [-0.36, 0.62, 0.7],
    fog: '#f7e6dc', fogNear: 36, fogFar: 90, fogDensity: 0.0189,
    exposure: 1,
    sky: { top: '#73bfe0', mid: '#bfe6e4', horizon: '#ffdcc2', glow: '#fff3cf', sun: '#fff7da', sunSize: 0.055, cloud: '#fff6ec', cloudShade: '#f6b9ae', clouds: 0.55, stars: 0, moon: 0, bands: 1 },
    ink: '#143244',
    moteLight: 0, dark: 0, glowK: 0.16, poolK: 0.3,
    paints: {
      floor: { kind: 'tile', tones: ['#2fa7a0', '#38b5ac', '#289b97'], line: '#14585f', inset: '#f7ecd2', shine: 0.32 },
      floorAlt: { kind: 'tile', tones: ['#f8edd4', '#f1e2c4', '#fcf4e0'], line: '#c1a47c', inset: '#2fa7a0', shine: 0.3 },
      wall: { kind: 'subway', tones: ['#f6ebd4', '#eedfc4', '#f9f1df'], line: '#c4a783', accent: '#f08c6e', accentP: 0.07 },
      wallAlt: { kind: 'subway', tones: ['#bfe5dc', '#b0dcd3', '#cbece4'], line: '#6aa7a0', accent: '#2fa7a0', accentP: 0.08 },
      brick: { kind: 'brick', tones: ['#ea866c', '#df775f', '#f29379'], line: '#a54c40' },
      cap: { kind: 'cap', tones: ['#fbf0da', '#f3e5c8'], line: '#c4a783' },
      dark: { kind: 'brick', tones: ['#237a82', '#1f6d76', '#28858c'], line: '#0f434b' },
      metal: metal(['#8fb6c4', '#84abba'], '#3a6074', '#d6eef2'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.6, glazeAlt: 0.45 }),
    trim: '#fff6e2', trimSide: '#e9d2b0',
    ao: 0.2,
    lamp: [1.0, 0.72, 0.4],
    ambient: 'mist',
    backdrop: 'works',
    abyss: { base: '#bfe6e4', swirl: '#f6fbf4', deep: '#7cc5cf' },
    window: [1.0, 0.86, 0.55],
    silhouette: '#9fb4dc', silhouetteFar: '#dbe2ee',
  },
  loft: {
    name: 'loft', campaign: 'water', time: 'golden morning',
    hemi: [[0.56, 0.52, 0.62], [0.52, 0.4, 0.3]], key: [[0.6, 0.55, 0.38]],
    sun: [0.48, 0.74, 0.47],
    fog: '#f8edd0', fogNear: 36, fogFar: 92, fogDensity: 0.0185,
    exposure: 1,
    sky: { top: '#3d9be0', mid: '#8fd0f2', horizon: '#fdf1c8', glow: '#fff6c8', sun: '#fffbe0', sunSize: 0.05, cloud: '#ffffff', cloudShade: '#c9e2f6', clouds: 0.75, stars: 0, moon: 0, bands: 1 },
    ink: '#3c2518',
    moteLight: 0, dark: 0, glowK: 0.16, poolK: 0.3,
    paints: {
      floor: { kind: 'planks', tones: ['#e2a75c', '#d89c52', '#eab36a', '#d29448'], line: '#8c5a2a' },
      floorAlt: { kind: 'planks', tones: ['#f3d9a4', '#edcd92', '#f7e1b2'], line: '#b08a52' },
      wall: { kind: 'plaster', tones: ['#fbf3e3', '#f3e8d2'], line: '#cdb999', patch: '#ea866c' },
      wallAlt: { kind: 'plaster', tones: ['#c5ebe2', '#b6e1d8'], line: '#74b0a6', patch: '#f6ebd4' },
      brick: { kind: 'brick', tones: ['#f6ead9', '#eddcc8', '#fbf2e4'], line: '#bfa184' },
      cap: { kind: 'boards', tones: ['#c98a4a', '#bd7e40'], line: '#7a4a22' },
      dark: { kind: 'boards', tones: ['#9a6540', '#8c5936', '#a67048'], line: '#522e18' },
      metal: metal(['#8fb6c4', '#84abba'], '#3a6074', '#d6eef2'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.12, glazeAlt: 0.1 }),
    trim: '#3fb9ae', trimSide: '#2a8f88',
    ao: 0.2,
    lamp: [1.0, 0.76, 0.44],
    ambient: 'dust',
    backdrop: 'loft',
    abyss: { base: '#f3d9a4', swirl: '#fff4d6', deep: '#d9a765' },
    window: [0.72, 0.9, 1.0],
    silhouette: '#b9834e', silhouetteFar: '#e6c693',
  },
  kiln: {
    name: 'kiln', campaign: 'water', time: 'amber dusk',
    hemi: [[0.54, 0.44, 0.62], [0.54, 0.32, 0.28]], key: [[0.66, 0.48, 0.26]],
    sun: [-0.62, 0.5, 0.42],
    fog: '#f0ab88', fogNear: 30, fogFar: 86, fogDensity: 0.0198,
    exposure: 1,
    sky: { top: '#5b4c9e', mid: '#ea788c', horizon: '#ffbc5e', glow: '#ffe7a0', sun: '#fff0b4', sunSize: 0.07, cloud: '#ffdcaa', cloudShade: '#c4648c', clouds: 0.6, stars: 0.15, moon: 0, bands: 1 },
    ink: '#3c1632',
    moteLight: 0, dark: 0.08, glowK: 0.28, poolK: 0.45,
    paints: {
      floor: { kind: 'brick', big: true, tones: ['#db6c4c', '#ce5f42', '#e57b58'], line: '#7d2e24' },
      floorAlt: { kind: 'brick', big: true, tones: ['#f4ca9e', '#edbc8a', '#f8d5ae'], line: '#ab7242' },
      wall: { kind: 'brick', tones: ['#8f4c5c', '#824252', '#9a5665'], line: '#4c2032' },
      wallAlt: { kind: 'brick', tones: ['#f4ca9e', '#edbc8a'], line: '#ab7242' },
      brick: { kind: 'brick', tones: ['#8f4c5c', '#824252', '#9a5665'], line: '#4c2032' },
      cap: { kind: 'cap', tones: ['#f4ca9e', '#ecbb88'], line: '#ab7242' },
      dark: { kind: 'brick', tones: ['#5c3252', '#512b48', '#663a5c'], line: '#2e1532' },
      metal: metal(['#8a7f9a', '#7f748f'], '#3c2f4a', '#e9d8f0'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.14, glazeAlt: 0.12 }),
    trim: '#3fbdb4', trimSide: '#2a918a',
    ao: 0.24,
    lamp: [1.0, 0.62, 0.3],
    ambient: 'embers',
    backdrop: 'kiln',
    abyss: { base: '#ff9a4a', swirl: '#ffd98a', deep: '#d6452c' },
    window: [1.0, 0.72, 0.36],
    silhouette: '#7a3c58', silhouetteFar: '#c9708a',
  },

  // ------------------------------------------------------------------------------------ FIRE
  pilot: {
    name: 'pilot', campaign: 'fire', time: 'blue hour',
    hemi: [[0.33, 0.37, 0.6], [0.26, 0.22, 0.32]], key: [[0.34, 0.36, 0.46]],
    sun: [-0.42, 0.72, 0.55],
    fog: '#4b4b88', fogNear: 30, fogFar: 88, fogDensity: 0.0193,
    exposure: 1,
    sky: { top: '#1b2156', mid: '#3d4190', horizon: '#ea8a6c', glow: '#ffb27a', sun: '#000000', sunSize: 0, cloud: '#55549a', cloudShade: '#2c2e66', clouds: 0.5, stars: 0.8, moon: 0.035, moonCol: '#f5f0dc', bands: 1 },
    ink: '#10112a',
    moteLight: 0.5, dark: 0.6, glowK: 0.9, poolK: 0.9,
    paints: {
      floor: { kind: 'slab', tones: ['#5c627c', '#545a74', '#666c88'], line: '#272b40' },
      floorAlt: { kind: 'slab', tones: ['#bcc0d4', '#b0b4ca', '#c6cadc'], line: '#5c607c' },
      wall: { kind: 'brick', tones: ['#4c5172', '#454a6a', '#545a7c'], line: '#23263c' },
      wallAlt: { kind: 'brick', tones: ['#8a8eac', '#8085a4'], line: '#444866' },
      brick: { kind: 'brick', tones: ['#4c5172', '#454a6a', '#545a7c'], line: '#23263c' },
      cap: { kind: 'cap', tones: ['#7a7f9c', '#70759a'], line: '#33364e' },
      dark: { kind: 'brick', tones: ['#3a3e5c', '#343854', '#414564'], line: '#101224' },
      metal: metal(['#6f7896', '#666f8c'], '#252a40', '#c9d2ee'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.2, glazeAlt: 0.2 }),
    trim: '#ffc85c', trimSide: '#c98a2e',
    ao: 0.26,
    lamp: [1.0, 0.7, 0.36],
    ambient: 'drips',
    backdrop: 'works',
    abyss: { base: '#2c2e66', swirl: '#4b4b88', deep: '#161a44' },
    window: [1.0, 0.78, 0.36],
    silhouette: '#252858', silhouetteFar: '#444684',
  },
  flue: {
    name: 'flue', campaign: 'fire', time: 'night in the stack',
    hemi: [[0.36, 0.28, 0.33], [0.5, 0.24, 0.14]], key: [[0.42, 0.31, 0.24]],
    sun: [0.3, 0.88, 0.36],
    fog: '#3c1a1e', fogNear: 26, fogFar: 82, fogDensity: 0.0207,
    exposure: 1,
    sky: { top: '#160a16', mid: '#3c1522', horizon: '#bc431e', glow: '#ff8a3c', sun: '#000000', sunSize: 0, cloud: '#57303a', cloudShade: '#26111a', clouds: 0.7, stars: 0.2, moon: 0, bands: 1 },
    ink: '#14070c',
    moteLight: 0.55, dark: 0.85, glowK: 1, poolK: 1,
    paints: {
      floor: { kind: 'slab', tones: ['#5e4c4e', '#554446', '#685452'], line: '#24171b' },
      floorAlt: { kind: 'slab', tones: ['#c2b0a0', '#b6a494', '#ccbaaa'], line: '#665648' },
      wall: { kind: 'brick', tones: ['#52363a', '#493034', '#5c3e42'], line: '#201216', glow: '#ff7a2e' },
      wallAlt: { kind: 'brick', tones: ['#8a6e68', '#80645e'], line: '#3e2a28' },
      brick: { kind: 'brick', tones: ['#52363a', '#493034', '#5c3e42'], line: '#201216', glow: '#ff7a2e' },
      cap: { kind: 'cap', tones: ['#7a6260', '#705856'], line: '#2e1e20' },
      dark: { kind: 'brick', tones: ['#4a2d33', '#432930', '#52333a'], line: '#0c0406' },
      metal: metal(['#6c6470', '#625a66'], '#241c28', '#d2c4d4'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.1, glazeAlt: 0.1 }),
    trim: '#ff9a48', trimSide: '#b85a1e',
    ao: 0.28,
    lamp: [1.0, 0.6, 0.28],
    ambient: 'embers',
    backdrop: 'kiln',
    abyss: { base: '#e2521e', swirl: '#ffb04a', deep: '#6a1410' },
    window: [1.0, 0.56, 0.2],
    silhouette: '#2a1218', silhouetteFar: '#5a2420',
  },
  wire: {
    name: 'wire', campaign: 'fire', time: 'deep night, gold moon',
    hemi: [[0.29, 0.37, 0.48], [0.23, 0.25, 0.3]], key: [[0.42, 0.42, 0.38]],
    sun: [0.5, 0.68, -0.52],
    fog: '#25395c', fogNear: 30, fogFar: 88, fogDensity: 0.0193,
    exposure: 1,
    sky: { top: '#0b1130', mid: '#1c2a5a', horizon: '#3c5c84', glow: '#ffd98a', sun: '#000000', sunSize: 0, cloud: '#2c4270', cloudShade: '#141e44', clouds: 0.45, stars: 1, moon: 0.085, moonCol: '#ffd676', bands: 1 },
    ink: '#080b18',
    moteLight: 0.5, dark: 0.7, glowK: 0.95, poolK: 0.9,
    paints: {
      floor: { kind: 'tile', tones: ['#414857', '#3a414f', '#495061'], line: '#171a22', inset: '#f2ba4c', shine: 0.2 },
      floorAlt: { kind: 'tile', tones: ['#dacba2', '#cfbf94', '#e2d4ae'], line: '#7c6c44', inset: '#414857', shine: 0.25 },
      wall: { kind: 'panel', tones: ['#3b4250', '#353c49', '#434a5a'], line: '#15181f', stud: '#f2ba4c' },
      wallAlt: { kind: 'panel', tones: ['#8a8f9c', '#80858f'], line: '#3c404a', stud: '#f2ba4c' },
      brick: { kind: 'brick', tones: ['#3b4250', '#353c49', '#434a5a'], line: '#15181f' },
      cap: { kind: 'cap', tones: ['#6a7080', '#606676'], line: '#262a34' },
      dark: { kind: 'brick', tones: ['#2f3542', '#2a303c', '#363c4a'], line: '#07090e' },
      metal: metal(['#c9a24a', '#bd9640'], '#5c4414', '#fff0b8'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.45, glazeAlt: 0.35 }),
    trim: '#f2ba4c', trimSide: '#a8782a',
    ao: 0.26,
    lamp: [1.0, 0.82, 0.44],
    ambient: 'dust',
    backdrop: 'works',
    abyss: { base: '#1c2a5a', swirl: '#3c5c84', deep: '#0b1130' },
    window: [0.6, 1.0, 0.9],
    silhouette: '#141c40', silhouetteFar: '#2a3c66',
  },

  // ------------------------------------------------------------------------------------ CLAY (placeholders)
  wedge: {
    name: 'wedge', campaign: 'clay', time: 'fresh morning',
    hemi: [[0.56, 0.57, 0.6], [0.48, 0.4, 0.33]], key: [[0.56, 0.52, 0.44]],
    sun: [-0.4, 0.78, 0.48],
    fog: '#ecebd4', fogNear: 34, fogFar: 90, fogDensity: 0.0189,
    exposure: 1,
    sky: { top: '#69b6c6', mid: '#b6dcc8', horizon: '#f6ecd0', glow: '#fff8d8', sun: '#fffbe4', sunSize: 0.05, cloud: '#fffdf4', cloudShade: '#cfe0cc', clouds: 0.6, stars: 0, moon: 0, bands: 1 },
    ink: '#3c2b22',
    moteLight: 0, dark: 0, glowK: 0.16, poolK: 0.3,
    paints: {
      floor: { kind: 'tile', tones: ['#db845c', '#d17852', '#e29068'], line: '#7c3e28', inset: '#f3ead8', shine: 0.12 },
      floorAlt: { kind: 'slab', tones: ['#f3ead8', '#eadfca', '#f8f1e2'], line: '#b3a084' },
      wall: { kind: 'plaster', tones: ['#f6eede', '#eee3cf'], line: '#c0ad90', patch: '#db845c' },
      wallAlt: { kind: 'plaster', tones: ['#cfe0c4', '#c2d6b8'], line: '#86a082', patch: '#f3ead8' },
      brick: { kind: 'brick', tones: ['#d8805a', '#cc7450', '#e08c66'], line: '#7c3e28' },
      cap: { kind: 'cap', tones: ['#f3ead8', '#e9dcc6'], line: '#b3a084' },
      dark: { kind: 'boards', tones: ['#829c82', '#769076', '#8ea88e'], line: '#3f5a44' },
      metal: metal(['#a8b4a4', '#9ca898'], '#4a5a4a', '#e8f2e2'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.1, glazeAlt: 0.05 }),
    trim: '#a4c8a0', trimSide: '#6f9a70',
    ao: 0.2,
    lamp: [1.0, 0.76, 0.44],
    ambient: 'dust',
    backdrop: 'works',
    abyss: { base: '#e6c9a0', swirl: '#f6ecd0', deep: '#c98a5c' },
    window: [1.0, 0.86, 0.55],
    silhouette: '#c99a7a', silhouetteFar: '#e6d2b6',
  },
  bisque: {
    name: 'bisque', campaign: 'clay', time: 'high noon',
    hemi: [[0.6, 0.59, 0.58], [0.52, 0.44, 0.38]], key: [[0.56, 0.54, 0.5]],
    sun: [0.22, 0.94, 0.26],
    fog: '#f4eedc', fogNear: 36, fogFar: 92, fogDensity: 0.0185,
    exposure: 1,
    sky: { top: '#3f9be0', mid: '#9fd2f2', horizon: '#f8f1de', glow: '#ffffff', sun: '#ffffff', sunSize: 0.045, cloud: '#ffffff', cloudShade: '#d4e4f0', clouds: 0.4, stars: 0, moon: 0, bands: 1 },
    ink: '#42322c',
    moteLight: 0, dark: 0, glowK: 0.16, poolK: 0.25,
    paints: {
      floor: { kind: 'tile', tones: ['#f4ead8', '#ece1cc', '#f9f2e4'], line: '#b29c7e', inset: '#e07a50', shine: 0.1 },
      floorAlt: { kind: 'tile', tones: ['#eaa27a', '#e2966e', '#f0ae88'], line: '#9c5a38', inset: '#f4ead8', shine: 0.1 },
      wall: { kind: 'brick', tones: ['#de8058', '#d2744e', '#e68c64'], line: '#7e3e28' },
      wallAlt: { kind: 'plaster', tones: ['#f6eede', '#eee3cf'], line: '#c0ad90', patch: '#de8058' },
      brick: { kind: 'brick', tones: ['#de8058', '#d2744e', '#e68c64'], line: '#7e3e28' },
      cap: { kind: 'cap', tones: ['#f4ead8', '#eadfca'], line: '#b29c7e' },
      dark: { kind: 'brick', tones: ['#9a5a40', '#8e5038', '#a66448'], line: '#4e281a' },
      metal: metal(['#a8b4a4', '#9ca898'], '#4a5a4a', '#e8f2e2'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.08, glazeAlt: 0.08 }),
    trim: '#e07a50', trimSide: '#a8502e',
    ao: 0.2,
    lamp: [1.0, 0.78, 0.46],
    ambient: 'dust',
    backdrop: 'loft',
    abyss: { base: '#f0d6b0', swirl: '#fbf3e0', deep: '#d9a070' },
    window: [0.72, 0.9, 1.0],
    silhouette: '#c98a6a', silhouetteFar: '#ecd6bc',
  },
  glost: {
    name: 'glost', campaign: 'clay', time: 'sunset',
    hemi: [[0.52, 0.48, 0.58], [0.48, 0.36, 0.32]], key: [[0.64, 0.5, 0.34]],
    sun: [-0.58, 0.52, 0.5],
    fog: '#f0c2a0', fogNear: 30, fogFar: 86, fogDensity: 0.0198,
    exposure: 1,
    sky: { top: '#4c6c9c', mid: '#ea9c8c', horizon: '#ffd48c', glow: '#fff0b0', sun: '#fff4c0', sunSize: 0.065, cloud: '#ffe2b8', cloudShade: '#c8748a', clouds: 0.55, stars: 0.1, moon: 0, bands: 1 },
    ink: '#2e2a32',
    moteLight: 0, dark: 0.05, glowK: 0.26, poolK: 0.4,
    paints: {
      floor: { kind: 'tile', tones: ['#90c2a2', '#85b798', '#9cccac'], line: '#3f6c52', inset: '#fff3dc', shine: 0.34 },
      floorAlt: { kind: 'tile', tones: ['#fbf0da', '#f3e5c8', '#fff6e4'], line: '#b8a07c', inset: '#90c2a2', shine: 0.3 },
      wall: { kind: 'subway', tones: ['#fbf0da', '#f3e5c8'], line: '#b8a07c', accent: '#90c2a2', accentP: 0.1 },
      wallAlt: { kind: 'subway', tones: ['#c6e2d0', '#b8d8c4'], line: '#6e9c84', accent: '#e07a50', accentP: 0.08 },
      brick: { kind: 'brick', tones: ['#d8805a', '#cc7450', '#e08c66'], line: '#7c3e28' },
      cap: { kind: 'cap', tones: ['#fbf0da', '#f1e2c4'], line: '#b8a07c' },
      dark: { kind: 'brick', tones: ['#6a5a6a', '#5e5060', '#766474'], line: '#2e2632' },
      metal: metal(['#a8b4a4', '#9ca898'], '#4a5a4a', '#e8f2e2'),
      clay,
    },
    surfaces: surfaces({ glaze: 0.6, glazeAlt: 0.45 }),
    trim: '#fff3dc', trimSide: '#d9c4a0',
    ao: 0.22,
    lamp: [1.0, 0.7, 0.36],
    ambient: 'embers',
    backdrop: 'kiln',
    abyss: { base: '#ffa85c', swirl: '#ffe0a0', deep: '#c8603c' },
    window: [1.0, 0.76, 0.4],
    silhouette: '#8a5a6a', silhouetteFar: '#d09a94',
  },
};

/** The three themes of each campaign, in chapter order (level select swatches, tests). */
export const CAMPAIGN_THEMES = { water: ['slip', 'loft', 'kiln'], fire: ['pilot', 'flue', 'wire'], clay: ['wedge', 'bisque', 'glost'] };

/** The theme name a level asks for, or the default when missing/unknown. */
export function themeName(level) {
  const t = level && typeof level === 'object' ? (level.theme !== undefined ? level.theme : level.source && level.source.theme) : level;
  return typeof t === 'string' && Object.prototype.hasOwnProperty.call(THEMES, t) ? t : DEFAULT_THEME;
}

/** Theme object for a level (runtime level, raw level data, or a name). Never throws. */
export function resolveTheme(levelOrName) {
  return THEMES[themeName(levelOrName)];
}

/** Surface description for a block material in a theme (unknown mats behave like 'tile'). */
export function surfaceFor(theme, mat) {
  const s = theme.surfaces;
  return Object.prototype.hasOwnProperty.call(s, mat) ? s[mat] : s.tile;
}

/** The paint a surface name stands for in a theme (unknown names give the floor paint). */
export function paintFor(theme, name) {
  const p = theme.paints;
  return Object.prototype.hasOwnProperty.call(p, name) ? p[name] : p.floor;
}
