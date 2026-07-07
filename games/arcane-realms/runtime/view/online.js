// Arcane Realms — online match handshake on top of the NetPlay relay.
// Lockstep model: both clients exchange decks, the HOST picks the seed, both
// build the IDENTICAL deterministic engine state locally (host = player 0,
// guest = player 1), then every applied action is broadcast and replayed by
// the other side (see Match.pumpRemote). A post-action state hash catches
// desyncs and triggers a host-authoritative resync.

import { NetPlay } from '../net/netplay.js?v=4';

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function friendlyCode(n = 4) {
  let s = '';
  for (let i = 0; i < n; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export class OnlineSession {
  constructor({ onStatus } = {}) {
    this.net = new NetPlay();
    this.onStatus = onStatus || (() => {});
    this.cancelled = false;
  }

  status(s) { try { this.onStatus(s); } catch { /* ui gone */ } }

  cancel() {
    this.cancelled = true;
    try { this.net.leave(); } catch { /* closed */ }
  }

  // mode: 'quick' | 'create' | 'join'
  // profile: { deck: [cardIds], hero, name }
  // resolves { net, mySide, sharedState-inputs } or throws
  async start(mode, code, profile) {
    const net = this.net;
    this.status('Connecting…');
    await net.connect();
    if (this.cancelled) throw new Error('cancelled');

    if (mode === 'quick') {
      this.status('Searching for an opponent…');
      const res = await net.quickMatch(120000);
      if (this.cancelled) throw new Error('cancelled');
      if (!res) throw new Error('No opponent found — try again or share a room code.');
      this.status('Opponent found! Preparing the table…');
    } else if (mode === 'create') {
      const room = code || friendlyCode();
      this.status(`Room ${room} — waiting for a challenger…`);
      await net.joinRoom(room, true);
      this.statusRoom = room;
    } else {
      this.status(`Joining room ${code}…`);
      await net.joinRoom(code, false);
    }

    // wait for both players present
    await new Promise((res, rej) => {
      if (net.peerPresent) return res();
      const t = setTimeout(() => rej(new Error(mode === 'join' ? 'Room is empty — check the code.' : 'No challenger arrived (5 min). Try Quick Match!')), 300000);
      net.on('peer', ({ present }) => { if (present) { clearTimeout(t); res(); } });
      const iv = setInterval(() => {
        if (this.cancelled) { clearTimeout(t); clearInterval(iv); rej(new Error('cancelled')); }
        if (net.peerPresent) { clearTimeout(t); clearInterval(iv); res(); }
      }, 400);
    });
    if (this.cancelled) throw new Error('cancelled');
    this.status('Opponent connected — exchanging decks…');

    // ── handshake ──
    // Host role is decided INSIDE the hello exchange by comparing NetPlay peer
    // ids (lower id hosts). Symmetric and race-free — it never depends on
    // channel-presence timing, which proved flaky. Every message retries until
    // acknowledged because broadcasts are fire-and-forget.
    let amHost = null;          // decided on first remote hello
    let remoteHello = null;
    let startParams = null;
    let gotAck = false;
    const helloMsg = { nid: net.id, deck: profile.deck, hero: profile.hero, name: profile.name || 'Duelist', cardback: profile.cardback || 'default' };

    const done = new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Handshake timed out.')), 45000);
      let resolved = false;
      const LOG = (window.__ARC_MP = window.__ARC_MP || []);
      const finish = () => { if (!resolved) { resolved = true; clearTimeout(t); LOG.push('resolve'); res(); } };
      const sendStartLoop = () => {
        if (gotAck || resolved || this.cancelled) return;
        LOG.push('tx:start');
        net.send('start', startParams);
        setTimeout(sendStartLoop, 1000);
      };
      net.on('msg', ({ t: type, d }) => {
        try {
          LOG.push('rx:' + type);
          if (type === 'hello') {
            if (d.nid === net.id) return; // paranoid self-echo guard
            if (!remoteHello) {
              remoteHello = d;
              amHost = String(net.id) < String(d.nid || '~');
              LOG.push(amHost ? 'role:host' : 'role:guest');
              if (amHost && !startParams) {
                startParams = {
                  seed: (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) % 2147483647,
                  hostNid: net.id,
                  decks: [helloMsg.deck, remoteHello.deck],
                  heroes: [helloMsg.hero, remoteHello.hero],
                  names: [helloMsg.name, remoteHello.name],
                  backs: [helloMsg.cardback, remoteHello.cardback || 'default'],
                };
                LOG.push('built-start');
                sendStartLoop();
              }
            }
          } else if (type === 'start' && amHost !== true) {
            amHost = false;
            if (!startParams) startParams = d;
            net.send('startAck', {}); // idempotent — answer every retry
            finish();
          } else if (type === 'startAck' && amHost === true) {
            gotAck = true;
            finish();
          }
        } catch (err) {
          LOG.push('HANDLER-ERR: ' + (err && err.message));
          console.error('[arc-mp] handshake handler error', err);
        }
      });
      // hello keeps broadcasting until the handshake RESOLVES — covers every
      // ordering of join/attach timing on both sides
      let tries = 0;
      const sendHello = () => {
        if (resolved || this.cancelled) return;
        net.send('hello', helloMsg);
        if (++tries < 40) setTimeout(sendHello, 1100);
      };
      sendHello();
    });
    await done;
    if (this.cancelled) throw new Error('cancelled');
    const mySide = amHost ? 0 : 1;
    this.status('Duel starting!');
    return { net, mySide, params: startParams };
  }
}
