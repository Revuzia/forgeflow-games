// Scripted solutions for f03 "Kindling" (Fire). Five rooms, each opened by a brazier.
// solve() is the plain route; solveAll() also takes the three glow-stones (the boarded nook, under
// the pier of the first pool, the high ledge before the kiln).

const by = (list, id) => list.find((q) => q.id === id);
const wood = (s, id) => by(s.level.woods, id);
const pileGone = (s, id) => s.level.woods.filter((w) => w.id.startsWith(id)).every((w) => w.state === 2);
const landed = (s, p) => p.grounded;

/** Become `form` if Cinder is not that form already (pressing the same button again would be a special). */
function be(r, form) { if (r.p.form !== form) r.form(form); return r; }

/** Jump toward +x as a blaze and flare at the top of the arc (the special), landing on the far side. */
function flareJump(r, fromX, mz = 0) {
  return r.waitUntil((s, p) => p.x >= fromX, { mx: 1, mz, timeout: 4, label: 'run-up' })
    .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { mx: 1, mz, jump: true, timeout: 2, label: 'top of the jump' })
    .special({ mx: 1, mz, jump: true })
    .waitUntil(landed, { mx: 1, mz, timeout: 4, label: 'lands' });
}

function tinderStore(r, stone) {
  r.walkTo(3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  if (stone) {
    // glow-stone 1: burn the boards across the nook
    r.walkTo(6.5, 1.0).form('blaze')
      .waitUntil((s) => wood(s, 'nook').state > 0, { toward: [6.5, 1.75], timeout: 2, label: 'nook boards alight' })
      .waitUntil((s) => wood(s, 'nook').state === 2, { timeout: 3, label: 'nook open' })
      .form('ember').walkTo(6.5, 3.5).expectShards(1).walkTo(6.5, 1.2);
  }
  r.walkTo(14.4, 0);
  be(r, 'blaze')
    .waitUntil((s) => wood(s, 'barricade').state === 1, { toward: [16, 0], timeout: 2, label: 'the planks have caught' })
    .waitUntil((s) => wood(s, 'barricade').state === 2, { timeout: 3, label: 'planks burnt away' })
    .walkTo(19, 0)
    .walkTo(24, -2.2).expect((s) => s.level.coals[0].taken || s.player.gauge >= 9.99, 'coal picked up or gauge full')
    .walkTo(34.8, 0)
    .waitUntil((s) => wood(s, 'pile00').state > 0 || wood(s, 'pile10').state > 0, { toward: [36, 0], timeout: 3, label: 'the stack has caught' })
    .waitUntil((s) => pileGone(s, 'pile'), { timeout: 8, label: 'the stack has burnt through' })
    .walkTo(41, 0).expect((s) => s.deaths === 0, 'through the store');
}

function rafterHall(r) {
  r.walkTo(50, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier')
    .walkTo(55.4, 0);
  be(r, 'ember').walkTo(59.4, 0);                                         // under the first beam
  r.walkTo(66.6, 0);
  be(r, 'blaze')
    .waitUntil((s) => wood(s, 'planks2').state === 2, { toward: [68, 0], timeout: 4, label: 'the second planks burnt' })
    .walkTo(72.4, 0).walkTo(75.4, 0);
  be(r, 'ember').walkTo(79.4, 0);                                         // under the second beam
  r.walkTo(86.6, 0);
  be(r, 'blaze')
    .waitUntil((s) => wood(s, 'planks3').state === 2, { toward: [88, 0], timeout: 4, label: 'the third planks burnt' })
    .walkTo(91.6, 0);
  be(r, 'ember').walkTo(93.4, 0)
    .walkTo(105.2, 0).expect((s) => s.deaths === 0 && wood(s, 'walk1').state === 0, 'over the catwalk, unburnt');   // through the slot and along the planks
}

function ropeBridge(r, stone) {
  r.walkTo(107.5, 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier')
    .walkTo(116.2, 1.8);
  be(r, 'blaze')
    .waitUntil((s) => wood(s, 'rope1').state > 0, { toward: [116.7, 2.1], timeout: 2, label: 'rope alight' })
    .waitUntil((s) => by(s.level.movers, 'bridge1').t >= 1, { timeout: 4, label: 'bridge down' });
  be(r, 'ember').walkTo(119, 0).walkTo(127.6, 0).walkTo(129.5, 1.5).expect((s) => s.checkpoint.id === 'b3b', 'landing brazier')
    .walkTo(127.8, -2.6).jumpTo(130.2, -2.6, { tol: 0.4 }).walkTo(130.8, -2.6);   // up on the ledge
  be(r, 'blaze')
    .waitUntil((s) => wood(s, 'rope2').state > 0, { toward: [131.1, -2.6], timeout: 2, label: 'second rope alight' })
    .waitUntil((s) => by(s.level.movers, 'bridge2').t >= 1, { timeout: 4, label: 'second bridge down' });
  be(r, 'ember').walkTo(132.4, -1.0).walkTo(134, 0).walkTo(142.6, 0).walkTo(145, 0);
}

function boilBasin(r, stone) {
  r.walkTo(150, 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier')
    .walkTo(155, -2.2).walkTo(159.5, 0);
  be(r, 'blaze')
    .expect((s) => by(s.level.pools, 'pool1').wet, 'the pool is full')
    .waitUntil((s) => !by(s.level.pools, 'pool1').wet, { mx: 1, timeout: 2, label: 'pool boiled' });
  if (stone) {
    r.walkTo(165.25, 1.5, { slow: false }).form('ember')                  // into the dry basin, down to a coal, under the pier
      .walkTo(165.25, 2.9, { slow: false }).expectShards(2)
      .walkTo(165.25, 1.5, { slow: false }).walkTo(167.3, 0.6, { slow: false })
      .jumpTo(168.9, 0.4);
  } else {
    r.walkTo(167.3, 0, { slow: false }).jumpTo(168.9, 0);
  }
  r.expect((s, p) => p.x > 168 && s.deaths === 0 && Math.abs(p.y) < 1e-6, 'out of the basin before the water came back')
    .walkTo(171, 0).expect((s) => s.checkpoint.id === 'b4b', 'fourth brazier, halfway')
    .walkTo(174, -2.2).walkTo(176.8, 0);
  be(r, 'blaze')
    .waitUntil((s) => !by(s.level.pools, 'pool2').wet, { mx: 1, timeout: 2, label: 'the wide pool boiled' })
    .walkTo(187.4, 0, { slow: false }).jumpTo(189.6, 0)
    .expect((s, p) => p.x > 189 && s.deaths === 0 && Math.abs(p.y) < 1e-6, 'across the wide pool');
}

function flareGap(r) {
  r.walkTo(198, 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  be(r, 'blaze').walkTo(203.2, 0);
  flareJump(r, 205.55);
  r.expect((s, p) => p.x > 211.8 && s.deaths === 0, 'across the gap on a flare')
    .walkTo(214, 0).expect((s) => s.checkpoint.id === 'b5b', 'sixth brazier');
}

function kiln(r) {
  be(r, 'blaze').walkTo(236.6, 0)
    .waitUntil((s) => s.level.woods.some((w) => w.id.startsWith('pyre') && w.state > 0), { toward: [238, 0], timeout: 3, label: 'the kindling has caught' })
    .waitUntil((s) => s.level.exits[0].open, { timeout: 10, label: 'the kiln knows a flame has come' })
    .waitUntil((s) => pileGone(s, 'pyre'), { timeout: 8, label: 'the kindling is gone' })
    .walkTo(242.6, 0).expectExit();
}

export function solve(r) {
  tinderStore(r, false);
  rafterHall(r);
  ropeBridge(r, false);
  boilBasin(r, false);
  flareGap(r);
  kiln(r);
}

export function solveAll(r) {
  tinderStore(r, true);
  rafterHall(r);
  ropeBridge(r, true);
  boilBasin(r, true);
  flareGap(r);
  // glow-stone 3: a jump and a flare onto the high ledge
  r.walkTo(215.9, -2.9);
  be(r, 'blaze')                                                           // (a blaze already, unless a brazier woke Cinder as a coal)
    .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { mx: 0.25, jump: true, timeout: 2, label: 'top of the jump' })
    .special({ mx: 1, jump: true })
    .waitUntil(landed, { toward: [218.25, -2.9], timeout: 4, label: 'on the ledge' })
    .expect((s, p) => Math.abs(p.y - 2.1) < 1e-6, 'standing on the high ledge')
    .walkTo(218.25, -2.9).expectShards(3)
    .walkTo(220.4, -1.2).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 3, label: 'floated down' });
  kiln(r);
}
