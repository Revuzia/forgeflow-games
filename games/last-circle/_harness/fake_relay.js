// stand-in for the Last Circle relay (workers/last-circle-net) between the pages of ONE browser context: window.WebSocket is replaced for the
// relay's room URLs (/room/<new|CODE>?id=) by a socket over a BroadcastChannel that speaks the relay's wire (welcome / presence / err,
// {from, t, d}, a directed `to`, "ping" -> "pong", the owner hand-over to the longest-present player). Every other WebSocket is the real one.
// Every message a page sends or receives (except state / bots) is logged in window.__SQ_LOG__ as { dir, t, from, d, at }.
// Test hooks: window.__SQ_STATE__ = the JSON size of each OUTGOING 'state' payload; window.__SQ_REORDER__ = { every: n, holdMs: ms } holds every
// n-th INBOUND 'state' back holdMs (late, after newer ones).
(() => {
  if (window.__FAKE_RELAY__) return;
  window.__FAKE_RELAY__ = true;
  const RealWS = window.WebSocket;
  const LOG = () => (window.__SQ_LOG__ = window.__SQ_LOG__ || []);
  const note = (dir, p) => { try { const L = LOG(); if (L.length < 600 && p && p.t !== 'state' && p.t !== 'bots') L.push({ dir, t: p.t, from: p.from, d: JSON.parse(JSON.stringify(p.d === undefined ? null : p.d)), at: Math.round(performance.now()) }); } catch (e) {} };
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const live = new Set();
  function FakeRoom(url) {
    const self = this;
    const u = new URL(url, location.href);
    const m = u.pathname.match(/\/room\/([^/]+)$/);
    const want = m ? decodeURIComponent(m[1]).toUpperCase() : 'NEW';
    const id = u.searchParams.get('id') || ('x' + Math.random().toString(36).slice(2));
    this.url = url; this.readyState = 0; this.onmessage = null; this.onclose = null; this.onerror = null; this.onopen = null;
    const bc = new BroadcastChannel('fake-lc-relay');
    let room = null, owner = '', at = Date.now() + Math.random() / 1000, closed = false, joined = false;
    const members = new Map();                     // id -> joined at (this socket's view of the room)
    const deliver = (obj) => { if (closed) return; const data = typeof obj === 'string' ? obj : JSON.stringify(obj); setTimeout(() => { try { self.onmessage && self.onmessage({ data }); } catch (e) { console.error(e); } }, 0); };
    const ids = () => [...members.entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    const presence = () => deliver({ k: 'presence', ids: ids(), owner });
    const handOver = () => { if (!members.has(owner)) { const l = ids(); owner = l[0] || ''; } };
    const finish = (code) => {
      if (closed) return; closed = true; live.delete(self); self.readyState = 3;
      try { bc.postMessage({ k: 'leave', room, id }); bc.close(); } catch (e) {}
      if (room) note('out', { t: '_left', from: id, d: null });
      setTimeout(() => { try { self.onclose && self.onclose({ code, reason: '', wasClean: code === 1000 }); } catch (e) { console.error(e); } }, 0);
    };
    bc.onmessage = (ev) => {
      const x = ev.data;
      if (closed || !joined || !x || x.room !== room) return;
      if (x.k === 'who') { bc.postMessage({ k: 'here', room, id, at, owner }); return; }
      if (x.k === 'here' || x.k === 'join') {
        if (x.id === id) return;
        const isNew = !members.has(x.id);
        members.set(x.id, x.at);
        if (x.owner && !members.has(owner)) owner = x.owner;
        if (isNew && x.k === 'join') bc.postMessage({ k: 'here', room, id, at, owner });
        if (isNew) presence();
        return;
      }
      if (x.k === 'leave') { if (members.delete(x.id)) { handOver(); presence(); } return; }
      if (x.k === 'bc') {
        if (x.to && x.to !== id) return;
        const p = x.payload;
        const R = window.__SQ_REORDER__;
        if (p && p.t === 'state' && R && !x.__late) {
          R.n = (R.n || 0) + 1;
          if (R.n % R.every === 0) { R.held = (R.held || 0) + 1; const mm = Object.assign({}, x, { __late: true }); setTimeout(() => bc.onmessage({ data: mm }), R.holdMs); return; }
        }
        note('in', p);
        deliver({ from: p.from, t: p.t, d: p.d });
      }
    };
    const welcome = () => {
      members.set(id, at);
      handOver();
      joined = true;
      self.readyState = 1; live.add(self);
      bc.postMessage({ k: 'join', room, id, at, owner });
      deliver({ k: 'welcome', room, id, owner, ids: ids() });
    };
    setTimeout(() => {
      if (want === 'NEW') {
        room = ''; for (let i = 0; i < 4; i++) room += A[Math.floor(Math.random() * A.length)];
        owner = id; welcome(); return;
      }
      // join: ask who is in room `want`; nobody answers -> 4004 (no such room); 8 in it -> 4009
      room = want;
      const seen = new Map();
      const probe = (ev) => { const x = ev.data; if (x && x.k === 'here' && x.room === want && x.id !== id) { seen.set(x.id, x); } };
      bc.addEventListener('message', probe);
      bc.postMessage({ k: 'who', room: want });
      setTimeout(() => {
        bc.removeEventListener('message', probe);
        if (closed) return;
        const others = [...seen.values()].filter((x) => x.id !== id);
        if (!others.length) { deliver({ k: 'err', code: 4004 }); room = null; finish(4004); return; }
        if (others.length >= 8) { deliver({ k: 'err', code: 4009 }); room = null; finish(4009); return; }
        for (const x of others) members.set(x.id, x.at);
        const o = others.find((x) => x.owner && seen.has(x.owner)) || others.find((x) => x.owner === x.id);
        owner = o ? o.owner : '';
        welcome();
      }, 350);
    }, 5);
    this.send = (text) => {
      if (closed || self.readyState !== 1) return;
      if (text === 'ping') { deliver('pong'); return; }
      let msg; try { msg = JSON.parse(text); } catch (e) { return; }
      const payload = { t: msg.t, from: id, d: msg.d };
      note('out', payload);
      try { if (payload.t === 'state') { const S = window.__SQ_STATE__ = window.__SQ_STATE__ || []; S.push(JSON.stringify(payload).length); if (S.length > 600) S.shift(); } } catch (e) {}
      bc.postMessage({ k: 'bc', room, to: typeof msg.to === 'string' ? msg.to : null, payload });
    };
    this.close = (code) => finish(code || 1000);
    this.addEventListener = () => {}; this.removeEventListener = () => {};
  }
  window.addEventListener('pagehide', () => { for (const s of [...live]) { try { s.close(1001); } catch (e) {} } });
  function WS(url, proto) {
    const s = String(url);
    if (/\/room\/[^/?]+\?/.test(s) && /[?&]id=/.test(s)) return new FakeRoom(s);
    return proto === undefined ? new RealWS(url) : new RealWS(url, proto);
  }
  WS.CONNECTING = 0; WS.OPEN = 1; WS.CLOSING = 2; WS.CLOSED = 3; WS.prototype = RealWS.prototype;
  window.WebSocket = WS;
})();
