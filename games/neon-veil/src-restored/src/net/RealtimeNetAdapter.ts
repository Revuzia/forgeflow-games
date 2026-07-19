// net/RealtimeNetAdapter.ts — real online multiplayer for Neon Veil over the
// shared FFG Supabase Realtime relay (Broadcast/Presence, no Postgres, $0).
// Owner-authority: each human sims + broadcasts its OWN ship; remote humans are
// rendered from wire packets (netRemote, skip local AI). v1: local AI bots stay
// per-client (humans are synced — the core feature); host-authoritative bots are
// a v2 refinement. Implements the same INetAdapter surface as LocalBotAdapter so
// free-roam / outlaw are untouched.
import type { INetAdapter } from './INetAdapter';
import type { KillEvent, PlayerState, TeamId, WeaponId } from '../core/types';
// @ts-expect-error — plain-JS relay, no type decls (bundled by Vite)
import { NetPlay } from './ffg_netplay.js';

const SUPABASE_URL = 'https://wugoxdewcdxzfppgzohy.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind1Z294ZGV3Y2R4emZwcGd6b2h5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM5OTU0MzEsImV4cCI6MjA2OTU3MTQzMX0.ljJYgVp0n9d_tJeL3ZG6liYfW0lQ7d_29svPMbUAves';

const BOT_NAMES = ['VEX-9', 'NULLSTAR', 'KITE', 'PHANTOM', 'RYU-0', 'GHOSTLINE', 'HEXA', 'ORBIT', 'SAKURA', 'DRIFT', 'NOVA', 'REDLINE'];
const STATE_MS = 66; // ~15 Hz own-ship broadcast

type Roster = { peer: string; name: string }[];

export class RealtimeNetAdapter implements INetAdapter {
  readonly localId: string;
  /** The map all players share (host's choice); read by Game after connect(). */
  roomMapId: string | null = null;

  private players = new Map<string, PlayerState>();
  private net: any;
  private roster: Roster = [];
  private interp = new Map<string, { a: any; b: any }>();
  private lastSeen = new Map<string, number>();
  private tState = 0;
  private base = 8 + Math.floor(Math.random() * 10);
  private started = false;
  private sessionMap: string;

  constructor(mapId: string) {
    this.net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, 'neon-veil');
    this.localId = this.net.id;
    this.sessionMap = mapId;
  }

  // ── INetAdapter ────────────────────────────────────────────────────────────
  async connect(callsign: string): Promise<void> {
    this.players.clear();
    await this._lobby(callsign); // resolves once the match starts (host START / guest 'start')
    // Build the player map from the agreed roster.
    for (const r of this.roster) {
      const isLocal = r.peer === this.localId;
      const p = this._make(r.peer, r.name, false, 0);
      p.netRemote = !isLocal; // remote humans are wire-driven
      this.players.set(r.peer, p);
    }
    if (!this.players.has(this.localId)) this.players.set(this.localId, this._make(this.localId, callsign || 'PILOT', false, 0));
    this.net.on('msg', (m: any) => this._recv(m.from, m.t, m.d));
    const bye = () => { try { this.net.leave(); } catch (e) {} };
    window.addEventListener('pagehide', bye);
    window.addEventListener('beforeunload', bye);
  }

  disconnect() {
    try { this.net.leave(); } catch (e) {}
    this.players.clear();
    this.interp.clear();
  }

  spawnBots(count: number, teamMode: boolean) {
    // v1: local AI bots per client (not synced). Humans are synced separately.
    for (const [id, p] of this.players) if (p.isBot) this.players.delete(id);
    for (let i = 0; i < count; i++) {
      const id = `bot-${this.localId}-${i}`;
      const team: TeamId = teamMode ? (((i % 2) + 1) as TeamId) : 0;
      this.players.set(id, this._make(id, BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? `-${i}` : ''), true, team));
    }
  }

  getPlayers(): PlayerState[] { return [...this.players.values()]; }
  getLocal(): PlayerState { return this.players.get(this.localId)!; }
  getPlayer(id: string) { return this.players.get(id); }

  pushLocal(partial: Partial<PlayerState>) {
    const p = this.players.get(this.localId);
    if (!p) return;
    Object.assign(p, partial);
  }

  updatePlayer(id: string, partial: Partial<PlayerState>) {
    const p = this.players.get(id);
    if (p) Object.assign(p, partial);
  }

  onKill(ev: KillEvent) {
    const killer = this.players.get(ev.killerId);
    const victim = this.players.get(ev.victimId);
    if (killer) { killer.kills++; killer.score += 100; }
    if (victim) { victim.deaths++; victim.alive = false; victim.health = 0; }
    // authoritatively tell the room who died (idempotent)
    this.net.send('kill', { k: ev.killerId, v: ev.victimId });
  }

  getPilotCount() { return this.base + this.players.size; }

  tick(dt: number) {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // 1) interpolate remote humans toward their latest packet
    for (const p of this.players.values()) {
      if (!p.netRemote) continue;
      const buf = this.interp.get(p.id);
      if (buf && buf.b) this._interp(p, buf, now);
    }
    // 2) broadcast my own ship @~15 Hz
    const me = this.players.get(this.localId);
    if (me && now - this.tState > STATE_MS) {
      this.tState = now;
      this.net.send('st', {
        x: +me.position[0].toFixed(2), y: +me.position[1].toFixed(2), z: +me.position[2].toFixed(2),
        qx: +me.rotation[0].toFixed(3), qy: +me.rotation[1].toFixed(3), qz: +me.rotation[2].toFixed(3), qw: +me.rotation[3].toFixed(3),
        vx: +me.velocity[0].toFixed(2), vy: +me.velocity[1].toFixed(2), vz: +me.velocity[2].toFixed(2),
        h: Math.round(me.health), s: Math.round(me.shield), w: me.weapon, a: me.alive ? 1 : 0,
        k: me.kills, d: me.deaths, sc: me.score,
      });
    }
    // ping display
    for (const p of this.players.values()) p.ping = p.netRemote ? 24 + Math.floor(Math.random() * 30) : 14 + Math.floor(Math.random() * 8);
  }

  // ── networking internals ────────────────────────────────────────────────
  private _recv(from: string, t: string, d: any) {
    if (!d) return;
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    if (t === 'st') {
      const p = this.players.get(from);
      if (!p || !p.netRemote) return;
      // authoritative non-transform fields set directly
      p.health = d.h; p.shield = d.s; p.weapon = d.w as WeaponId; p.alive = d.a === 1;
      p.kills = d.k; p.deaths = d.d; p.score = d.sc;
      let buf = this.interp.get(from);
      if (!buf) this.interp.set(from, (buf = { a: null, b: null }));
      buf.a = buf.b;
      buf.b = { pos: [d.x, d.y, d.z], rot: [d.qx, d.qy, d.qz, d.qw], vel: [d.vx, d.vy, d.vz], at: now };
      this.lastSeen.set(from, now);
    } else if (t === 'kill') {
      const k = this.players.get(d.k), v = this.players.get(d.v);
      if (k) { k.kills++; k.score += 100; }
      if (v) { v.deaths++; v.alive = false; v.health = 0; }
    } else if (t === 'bye') {
      // remote human left → mark dead + drop (their pawn will be cleaned by the game on death)
      const p = this.players.get(from);
      if (p) { p.alive = false; }
    }
  }

  private _interp(p: PlayerState, buf: { a: any; b: any }, now: number) {
    const b = buf.b, a = buf.a || buf.b;
    const span = Math.max(1, b.at - a.at);
    const k = Math.min(1, Math.max(0, (now - b.at) / span));
    const over = Math.min(0.1, Math.max(0, (now - b.at) / 1000));
    for (let i = 0; i < 3; i++) p.position[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * k + b.vel[i] * over;
    // nearest-neighbour quaternion (short arc) — good enough for a hologram
    p.rotation = k < 0.5 ? (a.rot.slice() as any) : (b.rot.slice() as any);
    p.velocity = b.vel.slice() as any;
  }

  // ── lobby overlay (mirrors the proven Grid Rush lobby) ────────────────────
  private _lobby(callsign: string): Promise<void> {
    return new Promise((resolve) => {
      const net = this.net;
      const peers = new Map<string, { name: string; peer: string }>();
      peers.set(net.id, { name: callsign || 'PILOT', peer: net.id });
      this._injectStyle();
      const ov = document.createElement('div');
      ov.className = 'nv-lobby';
      ov.innerHTML = `<div class="nv-lobby-box">
        <div class="nv-lobby-title">PLAY ONLINE</div>
        <div id="nv-lstatus" class="nv-lstatus">Finding a match…</div>
        <div id="nv-lplayers" class="nv-lplayers"></div>
        <div class="nv-lrow"><input id="nv-lcode" class="nv-linput" maxlength="4" placeholder="CODE" autocomplete="off"/><button id="nv-ljoin" class="nv-lbtn">JOIN</button></div>
        <div class="nv-lrow"><button id="nv-lcreate" class="nv-lbtn">CREATE ROOM</button><button id="nv-lstart" class="nv-lbtn nv-lprimary" disabled>START</button></div>
      </div>`;
      (document.getElementById('app') || document.body).appendChild(ov);
      const $ = (id: string) => ov.querySelector('#' + id) as HTMLElement;
      const setStatus = (s: string) => { ($('nv-lstatus') as HTMLElement).textContent = s; };
      const render = () => {
        ($('nv-lplayers') as HTMLElement).innerHTML = [...peers.values()].map((p, i) => `<div>${i === 0 ? '★ ' : ''}${(p.name || 'PILOT').toUpperCase()}</div>`).join('');
        const iAmHost = net.isHost();
        const sb = $('nv-lstart') as HTMLButtonElement;
        sb.disabled = !iAmHost || !net.room;
        sb.textContent = iAmHost ? `START · ${peers.size}P` : 'WAITING…';
      };
      const begin = (roster: Roster, mapId: string) => {
        this.started = true;
        this.roster = roster;
        this.roomMapId = mapId;
        ov.remove();
        resolve();
      };
      net.on('open', () => { setStatus(`Room ${net.room} · share the code`); net.send('hello', { name: peers.get(net.id)!.name, peer: net.id }); render(); });
      net.on('peer', render);
      net.on('msg', (m: any) => {
        if (this.started) return;
        if (m.t === 'hello') { peers.set(m.from, { name: m.d.name, peer: m.from }); net.send('hello', { name: peers.get(net.id)!.name, peer: net.id }); render(); }
        else if (m.t === 'start') begin(m.d.roster, m.d.mapId);
      });
      ($('nv-lcreate') as HTMLElement).addEventListener('click', async () => { setStatus('Creating room…'); await net.joinRoom(this._code(), true); });
      ($('nv-ljoin') as HTMLElement).addEventListener('click', async () => { const c = (($('nv-lcode') as HTMLInputElement).value || '').trim().toUpperCase(); if (c.length >= 3) { setStatus(`Joining ${c}…`); await net.joinRoom(c, false); } });
      ($('nv-lstart') as HTMLElement).addEventListener('click', () => {
        if (!net.isHost()) return;
        const ids = [...peers.keys()].sort((a, b) => (a === net.id ? -1 : b === net.id ? 1 : a < b ? -1 : 1)).slice(0, 8);
        const roster: Roster = ids.map((pid) => ({ peer: pid, name: peers.get(pid)!.name }));
        net.send('start', { roster, mapId: this.sessionMap });
        begin(roster, this.sessionMap);
      });
      net.quickMatch(8000).then((res: any) => {
        if (this.started) return;
        if (res) { setStatus(`Matched · room ${res.room}`); net.send('hello', { name: peers.get(net.id)!.name, peer: net.id }); render(); }
        else setStatus('No quick match — CREATE or JOIN a code');
      });
    });
  }

  private _code() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }

  private _make(id: string, callsign: string, isBot: boolean, team: TeamId): PlayerState {
    return {
      id, callsign, team,
      position: [0, 40, 0], rotation: [0, 0, 0, 1], velocity: [0, 0, 0],
      health: 100, shield: 100, shieldDeployed: false, weapon: 'plasma' as WeaponId,
      kills: 0, deaths: 0, score: 0, alive: true, isBot, ping: isBot ? 30 : 15,
    };
  }

  private _injectStyle() {
    if (document.getElementById('nv-lobby-style')) return;
    const s = document.createElement('style');
    s.id = 'nv-lobby-style';
    s.textContent = `
    .nv-lobby{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:#04000ccc;backdrop-filter:blur(4px);font-family:"Share Tech Mono",monospace}
    .nv-lobby-box{width:min(400px,92vw);padding:1.4rem 1.5rem;background:rgba(8,4,22,.94);border:1px solid #00f0ff;border-radius:14px;box-shadow:0 0 46px #00f0ff22;color:#e8f7ff;text-align:center}
    .nv-lobby-title{font-family:"Orbitron",sans-serif;font-weight:800;letter-spacing:.16em;color:#00f0ff;margin-bottom:.5rem}
    .nv-lstatus{font-size:.72rem;color:#ffe566;min-height:1.2em;margin-bottom:.7rem}
    .nv-lplayers{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.8rem;min-height:1.5em;font-size:.72rem;color:#c8dcff}
    .nv-lrow{display:flex;gap:.5rem;margin-top:.5rem}
    .nv-lbtn{flex:1;padding:.6rem;border-radius:7px;cursor:pointer;font-family:"Orbitron",sans-serif;font-weight:700;letter-spacing:.1em;font-size:.7rem;border:1px solid #00f0ff55;background:#00f0ff14;color:#e8ffff}
    .nv-lbtn:disabled{opacity:.5;cursor:default}
    .nv-lprimary{border-color:#ff2bd6;background:#ff2bd61f}
    .nv-linput{flex:1;padding:.6rem;background:#00000066;border:1px solid #00f0ff66;border-radius:6px;color:#fff;letter-spacing:.3em;text-align:center;text-transform:uppercase;font-family:inherit}`;
    document.head.appendChild(s);
  }
}
