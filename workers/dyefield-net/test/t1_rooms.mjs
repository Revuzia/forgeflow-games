// T1: create / join / code collision retry / 9th = room_full / bad code = 4004 (+ malformed code = 400).
import * as L from './lib.mjs';

export async function run(dev, C) {
  // create
  const own = await L.createRoom(dev, { i: 0 });
  C.ok(/^[A-HJ-NP-Z2-9]{4}$/.test(own.code), 'create: 4-character code from the room alphabet', own.code);
  C.eq([own.welcome.slot, own.welcome.room.ownerSlot, own.welcome.room.phase, own.welcome.room.quick], [0, 0, 'room', false], 'create: slot 0, owner, phase room, code room');
  C.ok(/^[0-9a-f]{32}$/.test(own.welcome.token), 'create: 128-bit reconnect token');

  // join (lower-case typed code is case-folded)
  const m0 = own.c.mark();
  const j1 = await L.joinRoom(dev, own.code.toLowerCase(), { i: 1 });
  C.eq([j1.welcome?.t, j1.welcome?.slot, j1.welcome?.room?.code], ['welcome', 1, own.code], 'join by code (lower-case accepted): slot 1');
  const mem = await own.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.members.length === 2, { from: m0, what: 'members x2' });
  C.ok(
    mem.j.members[0].owner === true && mem.j.members[1].owner === false && mem.j.members[1].name === 'P1',
    'members broadcast: 2 members, owner flag, names',
    mem.j.members,
  );

  // fill to 8, then the 9th is refused
  const joiners = [j1];
  for (let i = 2; i < 8; i++) joiners.push(await L.joinRoom(dev, own.code, { i }));
  C.eq(joiners.map((j) => j.welcome?.slot), [1, 2, 3, 4, 5, 6, 7], 'slots 0..7 in join order');
  const ninth = await L.joinRoom(dev, own.code, { i: 8, doHello: false });
  const err9 = await ninth.c.t('err', { failOnClose: false }).catch(() => null);
  const cl9 = await ninth.c.closed;
  C.eq([err9?.j?.code, cl9.code], ['room_full', 4009], '9th player: err room_full + close 4009');

  // a freed slot number is reused, with a new jid (tells a new player from a reconnect)
  joiners[2].c.send({ t: 'leave' });
  await joiners[2].c.closed;
  await L.sleep(150);
  const again = await L.joinRoom(dev, own.code, { i: 9 });
  C.ok(again.welcome?.slot === 3 && again.welcome?.jid !== joiners[2].welcome.jid, 'after a leave, the lowest free slot is reused with a new jid', {
    slot: again.welcome?.slot,
    jid: again.welcome?.jid,
    oldJid: joiners[2].welcome.jid,
  });

  // well-formed code that was never claimed → err not_found, close 4004
  let nf = 'ZZZZ';
  if (nf === own.code) nf = 'YYYY';
  const bad = await L.joinRoom(dev, nf, { i: 20, doHello: false });
  const errNf = await bad.c.t('err', { failOnClose: false }).catch(() => null);
  const clNf = await bad.c.closed;
  C.eq([errNf?.j?.code, clNf.code], ['not_found', 4004], 'unclaimed code: err not_found + close 4004');

  // malformed codes → HTTP 400 before any DO
  const s1 = await L.rawUpgrade(`${dev.ws}/room/AB1?build=${L.enc(L.BUILD)}`, { Origin: L.ORIGIN_OK });
  const s2 = await L.rawUpgrade(`${dev.ws}/room/0OIL?build=${L.enc(L.BUILD)}`, { Origin: L.ORIGIN_OK });
  C.eq([s1, s2], [400, 400], 'malformed code (length / ambiguous characters 0 O I L) → 400');

  // build mismatch → err build, 4026
  const wb = await L.joinRoom(dev, own.code, { i: 21, build: 'dyefield-1.3.9+p1+other', doHello: false });
  const errB = await wb.c.t('err', { failOnClose: false }).catch(() => null);
  const clB = await wb.c.closed;
  C.eq([errB?.j?.code, clB.code], ['build', 4026], 'another build: err build + close 4026');

  // proto mismatch in hello → err proto, 4026 (room has a free seat? it is full: leave one first)
  joiners[3].c.send({ t: 'leave' });
  await joiners[3].c.closed;
  const wp = await L.joinRoom(dev, own.code, { i: 22, doHello: false });
  wp.c.send({ t: 'hello', proto: 99, build: L.BUILD, name: 'x' });
  const errP = await wp.c.t('err', { failOnClose: false }).catch(() => null);
  const clP = await wp.c.closed;
  C.eq([errP?.j?.code, clP.code], ['proto', 4026], 'hello with another proto: err proto + close 4026');

  // collision retry (DEV-only `devcode` list): ABCD taken → the Worker retries with the next code
  const a = new L.Client(`${dev.ws}/room/new?mode=teams&rule=turf&build=${L.enc(L.BUILD)}&devcode=ABCD`, { label: 'cA' });
  await a.opened;
  const wa = await L.hello(a, L.profile(30));
  const b = new L.Client(`${dev.ws}/room/new?mode=teams&rule=turf&build=${L.enc(L.BUILD)}&devcode=ABCD,ABCE`, { label: 'cB' });
  await b.opened;
  const wbb = await L.hello(b, L.profile(31));
  C.eq([wa.room?.code, wbb.room?.code, wbb.slot, wbb.room?.ownerSlot], ['ABCD', 'ABCE', 0, 0], 'code collision: second create retried onto the next code and owns it');
  const c3 = new L.Client(`${dev.ws}/room/new?mode=teams&rule=turf&build=${L.enc(L.BUILD)}&devcode=ABCD,ABCD,ABCE`, { label: 'cC' });
  await c3.opened;
  const errBusy = await c3.t('err', { failOnClose: false }).catch(() => null);
  const clBusy = await c3.closed;
  C.eq([errBusy?.j?.code, clBusy.code], ['busy', 1013], 'three collisions in a row: err busy + close 1013');

  // cfg from the owner (code room) changes the room and is rebroadcast; a non-owner's cfg is ignored
  const mk = own.c.mark();
  own.c.send({ t: 'cfg', mode: 'ffa', rule: 'washout', map: 'cinder', preset: 'golden', skill: 'storm' });
  const cfgM = await own.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.room?.map === 'cinder', { from: mk, what: 'members after cfg' });
  C.eq([cfgM.j.room.mode, cfgM.j.room.rule, cfgM.j.room.preset, cfgM.j.room.skill], ['ffa', 'washout', 'golden', 'storm'], 'owner cfg applied and rebroadcast');
  joiners[0].c.send({ t: 'cfg', map: 'pier18' });
  await L.sleep(300);
  const dbg = await L.devRoom(dev, own.code);
  C.eq(dbg.st.map, 'cinder', 'non-owner cfg ignored');

  // name sanitizing (§O8): control + bidi stripped, ≤ 16 code points, empty → GUEST-xxxx
  const mk2 = own.c.mark();
  joiners[0].c.send({ t: 'set', name: ' ‮abc\u0007def‏ ghijklmnopqrstuvwxyz' });
  const nm = await own.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && m.j.members.some((x) => x.slot === 1 && x.name !== 'P1'), { from: mk2, what: 'renamed' });
  C.eq(nm.j.members.find((x) => x.slot === 1).name, 'abcdef ghijklmno', 'name sanitized (bidi/control stripped, 16 code points)');
  const mk3 = own.c.mark();
  joiners[0].c.send({ t: 'set', name: '‎‏  ' });
  const nm2 = await own.c.next((m) => m.kind === 'text' && m.j?.t === 'members' && /^GUEST-[A-Z2-9]{4}$/.test(m.j.members.find((x) => x.slot === 1)?.name ?? ''), { from: mk3, what: 'guest name' });
  C.ok(!!nm2, 'empty name → GUEST-xxxx');

  L.closeAll([own, again, ...joiners, { c: a }, { c: b }]);
  await L.sleep(300);
}
