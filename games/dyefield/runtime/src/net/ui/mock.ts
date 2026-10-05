// DYEFIELD — a scripted stand-in for SYNC's OnlineApi (CONTRACT_ONLINE §O11.1: "LOBBY-UI builds and tests its screens
// against a mock (runtime/src/net/ui/mock.ts) until SYNC lands"). No network, no sim: timers walk the same status
// sequence the real relay produces (§O4.2 quick match, §O4.3 code rooms, §O3.3 errors), and every state can also be
// forced from the harness (set / emit / setHud), which is how _harness/netlobby.py reaches each screen.
//
// Codes for joinRoom (dev; all inside the code alphabet): 'FULL' → room_full · 'ZZZZ' → not_found · 'BLDX' → build · 'QTAX' → quota · 'NETX' →
// network · anything else → a room owned by another player (3 members). Quick match: a group forms after
// `qmMatchS` (default 6 s); with `solo: true` the lobby answers `solo` after `soloS` (default 4 s) instead.

import type {
  NetErrorCode, NetStatus, OnlineApi, OnlineEvent, OnlineHudState, OnlineMode, OnlineProfile, OnlineRule, OnlineSkill,
  RoomMember, RoomView,
} from './types.ts';

export interface MockOptions {
  /** time scale for the scripted delays (0.25 = four times faster) */
  speed?: number;
  /** quick match: answer `solo` instead of forming a group */
  solo?: boolean;
  qmMatchS?: number;
  soloS?: number;
  /** PLAY VS BOTS (the UI's hook decides what that means) */
  onBots?: (mode: OnlineMode, rule: OnlineRule) => void;
  /** the room code a created room gets */
  code?: string;
  /** my device for the members list */
  device?: 'kbm' | 'touch';
}

const GUESTS: Array<Pick<RoomMember, 'name' | 'kit' | 'crew' | 'color' | 'device'>> = [
  { name: 'Mossy', kit: 'sheet-drum', crew: 2, color: 3, device: 'kbm' },
  { name: 'June88', kit: 'needle-glint', crew: 1, color: 5, device: 'touch' },
  { name: 'Kai', kit: 'pop-well', crew: 2, color: 2, device: 'kbm' },
  { name: 'Pixel Pete', kit: 'mist-rasp', crew: 1, color: 6, device: 'kbm' },
  { name: 'Tamsin', kit: 'sheet-drum', crew: 0, color: 7, device: 'touch' },
  { name: 'Oz', kit: 'pop-well', crew: 2, color: 4, device: 'kbm' },
  { name: 'Lumi', kit: 'needle-glint', crew: 1, color: 8, device: 'touch' },
];

export class MockOnline implements OnlineApi {
  private st: NetStatus = { kind: 'idle' };
  private readonly statusFns = new Set<(s: NetStatus) => void>();
  private readonly eventFns = new Set<(e: OnlineEvent) => void>();
  private timers: number[] = [];
  private prof: OnlineProfile = { name: 'YOU', kit: 'mist-rasp', crew: 1, ffaColor: 1 };
  private hudState: OnlineHudState | null = null;
  private last: { mode: OnlineMode; rule: OnlineRule } = { mode: 'teams', rule: 'turf' };
  readonly o: Required<Omit<MockOptions, 'onBots'>> & Pick<MockOptions, 'onBots'>;
  /** read-back: every API call, in order (the harness asserts the UI called the right ones) */
  readonly calls: Array<{ m: string; a: unknown[] }> = [];

  constructor(o: MockOptions = {}) {
    this.o = { speed: o.speed ?? 1, solo: o.solo ?? false, qmMatchS: o.qmMatchS ?? 6, soloS: o.soloS ?? 4, onBots: o.onBots,
      code: o.code ?? 'K7QX', device: o.device ?? 'kbm' };
  }

  // ───────────────────────────── harness controls ─────────────────────────────
  /** force a status (every subscriber hears it) */
  set(s: NetStatus): void { this.clear(); this.put(s); }
  /** fire an event */
  emit(e: OnlineEvent): void { for (const f of [...this.eventFns]) { try { f(e); } catch (err) { console.error('[dfo mock] event listener', err); } } }
  /** the in-match HUD state (null = not in a match) */
  setHud(h: OnlineHudState | null): void { this.hudState = h; }
  /** a ready-made room view (code room by default; I own it) */
  room(p: Partial<RoomView> & { humans?: number } = {}): RoomView {
    const humans = Math.max(1, Math.min(8, p.humans ?? 3));
    const mySlot = p.mySlot ?? 0;
    const members: RoomMember[] = [];
    for (let s = 0; s < humans; s++) {
      if (s === mySlot) members.push(this.me(s, (p.ownerSlot ?? 0) === s, (p.hostSlot ?? 0) === s));
      else {
        const g = GUESTS[(s + (s > mySlot ? -1 : 0)) % GUESTS.length];
        members.push({ slot: s, ...g, conn: true, owner: (p.ownerSlot ?? 0) === s, host: (p.hostSlot ?? 0) === s, rttMs: 40 + ((s * 37) % 160) });
      }
    }
    return {
      code: p.code ?? this.o.code, quick: p.quick ?? false, mode: p.mode ?? this.last.mode, rule: p.rule ?? this.last.rule,
      map: p.map ?? 'random', preset: p.preset ?? 'noon', skill: p.skill ?? 'swell', phase: p.phase ?? 'room', matchNo: p.matchNo ?? 0,
      members: p.members ?? members, mySlot, ownerSlot: p.ownerSlot ?? 0, hostSlot: p.hostSlot ?? 0,
    };
  }

  private me(slot: number, owner: boolean, host: boolean): RoomMember {
    return { slot, name: this.prof.name || 'YOU', kit: this.prof.kit, crew: this.prof.crew, color: this.prof.ffaColor, device: this.o.device,
      conn: true, owner, host, rttMs: 32 };
  }

  private put(s: NetStatus): void {
    this.st = s;
    for (const f of [...this.statusFns]) { try { f(s); } catch (err) { console.error('[dfo mock] status listener', err); } }
  }
  private after(sec: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, Math.max(0, sec * 1000 * this.o.speed)));
  }
  private clear(): void { for (const t of this.timers) clearTimeout(t); this.timers = []; }
  private log(m: string, ...a: unknown[]): void { this.calls.push({ m, a }); if (this.calls.length > 200) this.calls.shift(); }
  private curRoom(): RoomView | null { return this.st.kind === 'room' ? this.st.room : null; }
  private patchRoom(p: Partial<RoomView>): void {
    const r = this.curRoom();
    if (r) this.put({ kind: 'room', room: { ...r, ...p } });
  }
  private err(code: NetErrorCode, msg = ''): void { this.put({ kind: 'error', code, msg }); }

  // ───────────────────────────── OnlineApi ─────────────────────────────
  quickMatch(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void {
    this.log('quickMatch', mode, rule, p);
    this.clear();
    this.prof = { ...p };
    this.last = { mode, rule };
    this.put({ kind: 'connecting' });
    this.after(0.5, () => this.put({ kind: 'queue', waiting: 1, waitedS: 0 }));
    if (this.o.solo) {
      this.after(0.5 + this.o.soloS, () => this.put({ kind: 'solo' }));
      return;
    }
    this.after(2, () => this.put({ kind: 'queue', waiting: 2, waitedS: 2 }));
    this.after(4, () => this.put({ kind: 'queue', waiting: 3, waitedS: 4 }));
    this.after(this.o.qmMatchS, () => this.put({ kind: 'room', room: this.room({ quick: true, humans: 3, mySlot: 1, ownerSlot: 0, hostSlot: 0, map: 'random', skill: 'swell', preset: 'noon' }) }));
    this.after(this.o.qmMatchS + 2.5, () => this.patchRoom({ phase: 'loading', matchNo: 1 }));
  }

  createRoom(mode: OnlineMode, rule: OnlineRule, p: OnlineProfile): void {
    this.log('createRoom', mode, rule, p);
    this.clear();
    this.prof = { ...p };
    this.last = { mode, rule };
    this.put({ kind: 'connecting' });
    this.after(0.6, () => this.put({ kind: 'room', room: this.room({ humans: 1, mode, rule }) }));
    this.after(3, () => {
      const r = this.curRoom();
      if (!r || r.members.length >= 8) return;
      const g = GUESTS[0];
      this.patchRoom({ members: [...r.members, { slot: 1, ...g, conn: true, owner: false, host: false, rttMs: 74 }] });
      this.emit({ t: 'joined', name: g.name });
    });
  }

  joinRoom(code: string, p: OnlineProfile): void {
    this.log('joinRoom', code, p);
    this.clear();
    this.prof = { ...p };
    this.put({ kind: 'connecting' });
    const fail: Record<string, NetErrorCode> = { FULL: 'room_full', ZZZZ: 'not_found', BLDX: 'build', QTAX: 'quota', NETX: 'network' };
    const bad = fail[code];
    this.after(0.6, () => {
      if (bad) { this.err(bad); return; }
      this.put({ kind: 'room', room: this.room({ code, humans: 3, mySlot: 2, ownerSlot: 0, hostSlot: 0, map: 'lockwell', skill: 'storm' }) });
    });
  }

  setProfile(p: Partial<OnlineProfile>): void {
    this.log('setProfile', p);
    this.prof = { ...this.prof, ...p };
    const r = this.curRoom();
    if (r) this.patchRoom({ members: r.members.map((m) => (m.slot === r.mySlot ? { ...m, name: this.prof.name, kit: this.prof.kit, crew: this.prof.crew, color: this.prof.ffaColor } : m)) });
  }

  configure(c: Partial<{ mode: OnlineMode; rule: OnlineRule; map: string; preset: string; skill: OnlineSkill }>): void {
    this.log('configure', c);
    const r = this.curRoom();
    if (!r || r.mySlot !== r.ownerSlot || r.phase !== 'room') return;
    this.patchRoom(c);
  }

  start(): void {
    this.log('start');
    const r = this.curRoom();
    if (!r || r.mySlot !== r.ownerSlot) return;
    if (r.members.filter((m) => m.conn).length < 2) return;
    this.patchRoom({ phase: 'loading', matchNo: r.matchNo + 1 });
  }

  kick(slot: number): void {
    this.log('kick', slot);
    const r = this.curRoom();
    if (!r || r.mySlot !== r.ownerSlot || slot === r.mySlot) return;
    const m = r.members.find((x) => x.slot === slot);
    this.patchRoom({ members: r.members.filter((x) => x.slot !== slot) });
    if (m) this.emit({ t: 'left', name: m.name });
  }

  rematch(): void {
    this.log('rematch');
    const r = this.curRoom();
    if (!r) return;
    if (r.quick) this.after(2, () => this.patchRoom({ phase: 'loading', matchNo: r.matchNo + 1 }));
    else if (r.mySlot === r.ownerSlot) this.patchRoom({ phase: 'room' });
  }

  keepWaiting(): void {
    this.log('keepWaiting');
    this.clear();
    this.put({ kind: 'queue', waiting: 1, waitedS: 45 });
    this.after(this.o.soloS, () => this.put({ kind: 'solo' }));
  }

  playBotsInstead(): void {
    this.log('playBotsInstead');
    this.clear();
    this.put({ kind: 'idle' });
    this.o.onBots?.(this.last.mode, this.last.rule);
  }

  leave(): void {
    this.log('leave');
    this.clear();
    this.hudState = null;
    this.put({ kind: 'idle' });
  }

  status(): NetStatus { return this.st; }
  onStatus(cb: (s: NetStatus) => void): () => void { this.statusFns.add(cb); return () => { this.statusFns.delete(cb); }; }
  hud(): OnlineHudState | null { return this.hudState; }
  onEvent(cb: (e: OnlineEvent) => void): () => void { this.eventFns.add(cb); return () => { this.eventFns.delete(cb); }; }
  inviteUrl(): string | null {
    const r = this.curRoom();
    if (!r || r.quick) return null;
    try { const u = new URL(location.href); u.search = `?room=${r.code}`; u.hash = ''; return u.href; } catch { return null; }
  }

  /** a full 8-player HUD state for the in-match overlays */
  static hudSample(o: Partial<OnlineHudState> = {}): OnlineHudState {
    const names = ['YOU', 'Mossy', 'June88', 'Brine', 'Kai', 'Nettle', 'Pixel Pete', 'Tully'];
    return {
      rttMs: 84, quality: 'good', host: false, hostName: 'Mossy', migrating: false,
      players: names.map((name, runner) => {
        const human = !['Brine', 'Nettle', 'Tully'].includes(name);
        return { runner, name, human, conn: human, rttMs: human ? (runner === 0 ? 84 : 40 + ((runner * 53) % 190)) : null };
      }),
      ...o,
    };
  }
}
