/**
 * party_system.js — Party-based RPG (Baldur's Gate, Dragon Age, Divinity).
 * Multi-character formation + shared inventory + dialogue choices per character.
 *
 * API:
 *   const party = new Party({members: [{id, class, stats, abilities}]});
 *   party.selectMember(id);
 *   party.addToInventory(item);
 *   party.distributeXP(amount);
 */
class Party {
  constructor(cfg) {
    this.members = (cfg.members || []).map(m => ({
      id: m.id, name: m.name, class: m.class || "fighter", level: m.level ?? 1,
      hp: m.hp ?? 30, maxHp: m.hp ?? 30, mp: m.mp ?? 10, maxMp: m.mp ?? 10,
      xp: 0, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...(m.stats||{}) },
      abilities: m.abilities || [], equipment: m.equipment || {},
      alignment: m.alignment || "neutral", alive: true, position: 0,
    }));
    this.active = this.members[0]?.id;
    this.inventory = cfg.inventory || [];
    this.gold = cfg.gold ?? 0;
    this.reputation = cfg.reputation ?? 0;
    this.formation = cfg.formation || "line";  // line | diamond | wedge
  }
  selectMember(id) { if (this.members.find(m => m.id === id && m.alive)) this.active = id; }
  activeMember() { return this.members.find(m => m.id === this.active); }
  addToInventory(item, count = 1) {
    const existing = this.inventory.find(i => i.id === item.id);
    if (existing) existing.count = (existing.count || 1) + count;
    else this.inventory.push({ ...item, count });
  }
  removeFromInventory(itemId, count = 1) {
    const idx = this.inventory.findIndex(i => i.id === itemId);
    if (idx === -1) return false;
    this.inventory[idx].count -= count;
    if (this.inventory[idx].count <= 0) this.inventory.splice(idx, 1);
    return true;
  }
  equip(memberId, slot, itemId) {
    const m = this.members.find(x => x.id === memberId);
    if (!m) return false;
    const item = this.inventory.find(i => i.id === itemId);
    if (!item) return false;
    // Unequip current item in slot first
    const prev = m.equipment[slot];
    if (prev) this.addToInventory(prev);
    this.removeFromInventory(itemId, 1);
    m.equipment[slot] = item;
    return true;
  }
  distributeXP(amount) {
    const alive = this.members.filter(m => m.alive);
    if (!alive.length) return;
    const share = amount / alive.length;
    for (const m of alive) {
      m.xp += share;
      const needed = m.level * 100;
      while (m.xp >= needed) { m.xp -= needed; m.level++; m.maxHp += 5; m.hp = m.maxHp; }
    }
  }
  startDialogue(npcId, dialogueTree) {
    // Returns a DialogueEngine instance (requires dialogue_engine.js)
    if (typeof DialogueEngine === "undefined") return null;
    return new DialogueEngine({ tree: dialogueTree,
      onEnd: (flags) => {
        if (flags.reputation_delta) this.reputation += flags.reputation_delta;
      }
    });
  }
  rest() {
    // Restore HP + MP
    for (const m of this.members) { m.hp = m.maxHp; m.mp = m.maxMp; }
  }
}
if (typeof window !== "undefined") window.Party = Party;
