/**
 * metroidvania_core.js — Ability-gated world + interconnected map (Super Metroid, Hollow Knight).
 * Tracks which abilities player has, which areas are gated.
 *
 * API:
 *   const mv = new Metroidvania({abilities, rooms, startRoom});
 *   mv.enter(roomId); mv.unlock(abilityId);
 *   mv.getAvailableExits(roomId) -> [rooms reachable now]
 */
class Metroidvania {
  constructor(cfg) {
    this.abilities = new Set();
    this.rooms = cfg.rooms || {};  // {id: {exits: [{to, requires: ["double_jump"]}], secrets: [...]}}
    this.discoveredRooms = new Set([cfg.startRoom]);
    this.currentRoom = cfg.startRoom;
    this.mapGrid = cfg.mapGrid || {};  // {roomId: {x, y}} for minimap
    this.savedItems = cfg.savedItems || {};
    this.collectedItems = new Set();
  }
  unlock(abilityId) { this.abilities.add(abilityId); }
  has(abilityId) { return this.abilities.has(abilityId); }
  canTraverse(exit) {
    if (!exit.requires) return true;
    return exit.requires.every(a => this.abilities.has(a));
  }
  enter(roomId) {
    this.currentRoom = roomId;
    this.discoveredRooms.add(roomId);
  }
  getAvailableExits(roomId) {
    const room = this.rooms[roomId];
    if (!room) return [];
    return (room.exits || []).filter(e => this.canTraverse(e));
  }
  getLockedExits(roomId) {
    const room = this.rooms[roomId];
    if (!room) return [];
    return (room.exits || []).filter(e => !this.canTraverse(e));
  }
  collectItem(itemId) {
    if (this.collectedItems.has(itemId)) return false;
    this.collectedItems.add(itemId);
    const info = this.savedItems[itemId];
    if (info && info.grants_ability) this.unlock(info.grants_ability);
    return true;
  }
  getMapNodes() {
    return Array.from(this.discoveredRooms).map(rid => ({
      id: rid, ...this.mapGrid[rid], current: rid === this.currentRoom,
    }));
  }
  computeReachability() {
    // BFS from current room considering abilities — returns set of reachable room IDs
    const reachable = new Set([this.currentRoom]);
    const queue = [this.currentRoom];
    while (queue.length > 0) {
      const r = queue.shift();
      for (const exit of this.getAvailableExits(r)) {
        if (!reachable.has(exit.to)) { reachable.add(exit.to); queue.push(exit.to); }
      }
    }
    return reachable;
  }
}
if (typeof window !== "undefined") window.Metroidvania = Metroidvania;
