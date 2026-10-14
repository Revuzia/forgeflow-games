// GENESIS — LIVING LAND (LIVING.md §2.9): needs that can be met. Status was only ever lowered (every adult sat at 0) and
// curiosity was fed only by experiments and exploring (70 % at 0). Now:
//   status     rises from standing — leading, keeping the faith as a priest, mastery of one's craft (skill ≥ 0.7 in the
//              role's skill), age (an elder), heading a household with a roof over it (daily: statusDaily) — and from
//              deeds: a successful hunt, a discovery, teaching, raising a building, a fulfilled prophecy (the
//              RELATIONSHIP lane calls statusGain for its prophet)
//   curiosity  rises from talk with someone who knows what they do not, watching a craft being worked, learning (being
//              taught, books), a new place (exploring), an omen (RELATIONSHIP), a story at a festival (gatherings.ts)
// Gains are added to the need directly (needs.ts integrates its decay lazily between an agent's turns).

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { AgentFlag } from '../types.ts';
import { NS, ROLE, SKILL, TASK } from './defs.ts';
import { CURIO, NEED_N, STATUS } from './needs.ts';

/** status a day from standing (each a share of the day's decay of 0.08: a leader is held high, a household head kept up) */
const STANDING = { leader: 0.5, priest: 0.3, master: 0.2, elder: 0.18, head: 0.14, housed: 0.06 } as const;

/** the skill each role is judged by (mastery: ≥ 0.7) */
const ROLE_SKILL: Record<number, number> = {
  [ROLE.gatherer]: SKILL.gather, [ROLE.hunter]: SKILL.hunt, [ROLE.fisher]: SKILL.fish, [ROLE.farmer]: SKILL.farm, [ROLE.herder]: SKILL.herd,
  [ROLE.crafter]: SKILL.craft, [ROLE.builder]: SKILL.build, [ROLE.teacher]: SKILL.lore, [ROLE.priest]: SKILL.lore, [ROLE.healer]: SKILL.heal,
  [ROLE.scholar]: SKILL.lore, [ROLE.soldier]: SKILL.fight,
};

/** status rises for agent s by v (a deed: a hunt, a discovery, a prophecy fulfilled — exported for other lanes) */
export function statusGain(x: PCtx, s: number, v: number): void {
  const i = s * NEED_N + STATUS;
  x.A.needs[i] = Math.min(1, x.A.needs[i] + v);
}

/** curiosity is fed for agent s by v (something new seen, heard or learned) */
export function curiosityGain(x: PCtx, s: number, v: number): void {
  const i = s * NEED_N + CURIO;
  x.A.needs[i] = Math.min(1, x.A.needs[i] + v);
}

/** daily (settlement.ts daily): the status of standing, for every adult of st */
export function statusDaily(x: PCtx, st: Settlement): void {
  const A = x.A;
  const homes = new Set<number>();
  for (const h of st.households) if (h.home >= 0) for (const id of h.members) homes.add(id);
  // a household's head: its eldest adult (one per household)
  const heads = new Set<number>();
  for (const h of st.households) {
    let head = -1;
    for (const id of h.members) {
      const s = A.slotOf(id);
      if (s < 0 || A.flags[s] & AgentFlag.child) continue;
      if (head < 0 || A.birth[s] < A.birth[head]) head = s;
    }
    if (head >= 0) heads.add(A.id[head]);
  }
  for (const m of x.ps.members.get(st.id) ?? []) {
    if (A.flags[m] & AgentFlag.child) continue;
    let v = 0;
    const role = A.role[m];
    if (role === ROLE.leader || A.id[m] === st.leader) v += STANDING.leader;
    if (role === ROLE.priest) v += STANDING.priest;
    const sk = ROLE_SKILL[role];
    if (sk !== undefined && A.skills[m * NS + sk] >= 0.7) v += STANDING.master;
    if (A.flags[m] & AgentFlag.elder) v += STANDING.elder;
    const id = A.id[m];
    if (homes.has(id)) v += heads.has(id) ? STANDING.head : STANDING.housed;
    if (A.partner[m] && homes.has(id)) v += 0.04;
    if (v > 0) statusGain(x, m, v);
  }
}

/** after company (work.ts, TASK.socialize): someone here knows what agent s does not — curiosity, the talk's news */
export function talkOutlet(x: PCtx, s: number, others: readonly number[]): void {
  const A = x.A, kw = A.kw;
  for (const o of others) {
    if (o === s) continue;
    for (let w = 0; w < kw; w++) {
      if (A.know[o * kw + w] & ~A.know[s * kw + w]) { curiosityGain(x, s, 0.15); return; }
    }
  }
}

/** a craft worked (work.ts, TASK.craft): those standing by watch it (curiosity), the maker's status for a fine piece */
export function craftOutlet(x: PCtx, s: number, others: readonly number[]): void {
  const A = x.A;
  for (const o of others) if (o !== s && A.task[o] !== TASK.sleep && A.task[o] !== TASK.camp) curiosityGain(x, o, 0.1);
  statusGain(x, s, 0.02);
}
