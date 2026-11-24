// Level registry. Each element has its own campaign: an ordered list of levels in chapters.
//   water  l01..l12  The Wet Road   (published ids - never rename, never reorder)
//   fire   f01..f12  The Lit Road
//   clay   c01..c12  The Thrown Road
// To add a level: write src/levels/<id>.js (format: LEVELS.md), import it here and append it to
// its campaign's `levels` in play order, then add tests/solutions/<id>.js.
// A campaign with no levels yet is shown on the title screen as "coming soon" and cannot be chosen.

import l01 from './l01.js';
import l02 from './l02.js';
import l03 from './l03.js';
import l04 from './l04.js';
import l05 from './l05.js';
import l06 from './l06.js';
import l07 from './l07.js';
import l08 from './l08.js';
import l09 from './l09.js';
import l10 from './l10.js';
import l11 from './l11.js';
import l12 from './l12.js';
import f01 from './f01.js';
import f02 from './f02.js';
import f03 from './f03.js';
import f04 from './f04.js';
import f05 from './f05.js';
import f06 from './f06.js';
import f07 from './f07.js';
import f08 from './f08.js';
import f09 from './f09.js';
import f10 from './f10.js';
import f11 from './f11.js';
import f12 from './f12.js';

/** The Water campaign (kept under its original name: every water tool and test reads `levels`). */
export const levels = [l01, l02, l03, l04, l05, l06, l07, l08, l09, l10, l11, l12];

/** Chapter titles of the Water campaign, shown on the level-select screen (level.chapter is 1-based). */
export const chapters = [
  { id: 1, name: 'The Slip Room' },
  { id: 2, name: 'The Drying Loft' },
  { id: 3, name: 'The Great Kiln' },
];

/** Title-screen order of the elements. */
export const ELEMENT_ORDER = ['water', 'fire', 'clay'];

/** Planned length of every campaign (for "3 / 12" progress on the element cards). */
export const CAMPAIGN_LENGTH = 12;

/** Every campaign: its element, id prefix, levels in play order, and chapters. */
export const campaigns = {
  water: { element: 'water', prefix: 'l', name: 'The Wet Road', levels, chapters },
  fire: {
    element: 'fire', prefix: 'f', name: 'The Lit Road',
    levels: [f01, f02, f03, f04, f05, f06, f07, f08, f09, f10, f11, f12],
    chapters: [
      { id: 1, name: 'Pilot Light' },
      { id: 2, name: 'Flue' },
      { id: 3, name: 'Live Wire' },
    ],
  },
  clay: {
    element: 'clay', prefix: 'c', name: 'The Thrown Road',
    levels: [],
    chapters: [
      { id: 1, name: 'Wedging' },
      { id: 2, name: 'Bisque' },
      { id: 3, name: 'Glost' },
    ],
  },
};

/** Every registered level of every element. */
export const allLevels = ELEMENT_ORDER.flatMap((e) => campaigns[e].levels);

/** The campaign an element id names (null when unknown). */
export function getCampaign(element) {
  return typeof element === 'string' && Object.prototype.hasOwnProperty.call(campaigns, element) ? campaigns[element] : null;
}

/** The element a level belongs to (`level.element`, default 'water'). */
export function elementOfLevel(level) { return (level && level.element) || 'water'; }

/** The campaign that contains the level with this id (null when the id is not registered). */
export function campaignOf(id) {
  for (const e of ELEMENT_ORDER) if (campaigns[e].levels.some((l) => l.id === id)) return campaigns[e];
  return null;
}

export function getLevel(id) {
  return allLevels.find((l) => l.id === id) || null;
}

/** Position of the level inside its own campaign (-1 when not registered). */
export function levelIndex(id) {
  const c = campaignOf(id);
  return c ? c.levels.findIndex((l) => l.id === id) : -1;
}

/** Id of the level after `id` in the same campaign, or null after the last one. */
export function nextLevelId(id) {
  const c = campaignOf(id);
  if (!c) return null;
  const i = c.levels.findIndex((l) => l.id === id);
  return i + 1 < c.levels.length ? c.levels[i + 1].id : null;
}
