// Protocol test against a running `wrangler dev --local --port 8791` (npm run dev in another shell).
//   node test/rooms.mjs [baseUrl]
// Covers: start room -> code; join by code; presence; relay + directed `to`; typo code (4004); room full (4009);
// origin refused (403); rejoin with the same id; meter counts; meter full -> new rooms refused (4029), joins still work.
const BASE = (process.argv[2] || 'http://127.0.0.1:8791').replace(/\/$/, '');
const WS = BASE.replace(/^http/, 'ws');
const ORIGIN = 'http://localhost:5173';
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(path, id, origin = ORIGIN) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS + path + (path.includes('?') ? '&' : '?') + 'id=' + id, { headers: { Origin: origin } });
    const c = { ws, id, msgs: [], closed: null, welcome: null, presence: null };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.k === 'welcome') { c.welcome = m; resolve(c); }
      else if (m.k === 'presence') c.presence = m;
      else if (m.k === 'err') c.err = m;
      else c.msgs.push(m);
    };
    ws.onclose = (e) => { c.closed = e.code; resolve(c); };
    ws.onerror = () => { c.error = true; setTimeout(() => resolve(c), 300); };
  });
}

const h0 = await (await fetch(BASE + '/__dev/meter/set?msgs=0&conns=0')).json();
ok(h0.open, 'meter reset, open');

const host = await open('/room/new', 'hostAAAA');
ok(host.welcome && /^[A-Z2-9]{4}$/.test(host.welcome.room), 'start room -> code ' + (host.welcome && host.welcome.room));
ok(host.welcome && host.welcome.owner === 'hostAAAA', 'creator is owner');
const code = host.welcome.room;

const g1 = await open('/room/' + code.toLowerCase(), 'guestBBBB');
ok(g1.welcome && g1.welcome.ids.length === 2 && g1.welcome.owner === 'hostAAAA', 'join by code (lowercase) sees host + self');
await sleep(150);
ok(host.presence && host.presence.ids.includes('guestBBBB'), 'host gets presence for the guest');

g1.ws.send(JSON.stringify({ t: 'hello', d: { name: 'Bee' } }));
host.ws.send(JSON.stringify({ t: 'start', d: { seed: 7 } }));
await sleep(150);
ok(host.msgs.some((m) => m.t === 'hello' && m.from === 'guestBBBB' && m.d.name === 'Bee'), 'relay guest -> host with from');
ok(g1.msgs.some((m) => m.t === 'start' && m.from === 'hostAAAA' && m.d.seed === 7), 'relay host -> guest');
ok(!host.msgs.some((m) => m.t === 'start'), 'sender does not get its own message');

const g2 = await open('/room/' + code, 'guestCCCC');
g2.ws.send(JSON.stringify({ t: 'rtc', to: 'guestBBBB', d: { to: 'guestBBBB', kind: 'offer' } }));
await sleep(150);
ok(g1.msgs.some((m) => m.t === 'rtc'), 'directed message reaches the addressee');
ok(!host.msgs.some((m) => m.t === 'rtc'), 'directed message skips others');

const typo = await open('/room/ZZZZ', 'guestDDDD');
ok(typo.closed === 4004, 'unknown code -> 4004 (got ' + typo.closed + ')');

const bad = await open('/room/' + code, 'guestEEEE', 'https://evil.example');
ok((bad.closed !== null || bad.error) && !bad.welcome, 'foreign origin refused (handshake 403)');

// fill to MAX_SOCKETS (8)
const extra = [];
for (let i = 0; i < 5; i++) extra.push(await open('/room/' + code, 'fillr' + i + 'XX'));
ok(extra.every((c) => c.welcome), 'room takes 8');
const ninth = await open('/room/' + code, 'ninthXXXX');
ok(ninth.closed === 4009, '9th -> 4009 (got ' + ninth.closed + ')');
extra.forEach((c) => c.ws.close());

// rejoin with the same id replaces the old socket
const g1b = await open('/room/' + code, 'guestBBBB');
await sleep(200);
ok(g1b.welcome && g1.closed === 4001, 'rejoin with the same id replaces the old socket (old closed ' + g1.closed + ')');
ok(g1b.welcome.ids.filter((x) => x === 'guestBBBB').length === 1, 'no duplicate id after rejoin');

// guest leaves -> presence update
g2.ws.close();
await sleep(200);
ok(host.presence && !host.presence.ids.includes('guestCCCC'), 'leave -> presence drops the id');

// meter: close everyone so the room flushes
host.ws.close(); g1b.ws.close();
await sleep(400);
const st = await (await fetch(BASE + '/health')).json();
ok(st.ok && st.msgs >= 3 && st.conns >= 9, 'meter counted msgs=' + st.msgs + ' conns=' + st.conns);

// meter full: new rooms refused, health says closed
await fetch(BASE + '/__dev/meter/set?msgs=0&conns=999999');
const refused = await open('/room/new', 'hostZZZZ');
ok(refused.closed === 4029, 'meter full -> new room 4029 (got ' + refused.closed + ')');
await fetch(BASE + '/__dev/meter/set?msgs=0&conns=0');
const again = await open('/room/new', 'hostZZZZ');
ok(!!again.welcome, 'meter reset -> rooms open again');
again.ws.close();

// host hand-over: host LEAVES (close 1000) -> the longest-present player becomes owner
const h2 = await open('/room/new', 'hostHHHH');
const c2 = h2.welcome.room;
const p1 = await open('/room/' + c2, 'firstPPPP');
await sleep(50);
const p2 = await open('/room/' + c2, 'secondPPP');
h2.ws.close(1000, 'leave');
await sleep(300);
ok(p1.presence && p1.presence.owner === 'firstPPPP' && p2.presence.owner === 'firstPPPP', 'host left -> longest-present player is host (' + (p1.presence && p1.presence.owner) + ')');
// a host whose connection merely drops keeps the room through the grace period
const h3 = await open('/room/new', 'hostJJJJ');
const c3 = h3.welcome.room;
const q1 = await open('/room/' + c3, 'guestQQQQ');
h3.ws.close(4100, 'drop');      // not 1000: a drop
await sleep(300);
ok(q1.presence && q1.presence.owner === 'hostJJJJ', 'host drop -> still host during the grace period');
const h3b = await open('/room/' + c3, 'hostJJJJ');
ok(h3b.welcome && h3b.welcome.owner === 'hostJJJJ', 'host rejoins within grace -> keeps the room');
[p1, p2, q1, h3b].forEach((c) => c.ws.close());

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
