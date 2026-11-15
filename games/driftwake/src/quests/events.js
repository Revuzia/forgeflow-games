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
 *   lane Q additions (fields added, nothing renamed):
 *     'quest:step'        + index, total, progress: {have, need}|null,
 *                           underLevel (the level floor, 0 = none), reason
 *                           ('register'|'load'|'new'|'state'|'progress');
 *                           re-emitted when the tracker text or progress of
 *                           the SAME step changes — toast on quest:complete,
 *                           not on quest:step. realm null + stepId 'post' is
 *                           the post-game line.
 *     'quest:waypoint'    + kind ('shrine'|'pack'|'boss'|'portal'), stepId
 *     'dialogue'          + shrine: {realm, id, name} on a shrine's line
 *     'hint'              + ttl (s; 0 = shown until 'hint:clear')
 *     'hint:clear'        { id }                    NEW — hide a hint
 *     'ending:begin'      + echoId, lines (the Echo's last lines; the ending
 *                           sequence plays them — no separate 'dialogue')
 *     'boss:killed'       + combatKey, x, z (the arena centre)
 *     'enemy:killed'      emitted by progression.js (the registry drain);
 *                           bounty = bounty id or null
 *
 *   lane W additions (world activities, src/world/{caches,trials,bounties,
 *   beacon}.js — fields added, nothing renamed):
 *     'cache:discovered'  { realm, site, kind, x, z }   NEW — first time the
 *                           player comes within 90 m (the glint range); the
 *                           map's "discovered caches" (persisted in
 *                           quest.cachesSeen)
 *     'cache:opened'      + x, z; loot = { glass, relic: id|null, lore: id|null }
 *     'trial:started'     + name, gates, par
 *     'trial:gate'        { id, gate, of, time }        NEW — gate `gate` (1-based
 *                           gate index) of `of` passed at run time `time`;
 *                           gate 1 (the start) right after 'trial:started'
 *     'trial:finished'    + name, par, prevMedal, newBest; medal 0 none,
 *                           1 bronze, 2 silver, 3 gold
 *     'trial:failed'      reason 'missed'|'timeout'|'strayed'|'fell'|'realm'
 *     'bounty:revealed'   + name, unit, level, registryId
 *     'bounty:killed'     + name, x, z, registryId
 *     'reward'            + source ('cache'|'trial'|'bounty'), granted?: true.
 *                           W's rule: a 'reward' IS the grant for kinds
 *                           glass / relic / lore / trail — W never credits
 *                           the wallet, the relic inventory or the lore list
 *                           itself; the owning lane's listener does. Kind
 *                           'xp' from W carries granted: true — W already
 *                           paid it through progression.addXP; a listener
 *                           must NOT pay it again.
 *
 *   lane R additions (rewards + the shrine hub, src/progression/{modifiers,
 *   boons,relics,shop}.js, src/ui/{boonPick,shrineMenu}.js — fields added,
 *   nothing renamed):
 *     'reward'            kind 'reroll' { amount } NEW kind — one boon reroll
 *                           token. Lane R CONSUMES W's grant rule above: kinds
 *                           glass / relic / trail / reroll without granted:true
 *                           are applied by shop.js / relics.js exactly once. Lane
 *                           R's OWN payouts (boss first-kill glass, the
 *                           Chronicle reroll) are emitted with granted: true.
 *                           A relic 'reward' may carry realm/source/index
 *                           instead of id (relics.js relicFor resolves it).
 *     'boon:offer'        + boss (display name for the pick screen)
 *     'boon:chosen'       + respec: true when it was a swap, not a first pick
 *     'boon:triggered'    { id, name }              NEW — a boon fired (Undying
 *                           Wake saved the player at 1 HP)
 *     'glass:changed'     + why (provenance string)
 *     'shop:bought'       { itemId, rank, cost }     NEW
 *     'driftmark:offer'   { pending, marks }         NEW — a Driftmark was minted
 *                           and picks are waiting (the toast shows)
 *     'driftmark:chosen'  { pick: 'dmg'|'hp'|'surf', count, name, pending } NEW
 *     'shrine:travelled'  { realm, id, fromRealm, fromId }   NEW — fast travel
 *                           landed the player on that shrine's stand point
 *     'ui:open'           + id (panel 'shrine': which shrine), tab (panel
 *                           'journal': 'lore' from the shrine's Chronicle)
 *
 *   lane U additions (the player-facing UI, src/ui/{questTracker,compass,
 *   dialogue,toasts,journal,worldMap,introCard,ending,interact}.js — fields
 *   added, nothing renamed):
 *     'waypoint:pin'      { x, z, realm, label, id } | null   NEW — the player
 *                           marked a shrine on the world map (null = unmark).
 *                           ui/questTracker.js holds it as the EFFECTIVE
 *                           target over the quest's own waypoint (tracker
 *                           distance, compass tick, minimap pip, beacon) until
 *                           the rider is within 15 m of it or it is unmarked.
 *     'ui:open'           panel 'journal' + tab ('main'|'side'|'lore'|'stats');
 *                           panel 'map' + realm. Emitted by the panel itself
 *                           when it opens (any cause) and CONSUMED as a
 *                           request when nobody is open yet. A cursor panel
 *                           (journal, map) closes itself when 'ui:open' for
 *                           panel 'boon' or 'shrine' arrives.
 *     'ui:close'          panel 'journal'|'map'|'intro'|'ending'
 *     'ending:done'       { skipped }                 NEW — the ending sequence
 *                           (§9) handed control back (post-game begins)
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
