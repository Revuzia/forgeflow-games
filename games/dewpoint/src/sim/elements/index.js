// Element registry. An element is DATA (DESIGN-ELEMENTS.md "Principles"): four forms, each a set
// of movement parameters plus capability flags, a gauge, and how the shared pieces act on it.
// The engine (sim.js, level.js, collide.js) reads flags; it never asks for a form or an element
// by name. To add an element follow ELEMENTS.md, then import it here and add it to `list`.

import water from './water.js';
import fire from './fire.js';

const list = [water, fire];

export const DEFAULT_ELEMENT = 'water';
export const ELEMENTS = Object.create(null);
export const ELEMENT_IDS = [];
const FORM_OWNER = Object.create(null);
/** Every form of every element, by name (form names are unique across elements). */
export const ALL_FORMS = Object.create(null);

const MOVES = ['walk', 'slide', 'float'];

for (const E of list) {
  const bad = (msg) => { throw new Error(`element ${E && E.id}: ${msg}`); };
  if (!E || typeof E.id !== 'string' || !/^[a-z]+$/.test(E.id)) throw new Error('element: needs a lower-case id');
  if (ELEMENTS[E.id]) bad('registered twice');
  if (!Array.isArray(E.forms) || E.forms.length !== 4) bad('needs exactly four forms (one per form button)');
  if (!E.forms.includes(E.defaultForm)) bad('defaultForm must be one of its forms');
  if (!E.gauge || !(E.gauge.max > 0) || !(E.gauge.start >= 0 && E.gauge.start <= E.gauge.max) || !(E.gauge.refill >= 0)) bad('gauge needs max > 0, 0 <= start <= max, refill >= 0');
  for (const f of E.forms) {
    const F = E.formDefs && E.formDefs[f];
    if (!F) bad(`form "${f}" has no entry in formDefs`);
    if (FORM_OWNER[f]) bad(`form name "${f}" is already used by ${FORM_OWNER[f]}`);
    if (!(F.r > 0) || !(F.h > 0)) bad(`form "${f}" needs r and h`);
    if (!MOVES.includes(F.move)) bad(`form "${f}": move must be one of ${MOVES.join(', ')}`);
    if (!(F.speed > 0)) bad(`form "${f}" needs speed`);
    if (F.special && !(E.specials && typeof E.specials[F.special] === 'function')) bad(`form "${f}": special "${F.special}" is not in specials`);
    FORM_OWNER[f] = E.id;
    ALL_FORMS[f] = F;
  }
  if ((E.formDefs[E.defaultForm].drain || 0) > 0) bad('the default form must not drain the gauge (it is where an empty gauge leaves the hero)');
  for (const z of Object.keys(E.zones || {})) {
    const r = E.zones[z];
    for (const f of [r.force, ...Object.keys(r.demote || {}), ...Object.values(r.demote || {}), ...Object.keys(r.refuse || {})]) {
      if (f !== undefined && !E.forms.includes(f)) bad(`zones.${z} names "${f}", which is not one of its forms`);
    }
  }
  if (!Array.isArray(E.pieces) || !Array.isArray(E.packs)) bad('needs pieces[] and packs[]');
  for (const k of E.packs) {
    for (const t of k.types) if (!E.pieces.includes(t)) bad(`pack "${k.name}" provides "${t}" but pieces[] does not list it`);
  }
  ELEMENTS[E.id] = E;
  ELEMENT_IDS.push(E.id);
}

/** Element definition by id; undefined/null means the default (water). Unknown ids return null. */
export function getElement(id) {
  if (id === undefined || id === null) return ELEMENTS[DEFAULT_ELEMENT];
  return typeof id === 'string' && ELEMENTS[id] ? ELEMENTS[id] : null;
}

/** Movement parameters + flags of a form, whichever element owns it (null when unknown). */
export function formDef(name) { return typeof name === 'string' && ALL_FORMS[name] ? ALL_FORMS[name] : null; }

/** Id of the element a form belongs to (null when unknown). */
export function elementOfForm(name) { return typeof name === 'string' && FORM_OWNER[name] ? FORM_OWNER[name] : null; }

/** Every piece type any element knows (shared ones plus all packs'), for loader error messages. */
export function allPieceTypes() {
  const out = new Set();
  for (const id of ELEMENT_IDS) for (const t of ELEMENTS[id].pieces) out.add(t);
  return [...out];
}
