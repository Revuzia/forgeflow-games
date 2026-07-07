// Stronghold achievements.
import { loadProfile } from '../core/save.js';

export const ACHIEVEMENTS = [
  { id: 'first_scrap', name: 'First Scrap', desc: 'Destroy your first construct.', check: (p) => p.counters.kills >= 1 },
  { id: 'first_hold', name: 'The Keep Holds', desc: 'Win any level.', check: (p) => p.counters.wins >= 1 },
  { id: 'untouched', name: 'Not One Stone', desc: 'Win with the Keep above 90% HP.', check: (p) => Object.values(p.stars).some((s) => s >= 3) },
  { id: 'clear_colosseum', name: 'Champion of the Sands', desc: 'Clear the Ancient Colosseum.', check: (p) => !!p.wins['0:8'] },
  { id: 'clear_gothic', name: 'Dawn After the Siege', desc: 'Clear the Gothic Castle.', check: (p) => !!p.wins['1:8'] },
  { id: 'clear_sky', name: 'Lord of the High Air', desc: 'Clear the Floating Sky Citadel.', check: (p) => !!p.wins['2:8'] },
  { id: 'clear_crystal', name: 'Facet Breaker', desc: 'Clear the Crystal Fortress.', check: (p) => !!p.wins['3:8'] },
  { id: 'clear_dwarven', name: 'The Forge Falls Silent', desc: 'Clear the Dwarven Mountain Hold.', check: (p) => !!p.wins['4:8'] },
  { id: 'conqueror', name: 'Warden of All Realms', desc: 'Win all 45 levels.', check: (p) => Object.keys(p.wins).length >= 45 },
  { id: 'golden_world', name: 'Immaculate Realm', desc: 'Earn all 27 stars in one world.', check: (p) => [0, 1, 2, 3, 4].some((wi) => {
      let n = 0; for (let li = 0; li < 9; li++) n += p.stars[wi + ':' + li] || 0;
      return n >= 27;
    }) },
  { id: 'all_towers', name: 'Full Garrison', desc: 'Build every tower type at least once.', check: (p) => (p.counters.typesBuilt || []).length >= 8 },
  { id: 'maxed_all', name: 'Master of Works', desc: 'Fully upgrade every tower type.', check: (p) => (p.counters.maxedTypes || []).length >= 8 },
  { id: 'skewer', name: 'Skewer Sergeant', desc: 'Hit 400 enemies with piercing bolts.', check: (p) => p.counters.pierces >= 400 },
  { id: 'demolition', name: 'Demolitionist', desc: 'Detonate 150 rune traps.', check: (p) => p.counters.runeBlasts >= 150 },
  { id: 'stormlord', name: 'Stormlord', desc: 'Strike 300 enemies with chain lightning.', check: (p) => p.counters.chains >= 300 },
  { id: 'mason', name: 'Miracle Mason', desc: 'Repair 200 Keep HP with Holy Beacons.', check: (p) => p.counters.repairs >= 200 },
  { id: 'merchant', name: 'Scrap Merchant', desc: 'Sell 15 towers.', check: (p) => p.counters.sold >= 15 },
  { id: 'endless_25', name: 'The Eternal Watch', desc: 'Reach wave 25 in Endless mode.', check: (p) => Object.values(p.endlessBest).some((w) => w >= 25) },
  { id: 'ten_perfect', name: 'Unbreakable', desc: 'Win 10 levels with 3 stars.', check: (p) => Object.values(p.stars).filter((s) => s >= 3).length >= 10 },
];

export function evaluateAchievements() {
  const p = loadProfile();
  const fresh = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements[a.id] && a.check(p)) {
      p.achievements[a.id] = true;
      fresh.push(a);
    }
  }
  return fresh;
}
