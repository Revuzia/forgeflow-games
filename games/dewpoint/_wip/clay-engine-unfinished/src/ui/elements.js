// What the interface needs to know about each element: names, wording, colours, the four form
// buttons in order, and which gauge to draw. Pure data (no DOM), so Node tests and prompts.js can
// read it. All three elements are listed here, including ones whose campaign has no levels yet:
// the title screen shows those as "coming soon" (src/levels/index.js decides, by level count).
//
// forms[i] is button i+1 (keyboard 1-4, the touch grid, gamepad X / Y / B / RB):
//   id      the sim's form name            label   shown to screen readers and on the card
//   button  the word hints use on touch ("tap the <button> button")
//   color   the button's accent            special name of the form's special, if it has one (a hint token)
// gauge: `meter: true` draws a separate bar (a gauge that does not refill by itself deserves to be
// seen all the time); otherwise only the buttons of the forms that spend it show it.

export const ELEMENT_UI = {
  water: {
    id: 'water', name: 'Water', hero: 'Mote', campaign: 'The Wet Road',
    pitch: 'A drop that freezes, boils and flattens.',
    tagline: 'One drop of water. One sleeping kiln works.',
    accent: '#5fe6ff', accentDeep: '#1c9bd6', ink: '#04202c',
    forms: [
      { id: 'liquid', label: 'Drop', button: 'drop', color: '#5fe6ff' },
      { id: 'ice', label: 'Ice', button: 'ice', color: '#cfefff' },
      { id: 'steam', label: 'Steam', button: 'steam', color: '#e8f4ff' },
      { id: 'film', label: 'Film', button: 'film', color: '#7df5d6' },
    ],
    gauge: { name: 'Steam', meter: false },
    collectible: { one: 'glaze shard', many: 'glaze shards', label: 'Glaze shards' },
    deaths: 'Splashes',
    win: 'Kiln lit',
  },
  fire: {
    id: 'fire', name: 'Fire', hero: 'Cinder', campaign: 'The Lit Road',
    pitch: 'A live coal that flares, smokes and sparks.',
    tagline: 'One live coal. A cold works to light, and water everywhere.',
    accent: '#ffab4a', accentDeep: '#e2531a', ink: '#2a0f02',
    forms: [
      { id: 'ember', label: 'Ember', button: 'ember', color: '#ffab4a' },
      { id: 'blaze', label: 'Blaze', button: 'blaze', color: '#ffd76a', special: 'flare' },
      { id: 'smoke', label: 'Smoke', button: 'smoke', color: '#c9c3d6' },
      { id: 'spark', label: 'Spark', button: 'spark', color: '#fff3a8' },
    ],
    gauge: { name: 'Heat', meter: true },
    collectible: { one: 'glow-stone', many: 'glow-stones', label: 'Glow-stones' },
    deaths: 'Put out',
    win: 'Kiln ablaze',
  },
  clay: {
    id: 'clay', name: 'Clay', hero: 'Dab', campaign: 'The Thrown Road',
    pitch: 'A thumb of clay: soft, runny, fired or dust.',
    tagline: 'One thumb of clay. Too wet it runs, too dry it crumbles.',
    accent: '#e8a57c', accentDeep: '#b5613a', ink: '#2a140a',
    forms: [
      { id: 'clay', label: 'Clay', button: 'clay', color: '#e8a57c' },
      { id: 'slip', label: 'Slip', button: 'slip', color: '#d9c2a6' },
      { id: 'stone', label: 'Stone', button: 'stone', color: '#b9aba0', special: 'shed' },
      { id: 'dust', label: 'Dust', button: 'dust', color: '#efe2cf' },
    ],
    // dust refills by itself on the ground (it rides the dust button, like steam); grip is a second
    // gauge the pack reports while Dab holds on to a rough wall or ceiling (hud.js "meters")
    gauge: { name: 'Dust', meter: false },
    meters: { grip: 'Grip' },
    collectible: { one: "maker's mark", many: "maker's marks", label: "Maker's marks" },
    deaths: 'Crumbles',
    win: 'Kiln loaded',
  },
};

export const UI_ELEMENT_ORDER = ['water', 'fire', 'clay'];
export const DEFAULT_UI_ELEMENT = 'water';

/** UI description of an element; anything unknown gets water (never throws: the id may come from a save file). */
export function elementUi(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ELEMENT_UI, id) ? ELEMENT_UI[id] : ELEMENT_UI[DEFAULT_UI_ELEMENT];
}

/** True for 'water' | 'fire' | 'clay'. */
export function isElementId(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(ELEMENT_UI, id);
}
