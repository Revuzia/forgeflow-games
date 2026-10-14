// GENESIS — the save migration of the living-world program (LIVING.md §6.3 rule 4): a 1.4 save read by a 1.5 build.
//
// One shared list for the program's lanes. core/serialize.ts migrate() runs every step, in order, on the parsed header of
// a save older than 1.5 (the blobs are loaded afterwards: a typed array the save lacks keeps its fresh default — see
// world/planet.ts planetFromJson). Each lane APPENDS its step here and every loader also reads its new state with a
// default (`j.prophets ?? []`), so a step only has to fill what a default cannot.

import { dropCreatures } from '../god/creature.ts';

export type HeaderStep = (header: Record<string, unknown>) => void;

/**
 * PACE (the 1.5 bump): nothing in the header changes. The agent columns it added — `trip` (provisioned until, 0),
 * `camp` (the camp cell, -1), `tripTask` (0) and `dayWork` (0) — are typed arrays absent from a 1.4 save, so they keep
 * the fresh defaults of a body at home (people/agents.ts). A time-lapse level saved by a legacy `time.scale { scale }`
 * keeps its meaning (perf/lapse.ts levelOfScale), and the 1x preset is the worker's, not the save's.
 */
const pace: HeaderStep = () => {};

/**
 * RELATIONSHIP (LIVING §3.5, §3.1): the creature is gone — its state, a creature held by the hand and creatures in flight
 * are dropped (god/creature.ts dropCreatures). The two agent columns it added, `faith` and `loyalty`, are absent from a
 * 1.4 save: they are filled from the old love and fear once the arrays are in (god/regard.ts relAfterLoad, called by
 * sim.ts universeFromHeader: faith = min(1, love + fear), loyalty = 0.5 × love). The relationship state (`god.rel`)
 * starts empty (GodState.fromJson).
 */
const relationship: HeaderStep = (h) => { dropCreatures(h); };

/**
 * LAND (LIVING §2): nothing in the header changes. The agent column it added, `lastBirth` (0: no birth recorded — the
 * first birth after the load is not held back by spacing), keeps its default. Each settlement's living off the land
 * (`Settlement.land`: the ledger, hunting party, crop fields, gatherings) and the world's fish stocks (`PeopleState.land`)
 * are made the first time they are touched (people/ledger.ts landOf / landWorld): a field a 1.4 town sowed is taken up
 * by the seasonal clock with the growth its crop cover shows (people/crops.ts adoptField).
 */
const land: HeaderStep = () => {};

/**
 * CONTENT (LIVING §4.4): nothing in the header changes here. Four kinds that were not real were replaced IN PLACE by
 * real ones (ice-beast → musk-ox, sand-crawler → caracal, haze-ray → golden-eagle, drift-ray → duck; the old ids stay as
 * aliases the registry answers to) and the leviathan disaster became the rogue wave. New animals, plants, items and two
 * recipes are appended to the base content, so the indices AFTER the base moved: the species born on a world (index ≥
 * 27 in 1.4), the god's and the mods' items, recipes and plants, and the weather kinds after RELATIONSHIP's rainbow.
 * That remap needs the loaded content, so it runs once the universe is built (sim.ts universeFromHeader →
 * life/fauna.ts contentAfterLoad), by id: from the save's own `contentIds` (written by every save from now on), or for a
 * save without them (1.4, and the 1.5 builds before this step) from the frozen 1.4 lists (fauna.ts IDS_14). Herds of a
 * replaced kind on a world outside the real kind's temperature range are dropped there without a chronicle line; sacred
 * animals kept by an old id take the real kind's.
 */
const content: HeaderStep = () => {};

/**
 * HISTORY (LIVING §5): nothing in the header changes. Each settlement's history (`Settlement.hist`: its grievance against
 * its capital, its kin, its era clock and label — people/politics.ts histOf) is made the first time it is touched; a 1.4
 * town starts its era clock at the load (what it knew then counts as long practised), and the old flat chances of
 * independence for distance and tongue now weigh in its grievance. A world being terraformed (`PlanetState.terraform`,
 * god/history.ts) is new state a 1.4 save never has.
 */
const history: HeaderStep = () => {};

/** the 1.4 → 1.5 steps, in order (append yours) */
export const LIVING_MIGRATIONS: HeaderStep[] = [pace, relationship, land, content, history];
