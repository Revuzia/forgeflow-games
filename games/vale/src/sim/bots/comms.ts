// VALE bots — team pings (ruling 65, "play as a team"): what a team's computer-played fighters say to each other and to
// the people on their team, and what they hear.
//
// Saying. A ping is the same Command a player sends ({ type: 'ping', kind, x, y }), so every human on the team sees and
// hears it exactly like a player's (HUD marker, sound, log line); the enemy team's pings never reach a human (the HUD and
// the audio draw and sound only pings made by a player of your own team). The genre's good-player habits, in VALE's terms:
//   assist     "help here": a fighter dived with nobody beside it; a structure of ours that enemy fighters are hitting;
//   onMyWay    "on my way": a fighter that turns to answer an assist, a structure call or a hunt;
//   retreat    "fall back": a fight that is lost (two or more of theirs over ours around the speaker);
//   danger     "careful": three or more enemy fighters in sight together, with a teammate walking at them alone;
//   missing    "missing": a road opponent that was in sight on the road and is gone (where it was last seen);
//   push       "group here": the team's group call on a structure;
//   objective  "take this": the team's camp call.
// Never about something the speaker's team cannot see: every point is a visible enemy, an own structure (its own health
// is the owner's to know), a teammate, or a last-seen position.
//
// No spam: one ping per event (each carries a key; a key is not said again while it holds), at most one a fighter every
// `gap` s and `perTeam` a team every 10 s (a player may send 5 every 4 s), fewer at novice.
//
// Hearing. Teammates' pings (people's and other computer-played fighters') are read off the sim's event stream
// (BotMatch.consume): an assist is answered by a fit teammate in reach that is not in a fight of its own and says so with
// onMyWay; retreat and danger weigh on the fighters near them (never a blind turn: only where the fight read agrees);
// a person's push and objective are weighed as team calls when the numbers allow; a person's onMyWay counts as an answer.

import type { EntityId, PingKind, PlayerId } from '../../contracts/sim.ts';

/** a teammate's ping, as heard (t: sim time) */
export interface Heard { readonly kind: PingKind; readonly x: number; readonly y: number; readonly target: EntityId; readonly t: number; readonly player: PlayerId; readonly human: boolean }

/** a call the team brain wants said by one of its fighters (the speaker), until `until` */
export interface Call { readonly kind: PingKind; readonly x: number; readonly y: number; readonly key: string; readonly hold: number; readonly by: PlayerId; readonly until: number }

/** how long a heard ping is kept (s) */
const HEARD_KEEP = 12;

export class TeamComms {
  /** teammates' pings heard in the last HEARD_KEEP s (oldest first) */
  heard: Heard[] = [];
  /** calls the team brain has queued for a speaker */
  calls: Call[] = [];
  private readonly teamTimes: number[] = [];
  private readonly seatAt = new Map<PlayerId, number>();
  private readonly keys = new Map<string, number>();
  /** per fighter: seconds between its pings; per team: pings in any 10 s */
  readonly gap: number;
  readonly perTeam: number;

  constructor(gap: number, perTeam: number) { this.gap = gap; this.perTeam = perTeam; }

  /** a key still holds (the event was already said) */
  holds(key: string, now: number): boolean { return (this.keys.get(key) ?? -1e9) > now; }

  /** may `p` say something now (its own gap and the team's budget), and is the event `key` new */
  canSay(p: PlayerId, now: number, key: string): boolean {
    if (this.holds(key, now)) return false;
    if (now - (this.seatAt.get(p) ?? -1e9) < this.gap + 0.05) return false;
    let n = 0;
    for (const t of this.teamTimes) if (now - t < 10.05) n++;
    return n < this.perTeam;
  }

  /** `p` said the event `key`; it is not said again for `hold` s */
  said(p: PlayerId, now: number, key: string, hold: number): void {
    this.seatAt.set(p, now);
    this.teamTimes.push(now);
    while (this.teamTimes.length > 0 && now - this.teamTimes[0] >= 10.05) this.teamTimes.shift();
    this.keys.set(key, now + hold);
    if (this.keys.size > 64) for (const [k, u] of [...this.keys]) if (u <= now) this.keys.delete(k);
  }

  /** mark an event as said without a ping (an answer already given another way) */
  mark(key: string, now: number, hold: number): void { this.keys.set(key, now + hold); }

  hear(h: Heard): void {
    this.heard.push(h);
    while (this.heard.length > 0 && h.t - this.heard[0].t > HEARD_KEEP) this.heard.shift();
  }

  /** queue a call for `by` (replaces an unsaid call of the same key) */
  call(c: Call, now: number): void {
    if (this.holds(c.key, now)) return;
    this.calls = this.calls.filter((x) => x.key !== c.key && x.until > now);
    this.calls.push(c);
  }

  /** the call `p` should say now, if any (dropped once said or stale) */
  takeCall(p: PlayerId, now: number): Call | null {
    for (let i = 0; i < this.calls.length; i++) {
      const c = this.calls[i];
      if (c.until <= now || this.holds(c.key, now)) { this.calls.splice(i--, 1); continue; }
      if (c.by !== p) continue;
      if (!this.canSay(p, now, c.key)) return null;
      this.calls.splice(i, 1);
      return c;
    }
    return null;
  }

  /** the latest heard ping of a kind within r of (x, y), no older than `age` s, by someone other than `self` (only a person's
   *  when `people`) */
  near(kind: PingKind, x: number, y: number, r: number, now: number, age: number, self: PlayerId, people = false): Heard | null {
    for (let i = this.heard.length - 1; i >= 0; i--) {
      const h = this.heard[i];
      if (now - h.t > age) break;
      if (h.kind !== kind || h.player === self || (people && !h.human)) continue;
      if ((h.x - x) * (h.x - x) + (h.y - y) * (h.y - y) <= r * r) return h;
    }
    return null;
  }
}
