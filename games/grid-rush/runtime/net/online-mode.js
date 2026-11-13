/* Grid Rush — net/online-mode.js
 * OnlineMode: the mode-registry implementation for online play (owner-authority,
 * host referees the AI, everyone interpolates the rest), plus openOnlineLobby()
 * for the menu. Mirrors Last Circle / Cosmic Coils. Reuses the mode hooks the
 * single-player modes already use (onRaceStart / update / onRacerFinish / hudExtra
 * / isOver / teardown) + a few net-specific guards wired in game.js.
 */
import { NetPlay, SUPABASE_URL, SUPABASE_ANON_KEY, packKart, applyPacketAuthoritative, pushInterp, interpKart } from './gridnet.js';
import { VEHICLES } from '../config.js';
import { buildVehicleMesh } from '../vehicles.js';

const STATE_MS = 66; // ~15 Hz own-kart broadcast
const BOTS_MS = 83; // ~12 Hz host bot batch
const SYNC_MS = 1400; // ~0.7 Hz clock/standings
const SILENT_MS = 12000; // silent-human → host bot-adopts the slot

export class OnlineMode {
  constructor(net, roster, cfg) {
    this.id = 'online';
    this.usesLaps = true;
    this.net = net;
    this.roster = roster || [];
    this.cfg = cfg || {};
    this.mySlot = 0;
    this.interp = new Map(); // slot → {a,b}
    this.lastSeen = new Map(); // slot → performance.now()
    this.finishedSlots = new Set();
    this.t = { st: 0, bots: 0, sync: 0 };
    this._published = false;
    this._adopted = false;
    this._active = false; // true only between onRaceStart and teardown
    this._hostFlag = null;
    this._hud = null;
    this._onMsg = null;
    this._onLeave = null;
  }

  // H3 (per-race setup) — reassign ownership of the 6 built slots per the roster.
  onRaceStart(game) {
    this.mySlot = this.roster.find((r) => r.peer === this.net.id)?.slot ?? 0;
    const humanBySlot = new Map(this.roster.map((r) => [r.slot, r]));

    game.racers.forEach((r, i) => {
      r.slot = i; // slot == grid index (placeOnGrid order)
      const human = humanBySlot.get(i);
      if (human) {
        this._applyRole(game, r, human.vehicleId, human.name, i === this.mySlot);
      } else {
        r.__bot = true;
        r.isPlayer = false;
        r.netRemote = !this.net.isHost(); // host simulates bots; guests interpolate
      }
    });

    game.player = game.racers[this.mySlot];
    game.player.isPlayer = true;
    game.player.netRemote = false;
    game.player.__bot = false;

    this._hostFlag = this.net.isHost();
    this._wireNet(game);
    this._ensureHud();
    if (game.els.banner) game.els.banner.textContent = `ONLINE · ${game.track?.def?.name || 'CIRCUIT'} · ROOM ${this.net.room || '—'}`;
    this._active = true;
  }

  _applyRole(game, r, vehicleId, name, isLocal) {
    game.scene.remove(r.mesh);
    r.vehicle = VEHICLES[vehicleId] || VEHICLES.prism;
    r.mesh = buildVehicleMesh(r.vehicle); // humans get no AI cone marker
    game.scene.add(r.mesh);
    r.callsign = (name || 'PILOT').slice(0, 16).toUpperCase();
    r.isPlayer = isLocal;
    r.netRemote = !isLocal;
    r.__bot = false;
    r.skill = 1;
    game.placeOnGrid(r, r.slot, game.racers.length); // re-seat + sync mesh
  }

  // Early hook (after updateAI, before collisions) — drive remote karts by interp.
  netInterp(game, _dt) {
    const now = performance.now();
    for (const r of game.racers) {
      if (!r.netRemote) continue;
      const buf = this.interp.get(r.slot);
      if (buf) interpKart(r, buf, now);
      game.syncMesh(r);
    }
  }

  // H4 — broadcast own kart, host broadcasts bots + clock.
  update(game, _dt) {
    const now = performance.now();
    // dynamic host migration
    const host = this.net.isHost();
    if (host !== this._hostFlag) this._becomeHost(game, host);

    if (now - this.t.st > STATE_MS && game.player && !game.player.finished) {
      this.t.st = now;
      this.net.send('st', packKart(game.player));
    }
    if (host && now - this.t.bots > BOTS_MS) {
      this.t.bots = now;
      const list = [];
      for (const r of game.racers) if (r.__bot && !r.netRemote && r.slot !== this.mySlot) list.push(packKart(r));
      if (list.length) this.net.send('bots', { list });
    }
    if (host && now - this.t.sync > SYNC_MS) {
      this.t.sync = now;
      this.net.send('sync', { t: +game.raceTime.toFixed(2), order: game.ranking().map((r) => r.slot) });
      // silent-human watchdog → host adopts the slot as a bot
      for (const r of game.racers) {
        if (r.netRemote && !r.__bot && r.slot !== this.mySlot && !r.finished) {
          const seen = this.lastSeen.get(r.slot) || 0;
          if (now - seen > SILENT_MS) this._adoptSlot(game, r.slot);
        }
      }
    }
  }

  _becomeHost(game, host) {
    this._hostFlag = host;
    if (!host) return;
    // Newly host: adopt every bot slot (host now simulates them).
    for (const r of game.racers) if (r.__bot) r.netRemote = false;
  }

  _adoptSlot(game, slot) {
    const r = game.racers.find((x) => x.id && x.slot === slot);
    if (!r) return;
    r.__bot = true;
    r.netRemote = !this.net.isHost();
    r.callsign = r.callsign || `BOT-${slot}`;
    this.lastSeen.delete(slot);
  }

  // H7 — owned kart finished → broadcast its time.
  onRacerFinish(game, r) {
    if (r.netRemote) return; // remote finishes arrive as 'fin'
    this.net.send('fin', { s: r.slot, t: +(r.finishTime || game.raceTime).toFixed(2) });
    this.finishedSlots.add(r.slot);
  }

  // H8a — owner claims an item pad; broadcast the pad-down + rolled gadget.
  onItemPickup(game, r, pad) {
    if (r.netRemote) return;
    const idx = game.track.itemPads.indexOf(pad);
    this.net.send('pad', { p: idx, s: r.slot, it: r.item || 0 });
  }

  // H8b — broadcast a gadget's VISUAL outcome so remotes render the same FX.
  // v1 keeps this visual-only (EMP ring at a world point); cross-player stun
  // replay (mapping victim id→slot authoritatively) is a v2 refinement.
  onGadgetUse(game, racer, result) {
    if (racer.netRemote || !result || !result.events) return;
    const emp = result.events.find((e) => e.kind === 'emp' && e.at);
    if (emp) this.net.send('gad', { fx: 'emp', x: +emp.at.x.toFixed(1), y: +emp.at.y.toFixed(1), z: +emp.at.z.toFixed(1) });
  }

  hudExtra(game) {
    if (!this._hud) return;
    const humans = this.roster.length;
    this._hud.textContent = `◉ ONLINE · ROOM ${this.net.room || '—'} · ${humans}P${this.net.isHost() ? ' · HOST' : ''}`;
  }

  // H8d — end decider; host publishes authoritative results once the field is in.
  isOver(game) {
    const allIn = game.finishedOrder.length >= game.racers.length;
    const grace = game.player.finished && game.raceTime - game.player.finishTime > 20;
    if (this.net.isHost() && (allIn || grace) && !this._published) {
      this._published = true;
      this.net.send('results', { order: game.ranking().map((r) => ({ s: r.slot, t: +(r.finishTime || 0).toFixed(2) })) });
    }
    return allIn || grace || this._adopted;
  }

  ownsRacer(_game, r) {
    return !r.netRemote;
  }

  teardown(_game) {
    // clearRace() runs teardown at the START of startRace, before onRaceStart —
    // don't tear the net down then (would kill the room before the race begins).
    if (!this._active) return;
    this._active = false;
    try {
      if (this.net) {
        if (this.mySlot != null) this.net.send('bye', { s: this.mySlot });
        this.net.leave();
      }
    } catch (e) {}
    if (this._onLeave) {
      window.removeEventListener('pagehide', this._onLeave);
      window.removeEventListener('beforeunload', this._onLeave);
      this._onLeave = null;
    }
    document.getElementById('gr-net-hud')?.remove();
    this._hud = null;
  }

  // ── networking internals ──────────────────────────────────────────────────
  _wireNet(game) {
    this._onMsg = ({ from, t, d }) => this._recv(game, from, t, d);
    this.net.on('msg', this._onMsg);
    this._onLeave = () => {
      try {
        this.net.send('bye', { s: this.mySlot });
        this.net.leave();
      } catch (e) {}
    };
    window.addEventListener('pagehide', this._onLeave);
    window.addEventListener('beforeunload', this._onLeave);
  }

  _slot(game, s) {
    return game.racers.find((r) => r.slot === s);
  }

  _recv(game, from, t, d) {
    if (!d) return;
    const now = performance.now();
    if (t === 'st') {
      const r = this._slot(game, d.s);
      if (!r || !r.netRemote) return; // never let a packet drive a kart I own
      applyPacketAuthoritative(r, d);
      let buf = this.interp.get(d.s);
      if (!buf) this.interp.set(d.s, (buf = { a: null, b: null }));
      pushInterp(buf, d, now);
      this.lastSeen.set(d.s, now);
    } else if (t === 'bots') {
      if (this.net.isHost()) return; // I own the bots
      for (const p of d.list || []) {
        const r = this._slot(game, p.s);
        if (!r || !r.netRemote) continue;
        applyPacketAuthoritative(r, p);
        let buf = this.interp.get(p.s);
        if (!buf) this.interp.set(p.s, (buf = { a: null, b: null }));
        pushInterp(buf, p, now);
      }
    } else if (t === 'sync') {
      if (this.net.isHost()) return;
      if (typeof d.t === 'number' && Math.abs(game.raceTime - d.t) > 0.5) game.raceTime = d.t;
    } else if (t === 'fin') {
      const r = this._slot(game, d.s);
      if (r && !r.finished) {
        r.finished = true;
        r.finishTime = d.t;
        if (!game.finishedOrder.includes(r.id)) game.finishedOrder.push(r.id);
      }
    } else if (t === 'pad') {
      const pad = game.track.itemPads[d.p];
      if (pad && pad.alive) {
        pad.alive = false;
        pad.mesh.visible = false;
        pad.respawn = 6;
      }
      const r = this._slot(game, d.s);
      if (r && r.netRemote) r.item = d.it || null;
    } else if (t === 'gad') {
      this._replayGadget(game, d);
    } else if (t === 'results') {
      this._adopted = true;
      for (const o of d.order || []) {
        const r = this._slot(game, o.s);
        if (r && !r.finished) {
          r.finished = true;
          r.finishTime = o.t;
          if (!game.finishedOrder.includes(r.id)) game.finishedOrder.push(r.id);
        }
      }
    } else if (t === 'bye' || t === 'takeover') {
      if (typeof d.s === 'number' && d.s !== this.mySlot) this._adoptSlot(game, d.s);
    }
  }

  // Render a remote gadget's visual (v1: EMP ring). No authoritative stun here.
  _replayGadget(game, d) {
    if (d.fx === 'emp' && game.fx?.empRing) {
      game.fx.empRing({ x: d.x, y: d.y, z: d.z }, 0xff2bd6);
    }
  }

  _ensureHud() {
    let el = document.getElementById('gr-net-hud');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gr-net-hud';
      el.style.cssText =
        'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:9;pointer-events:none;' +
        'font-family:var(--font-mono,"Share Tech Mono",monospace);font-size:.6rem;letter-spacing:.14em;' +
        'color:#39ff88;text-shadow:0 0 8px rgba(57,255,136,.5);';
      (document.getElementById('hud') || document.body).appendChild(el);
    }
    this._hud = el;
  }
}

// ── Lobby overlay ────────────────────────────────────────────────────────────
const randCode = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
};

export function openOnlineLobby(game) {
  const net = new NetPlay(SUPABASE_URL, SUPABASE_ANON_KEY, 'grid-rush');
  const peers = new Map(); // peerId → { name, vehicleId }
  peers.set(net.id, { name: game.callsign || (game.els.callsign?.value || 'PILOT'), vehicleId: game.vehicleId, peer: net.id });
  let started = false;

  injectLobbyStyle();
  const ov = document.createElement('div');
  ov.id = 'gr-lobby';
  ov.className = 'gr-lobby';
  ov.innerHTML = `
    <div class="gr-lobby-box">
      <div class="gr-lobby-title">PLAY ONLINE</div>
      <div id="gr-lobby-status" class="gr-lobby-status">Finding a match…</div>
      <div id="gr-lobby-players" class="gr-lobby-players"></div>
      <div class="gr-lobby-row">
        <input id="gr-join-code" class="gr-lobby-input" maxlength="4" placeholder="CODE" autocomplete="off" />
        <button id="gr-join-btn" class="mode-btn ghost" type="button">JOIN</button>
      </div>
      <div class="gr-lobby-row">
        <button id="gr-create-btn" class="mode-btn ghost" type="button">CREATE ROOM</button>
        <button id="gr-start-btn" class="mode-btn" type="button" disabled>START GRID</button>
      </div>
      <button id="gr-lobby-close" class="mode-btn ghost" type="button">CANCEL</button>
    </div>`;
  (document.getElementById('app') || document.body).appendChild(ov);

  const $ = (id) => ov.querySelector('#' + id);
  const status = $('gr-lobby-status');
  const startBtn = $('gr-lobby-players') && $('gr-lobby-players');
  const setStatus = (s) => (status.textContent = s);

  function renderPlayers() {
    const rows = [...peers.values()].map((p, i) => `<div class="gr-lobby-player">${i === 0 ? '★ ' : ''}${(p.name || 'PILOT').toUpperCase()}</div>`).join('');
    $('gr-lobby-players').innerHTML = rows || '<div class="gr-lobby-player">…</div>';
    // host = lowest peer id; only host can start
    const iAmHost = net.isHost();
    $('gr-start-btn').disabled = !iAmHost || !net.room;
    $('gr-start-btn').textContent = iAmHost ? `START GRID · ${peers.size}P` : 'WAITING FOR HOST…';
  }

  function close() {
    try {
      if (!started) net.leave();
    } catch (e) {}
    ov.remove();
  }

  net.on('peer', () => renderPlayers());
  net.on('open', () => {
    setStatus(`Room ${net.room} · share the code`);
    net.send('hello', { name: peers.get(net.id).name, vehicleId: game.vehicleId, peer: net.id });
    renderPlayers();
  });
  net.on('msg', ({ from, t, d }) => {
    if (started) return;
    if (t === 'hello') {
      peers.set(from, { name: d.name, vehicleId: d.vehicleId, peer: from });
      // reply so the newcomer learns about us
      net.send('hello', { name: peers.get(net.id).name, vehicleId: game.vehicleId, peer: net.id });
      renderPlayers();
    } else if (t === 'start') {
      started = true;
      beginOnline(game, net, d.cfg, d.roster, ov);
    }
  });

  $('gr-lobby-close').addEventListener('click', close);
  $('gr-create-btn').addEventListener('click', async () => {
    setStatus('Creating room…');
    await net.joinRoom(randCode(), true);
  });
  $('gr-join-btn').addEventListener('click', async () => {
    const code = ($('gr-join-code').value || '').trim().toUpperCase();
    if (code.length < 3) return;
    setStatus(`Joining ${code}…`);
    await net.joinRoom(code, false);
  });
  $('gr-start-btn').addEventListener('click', () => {
    if (!net.isHost()) return;
    // Build roster: sort peers by id; assign slots 0..5 (host first).
    const ids = [...peers.keys()].sort((a, b) => (a === net.id ? -1 : b === net.id ? 1 : a < b ? -1 : 1));
    const roster = ids.slice(0, 6).map((pid, slot) => ({ peer: pid, slot, name: peers.get(pid).name, vehicleId: peers.get(pid).vehicleId }));
    const cfg = { seed: (Math.floor(Date.now() / 1000) % 2147483647) >>> 0, trackId: game.trackId };
    started = true;
    net.send('start', { cfg, roster });
    beginOnline(game, net, cfg, roster, ov);
  });

  // kick off quick-match; on timeout, fall back to create/join UI (already shown)
  net.quickMatch(8000).then((res) => {
    if (started) return;
    if (res) {
      setStatus(`Matched · room ${res.room}`);
      net.send('hello', { name: peers.get(net.id).name, vehicleId: game.vehicleId, peer: net.id });
      renderPlayers();
    } else {
      setStatus('No quick match — CREATE or JOIN a code');
    }
  });
}

function beginOnline(game, net, cfg, roster, overlay) {
  game.trackId = (cfg && cfg.trackId) || game.trackId;
  game.mode = new OnlineMode(net, roster, cfg);
  overlay?.remove();
  game.sfx?.resume?.();
  game.startRace();
}

function injectLobbyStyle() {
  if (document.getElementById('gr-lobby-style')) return;
  const s = document.createElement('style');
  s.id = 'gr-lobby-style';
  s.textContent = `
  .gr-lobby{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;
    background:#04000ccc;backdrop-filter:blur(4px);font-family:var(--font-mono,"Share Tech Mono",monospace);}
  .gr-lobby-box{width:min(400px,92vw);padding:1.4rem 1.5rem;background:var(--glass,rgba(8,4,22,.94));
    border:1px solid var(--cyan,#00f0ff);border-radius:14px;box-shadow:0 0 46px #00f0ff22;color:#e8f7ff;text-align:center;}
  .gr-lobby-title{font-family:var(--font-display,"Orbitron",sans-serif);font-weight:800;letter-spacing:.16em;
    color:var(--cyan,#00f0ff);margin-bottom:.5rem;}
  .gr-lobby-status{font-size:.72rem;letter-spacing:.06em;color:#ffe566;min-height:1.2em;margin-bottom:.7rem;}
  .gr-lobby-players{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.8rem;min-height:1.5em;}
  .gr-lobby-player{font-size:.72rem;letter-spacing:.1em;color:#c8dcff;}
  .gr-lobby-row{display:flex;gap:.5rem;margin-top:.5rem;}
  .gr-lobby-row .mode-btn{flex:1;}
  .gr-lobby-input{flex:1;padding:.6rem;background:#00000066;border:1px solid var(--stroke,rgba(0,240,255,.4));
    border-radius:6px;color:#fff;font-family:inherit;letter-spacing:.3em;text-align:center;text-transform:uppercase;}
  #gr-lobby-close{margin-top:.7rem;width:100%;}`;
  document.head.appendChild(s);
}
