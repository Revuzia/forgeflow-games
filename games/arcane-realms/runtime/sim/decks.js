// Arcane Realms TCG — deck rules + the six prebuilt starter decks.
import { CARDS, cardById } from './cards.js?v=7';

export const DECK_SIZE = 30;
export const MAX_COPIES = 2;
export const MAX_LEGENDARY_COPIES = 1;
export const MAX_REALMS = 2; // + neutral always allowed

export function validateDeck(cardIds) {
  const errors = [];
  if (!Array.isArray(cardIds)) return { ok: false, errors: ['not a list'] };
  if (cardIds.length !== DECK_SIZE) errors.push(`deck must have ${DECK_SIZE} cards (has ${cardIds.length})`);
  const counts = {};
  const realms = new Set();
  for (const id of cardIds) {
    const c = CARDS[id];
    if (!c || c.rarity === 'token') { errors.push(`invalid card: ${id}`); continue; }
    counts[id] = (counts[id] || 0) + 1;
    if (c.realm !== 'neutral') realms.add(c.realm);
  }
  for (const [id, n] of Object.entries(counts)) {
    const c = CARDS[id];
    const cap = c.rarity === 'legendary' ? MAX_LEGENDARY_COPIES : MAX_COPIES;
    if (n > cap) errors.push(`too many copies of ${c.name} (${n}/${cap})`);
  }
  if (realms.size > MAX_REALMS) errors.push(`too many realms (${[...realms].join(', ')}) — max ${MAX_REALMS} plus Neutral`);
  return { ok: errors.length === 0, errors, realms: [...realms] };
}

function expand(pairs) {
  const out = [];
  for (const [id, n] of pairs) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

export const STARTER_DECKS = [
  {
    id: 'starter_ember',
    name: 'Dragonfire Assault',
    realms: ['ember', 'neutral'],
    hero: 'ember',
    desc: 'Relentless aggression — cheap dragons, burn spells, and face damage.',
    cards: expand([
      ['ef01', 2], ['ef02', 2], ['ef03', 2], ['ef05', 2], ['ef06', 2],
      ['ef08', 2], ['ef09', 2], ['ef10', 2], ['ef11', 2], ['ef12', 1],
      ['ef16', 2], ['ef18', 1], ['ef19', 1], ['ef20', 1],
      ['nt01', 2], ['nt02', 2], ['nt17', 2],
    ]),
  },
  {
    id: 'starter_tide',
    name: 'Tides of Control',
    realms: ['tide', 'dawn'],
    hero: 'tide',
    desc: 'Freeze, counter, draw — then drown them in inevitability.',
    cards: expand([
      ['tc02', 2], ['tc05', 1], ['tc07', 2], ['tc08', 2], ['tc09', 2],
      ['tc10', 2], ['tc11', 2], ['tc13', 2], ['tc14', 2], ['tc16', 1],
      ['tc18', 1], ['tc19', 1],
      ['dw03', 2], ['dw06', 2], ['dw12', 2], ['dw13', 1],
      ['nt16', 2], ['nt13', 1],
    ]),
  },
  {
    id: 'starter_grove',
    name: 'Wild Stampede',
    realms: ['grove', 'neutral'],
    hero: 'grove',
    desc: 'Ramp into giants, buff the pack, and trample everything.',
    cards: expand([
      ['wg01', 2], ['wg02', 2], ['wg03', 2], ['wg04', 2], ['wg05', 2],
      ['wg07', 2], ['wg08', 2], ['wg09', 2], ['wg10', 2], ['wg11', 2],
      ['wg13', 2], ['wg15', 1], ['wg16', 1], ['wg17', 1], ['wg18', 1],
      ['wg19', 2], ['nt11', 2],
    ]),
  },
  {
    id: 'starter_dawn',
    name: "Light's Bulwark",
    realms: ['dawn', 'grove'],
    hero: 'dawn',
    desc: 'Heal, guard, and swarm — the dawn outlasts the dark.',
    cards: expand([
      ['dw01', 2], ['dw02', 2], ['dw03', 2], ['dw04', 2], ['dw05', 2],
      ['dw06', 2], ['dw07', 2], ['dw08', 2], ['dw09', 2], ['dw10', 2],
      ['dw11', 2], ['dw14', 2], ['dw15', 1], ['dw16', 1], ['dw13', 1],
      ['wg06', 2], ['wg16', 1],
    ]),
  },
  {
    id: 'starter_grave',
    name: 'Deathweave Pact',
    realms: ['grave', 'tide'],
    hero: 'grave',
    desc: 'Trade in corpses and cards — death is a resource.',
    cards: expand([
      ['gm01', 2], ['gm03', 2], ['gm04', 2], ['gm05', 2], ['gm06', 2],
      ['gm07', 2], ['gm08', 2], ['gm09', 2], ['gm11', 2], ['gm12', 2],
      ['gm14', 1], ['gm15', 1], ['gm17', 2], ['gm18', 1], ['gm19', 1],
      ['tc04', 2], ['tc09', 2],
    ]),
  },
  {
    id: 'starter_shadowflame',
    name: 'Shadowflame Legion',
    realms: ['grave', 'ember'],
    hero: 'ember',
    desc: 'Venom, sacrifice, and fire — tempo with teeth.',
    cards: expand([
      ['gm02', 2], ['gm04', 2], ['gm07', 2], ['gm10', 2], ['gm12', 2],
      ['gm16', 2], ['ef02', 2], ['ef03', 2], ['ef05', 2], ['ef07', 2],
      ['ef08', 2], ['ef13', 2], ['ef14', 1], ['gm14', 1], ['ef15', 1],
      ['nt12', 1], ['nt20', 1], ['nt06', 1],
    ]),
  },
];

// every starter deck must validate — asserted by selftest
export function starterDeckErrors() {
  const out = [];
  for (const d of STARTER_DECKS) {
    const v = validateDeck(d.cards);
    if (!v.ok) out.push({ deck: d.id, errors: v.errors });
  }
  return out;
}
