// A deliberately trivial, deterministic BotController for lane-SIM probes (NOT the BOTS lane's AI).
//
// 'push'   attack-moves along its lane toward the enemy base (the next lane waypoint ahead of it);
//          an enemy unit within ENGAGE m draws it in (attack-move at it); an open enemy structure
//          within SIEGE m gets an attack order. Casts a1 when an enemy is within 3 m, levels
//          abilities, buys swords while it can shop.
// 'defend' holds the lane point DEFEND_AT of the way from its own base, attack-moving there.
// 'idle'   only levels abilities.
// It reads nothing but the WorldView / PlayerView it is handed (plus the catalog's map lanes).

import type { Command, PlayerView, SeatSetup, WorldView } from '../../src/contracts/sim.ts';
import type { BotController, BotHost } from '../../src/sim/sim.ts';

export type BotStyle = 'push' | 'defend' | 'idle';
const DEFEND_AT = 0.3;
const THINK_EVERY = 15;
const ENGAGE = 7;
const SIEGE = 12;

class LaneBot implements BotController {
  private n = 0;
  private readonly path: [number, number][];
  private readonly style: BotStyle;
  private readonly buy: string | null;

  constructor(seat: SeatSetup, host: BotHost, style: BotStyle, lane: number, buy: string | null) {
    this.style = style;
    this.buy = buy;
    const map = host.catalog.maps.find((m) => m.id === host.setup.map)!;
    const l = map.lanes.length ? map.lanes[lane % map.lanes.length].path.map((p) => [p[0], p[1]] as [number, number]) : [];
    this.path = seat.team === 1 ? l.slice().reverse() : l;
  }

  think(view: WorldView, me: PlayerView): readonly Command[] {
    const out: Command[] = [];
    this.n++;
    if (me.skillPoints > 0) {
      const a = me.abilities.find((x) => x.canLevel && x.slot === 'ult') ?? me.abilities.find((x) => x.canLevel);
      if (a && (a.slot === 'a1' || a.slot === 'a2' || a.slot === 'a3' || a.slot === 'ult')) out.push({ type: 'levelUp', slot: a.slot });
    }
    if (this.buy && me.canShop && me.gold >= 400 && this.n % THINK_EVERY === 0) out.push({ type: 'buy', item: this.buy });
    const e = view.entity(me.entity);
    if (!e || !e.alive || view.phase !== 'live' || this.style === 'idle' || this.path.length === 0) return out;
    const a1 = me.abilities.find((x) => x.slot === 'a1');
    if (a1 && a1.ready) {
      for (const o of view.entities) {
        if (!o.alive || o.team === e.team || !o.targetable || (o.visibleMask & (1 << e.team)) === 0) continue;
        if (o.kind !== 'fighter' && o.kind !== 'minion') continue;
        const dx = o.x - e.x, dy = o.y - e.y;
        if (dx * dx + dy * dy <= 9) { out.push({ type: 'cast', slot: 'a1' }); break; }
      }
    }
    if (this.n % THINK_EVERY !== 0) return out;
    if (this.style === 'push') {
      let unit: { x: number; y: number; d: number } | null = null, building: { id: number; d: number } | null = null;
      for (const o of view.entities) {
        if (!o.alive || o.team === e.team || o.team < 0 || !o.targetable || (o.visibleMask & (1 << e.team)) === 0) continue;
        const d = Math.hypot(o.x - e.x, o.y - e.y);
        if (o.kind === 'structure') { if (d <= SIEGE && (!building || d < building.d)) building = { id: o.id, d }; }
        else if ((o.kind === 'fighter' || o.kind === 'minion' || o.kind === 'summon') && d <= ENGAGE && (!unit || d < unit.d)) unit = { x: o.x, y: o.y, d };
      }
      if (unit) { out.push({ type: 'move', x: unit.x, y: unit.y, attackMove: true }); return out; }
      if (building) { out.push({ type: 'attack', target: building.id }); return out; }
    }
    const [x, y] = this.style === 'defend' ? this.along(DEFEND_AT) : this.next(e.x, e.y);
    out.push({ type: 'move', x, y, attackMove: true });
    return out;
  }

  /** the point a fraction f along the path */
  private along(f: number): [number, number] {
    const p = this.path;
    let total = 0;
    for (let i = 1; i < p.length; i++) total += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    let left = total * f;
    for (let i = 1; i < p.length; i++) {
      const seg = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
      if (left <= seg) { const t = left / seg; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t]; }
      left -= seg;
    }
    return p[p.length - 1];
  }

  /** the end of the path segment nearest to (x, y), or the next point when already there */
  private next(x: number, y: number): [number, number] {
    const p = this.path;
    let best = p.length - 1, bestD = Infinity;
    for (let i = 1; i < p.length; i++) {
      const ax = p[i - 1][0], ay = p[i - 1][1], bx = p[i][0], by = p[i][1];
      const vx = bx - ax, vy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
      const d = Math.hypot(ax + vx * t - x, ay + vy * t - y);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (Math.hypot(p[best][0] - x, p[best][1] - y) < 2.5 && best < p.length - 1) best++;
    return p[best];
  }
}

/** a bots factory for createSim: style (and lane) per seat */
export function fixtureBots(styleOf: (seat: SeatSetup) => BotStyle, o: { lane?: (seat: SeatSetup) => number; buy?: string | null } = {}) {
  return (seat: SeatSetup, host: BotHost): BotController =>
    new LaneBot(seat, host, styleOf(seat), o.lane ? o.lane(seat) : seat.player, o.buy === undefined ? 'fx_sword' : o.buy);
}
