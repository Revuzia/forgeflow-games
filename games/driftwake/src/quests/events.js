/**
 * The meaning layer's event bus (_spec/QUEST_DESIGN.md).
 *
 * One tiny pub/sub so the quest engine, world content, rewards and UI never
 * import each other directly: a cache opening does not know the journal
 * exists, the journal does not know how a cache is drawn. Events are RARE
 * (a shrine lit, a boss killed, a cache opened) — never per-frame — so the
 * payload objects allocated at emit time cost nothing that matters.
 *
 * EVENT CATALOGUE (the contract every lane builds against; payload shapes are
 * part of the contract — add fields, never rename or remove):
 *
 *   world facts (emitted by the system that owns the fact)
 *     'realm:entered'     { realm }
 *     'shrine:activated'  { realm, id, x, z, first }
 *     'enemy:killed'      { realm, key, id, x, z, tier, bounty }
 *     'boss:killed'       { realm, kind: 'mini'|'realm', key, name, first }
 *     'portal:entered'    { from, to }
 *     'cache:opened'      { realm, site, kind: 'relic'|'lore'|'grand', loot }
 *     'trial:started'     { id }
 *     'trial:finished'    { id, time, medal, best, firstMedal }
 *     'trial:failed'      { id, reason }
 *     'bounty:revealed'   { id, realm, x, z }
 *     'bounty:killed'     { id, realm }
 *     'player:died'       { realm, x, z }
 *     'player:levelup'    { level }
 *
 *   quest engine output (emitted by src/quests/questSystem.js)
 *     'quest:step'        { realm, stepId, title, tracker }
 *     'quest:complete'    { realm, stepId, title, xp, rewards: [...] }
 *     'quest:waypoint'    { x, z, realm, label } | null  (null = clear)
 *     'dialogue'          { speaker, lines: [string], id }
 *     'hint'              { id, text }
 *     'ending:begin'      { }
 *
 *   rewards (emitted by src/progression/* and src/world/*)
 *     'reward'            { kind: 'relic'|'lore'|'glass'|'boon'|'trail'|'xp',
 *                           id, name, desc, amount }
 *     'boon:offer'        { bossKey, pair: [boonA, boonB] }
 *     'boon:chosen'       { bossKey, boon }
 *     'relic:equipped'    { id, slot }
 *     'glass:changed'     { total, delta }
 *
 *   UI requests (emitted by input/UI, consumed by panels)
 *     'ui:open'           { panel: 'journal'|'map'|'shrine'|'boon' }
 *     'ui:close'          { panel }
 */

/** @type {Map<string, Set<(p: any) => void>>} */
const _subs = new Map();

export const bus = {
    /**
     * @param {string} type @param {(p: any) => void} fn
     * @returns {() => void} unsubscribe
     */
    on(type, fn) {
        let s = _subs.get(type);
        if (!s) { s = new Set(); _subs.set(type, s); }
        s.add(fn);
        return () => s.delete(fn);
    },

    /** @param {string} type @param {(p: any) => void} fn */
    off(type, fn) {
        const s = _subs.get(type);
        if (s) s.delete(fn);
    },

    /**
     * Deliver synchronously. A throwing listener is isolated and logged so
     * one broken panel can never stop a quest from advancing.
     * @param {string} type @param {any} [payload]
     */
    emit(type, payload) {
        const s = _subs.get(type);
        if (!s || s.size === 0) return;
        for (const fn of Array.from(s)) {
            try {
                fn(payload);
            } catch (e) {
                console.error("[bus] listener for '" + type + "' threw:", e);
            }
        }
    },

    /** Test/probe surface: how many listeners a type has. */
    count(type) {
        const s = _subs.get(type);
        return s ? s.size : 0;
    },
};
