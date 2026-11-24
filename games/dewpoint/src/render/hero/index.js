// The hero of each element. To add one: write src/render/hero/<name>.js (a HeroView subclass, see
// base.js for the hooks) and list it here under its element id.

import { MoteView } from './mote.js';
import { CinderView } from './cinder.js';

const HEROES = { water: MoteView, fire: CinderView };

/** True when an element has a hero view of its own. */
export function hasHero(element) { return Object.prototype.hasOwnProperty.call(HEROES, element); }

/** Build the hero view for an element (an element without one yet is shown as Mote rather than not at all). */
export function createHero(element, particles, prints, flames) {
  const View = hasHero(element) ? HEROES[element] : MoteView;
  return new View(particles, prints, flames);
}
