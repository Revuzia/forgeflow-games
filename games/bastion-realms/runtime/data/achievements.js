// Achievement definitions — checked against the saved profile.
import { loadProfile } from '../core/save.js';

export const ACHIEVEMENTS = [
  { id: 'first_blood', name: 'First Blood', desc: 'Slay your first enemy.',
    check: (p) => p.counters.kills >= 1 },
  { id: 'first_win', name: 'Line Held', desc: 'Win any level.',
    check: (p) => p.counters.wins >= 1 },
  { id: 'flawless', name: 'Flawless Defense', desc: 'Earn 3 stars on any level.',
    check: (p) => Object.values(p.stars).some((s) => s >= 3) },
  { id: 'clear_forest', name: 'Warden of the Hollow', desc: 'Clear Verdant Hollow.',
    check: (p) => !!p.wins['0:8'] },
  { id: 'clear_volcanic', name: 'Cinder Sentinel', desc: 'Clear the Cinder Wastes.',
    check: (p) => !!p.wins['1:8'] },
  { id: 'clear_tundra', name: 'Frostmaw Bane', desc: 'Clear the Frostmaw Expanse.',
    check: (p) => !!p.wins['2:8'] },
  { id: 'clear_ruins', name: 'Gravekeeper', desc: 'Clear the Sunken Ruins.',
    check: (p) => !!p.wins['3:8'] },
  { id: 'clear_astral', name: 'Edge of Everything', desc: 'Clear the Astral Isles.',
    check: (p) => !!p.wins['4:8'] },
  { id: 'conqueror', name: 'Realm Conqueror', desc: 'Win all 45 levels.',
    check: (p) => Object.keys(p.wins).length >= 45 },
  { id: 'perfect_biome', name: 'Golden Realm', desc: 'Earn all 27 stars in one realm.',
    check: (p) => [0, 1, 2, 3, 4].some((bi) => {
      let n = 0; for (let li = 0; li < 9; li++) n += p.stars[bi + ':' + li] || 0;
      return n >= 27;
    }) },
  { id: 'all_towers', name: 'Full Arsenal', desc: 'Build every tower type at least once.',
    check: (p) => (p.counters.typesBuilt || []).length >= 8 },
  { id: 'maxed_all', name: 'Master Builder', desc: 'Fully upgrade every tower type.',
    check: (p) => (p.counters.maxedTypes || []).length >= 8 },
  { id: 'pyro', name: 'Pyromaniac', desc: 'Set 250 enemies ablaze.',
    check: (p) => p.counters.burns >= 250 },
  { id: 'cryo', name: 'Deep Freeze', desc: 'Flash-freeze 200 enemies.',
    check: (p) => p.counters.freezes >= 200 },
  { id: 'stormcaller', name: 'Stormcaller', desc: 'Hit 300 enemies with chain lightning.',
    check: (p) => p.counters.chains >= 300 },
  { id: 'toxicologist', name: 'Toxicologist', desc: 'Deal 500 seconds of poison.',
    check: (p) => p.counters.poisonTicks >= 500 },
  { id: 'merchant', name: 'War Profiteer', desc: 'Sell 15 towers.',
    check: (p) => p.counters.sold >= 15 },
  { id: 'endless_25', name: 'The Long Watch', desc: 'Reach wave 25 in Endless mode.',
    check: (p) => Object.values(p.endlessBest).some((w) => w >= 25) },
  { id: 'untouchable', name: 'Untouchable', desc: 'Win 10 levels with 3 stars.',
    check: (p) => Object.values(p.stars).filter((s) => s >= 3).length >= 10 },
];

// Returns newly-earned achievement defs (marks them in the profile; caller saves).
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
