// Scripted solutions for l02 "Cold Shoulder".

const landed = (s, p) => p.grounded;

/** 1. The Rink: freeze, steer round two kerbs, over the heavy plate (the shutter lifts), through the shutter and the glass. */
function rink(r, shard) {
  r.walkTo(3, -0.8, { tol: 0.6, slow: false }).form('ice')
    .expect((s) => s.checkpoint !== null, 'first checkpoint lit')
    .walkTo(6.5, 3.2, { tol: 0.8, slow: false })
    .walkTo(11, 3.2, { tol: 0.8, slow: false })
    .walkTo(11.6, -3.2, { tol: 0.8, slow: false })
    .walkTo(15.5, -3.2, { tol: 0.5 }).stop()
    .walkTo(18.5, 0, { tol: 0.3 })
    .expectSignal('p0', true)
    .walkTo(31, 0, { tol: 0.8, slow: false })
    .expect((s) => s.level.doors[0].open >= 1, 'the rink shutter is up')
    .waitUntil((s) => s.level.panes[0].broken, { mx: 1, timeout: 4, label: 'first pane smashed' })
    .walkTo(38, 0, { tol: 0.4 });
  if (shard) {
    r.stop().form('liquid').walkTo(34.4, -3.8).jumpTo(36.2, -4).expectShards(1)
      .walkTo(37.8, -2.2).waitUntil(landed, { timeout: 2 }).walkTo(38.6, 0).form('ice');
  }
  r.stop();
}

/** 2. The Crate Gallery: the crate shoved south, then east onto the heavy plate; it holds door A open. */
function crateGallery(r) {
  r.walkTo(42, -0.8, { tol: 0.6 })
    .walkTo(46, -4.3, { tol: 0.25 }).stop()                  // line up behind the crate
    .waitUntil((s) => s.level.crates[0].body.z >= 2.55, { mz: 1, timeout: 12, label: 'crate pushed south' })
    .stop()
    .walkTo(43.8, 2.6, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.x >= 55.9, { mx: 1, timeout: 12, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('hp1', true)
    .form('liquid');
}

/** 3. The Chute: door A held by the crate, up the ramp to the deck, freeze, slide through the glass, melt on the hot tiles. */
function chute(r) {
  r.walkTo(61.5, 0)
    .expect((s) => s.level.doors.find((d) => d.id === 'doorA').open >= 1, 'door A held open by the crate')
    .walkTo(66, -0.8).walkTo(71, 0).walkTo(76, 0, { y: 3 })
    .expect((s) => s.checkpoint !== null, 'deck checkpoint lit')
    .walkTo(78.5, 0).form('ice')
    .waitUntil((s) => s.level.panes.find((p) => p.id === 'pane2').broken, { mx: 1, timeout: 8, label: 'second pane smashed' })
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 4, label: 'melted on the hot tiles' })
    .walkTo(102.5, -0.8);
}

/** 4. The Double Weight: one crate along the north lane, then ice through the cracked glass to shove the second. */
function doubleWeight(r) {
  r.form('ice')
    .walkTo(103.4, -3.4, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates.find((c) => c.id === 'crate2').body.x >= 114.9, { mx: 1, timeout: 14, label: 'crate pushed onto plate A' })
    .stop()
    .expectSignal('hpA', true).expectSignal('bothWeights', false)
    .walkTo(101.4, 3.5, { tol: 0.3 }).stop()
    .waitUntil((s) => s.level.panes.find((p) => p.id === 'pane3').broken, { toward: [112, 3.5], timeout: 6, label: 'third pane smashed' })
    .waitUntil((s) => s.level.crates.find((c) => c.id === 'crate3').body.x >= 121.9, { toward: [131, 3.5], timeout: 14, label: 'crate pushed onto plate B' })
    .stop()
    .expectSignal('hpB', true).expectSignal('bothWeights', true)
    .form('liquid')
    .walkTo(126, 0)
    .waitUntil((s) => s.level.doors.find((d) => d.id === 'doorW').open >= 1, { timeout: 3, label: 'shutter up' })
    .walkTo(131, -0.8);
}

/** 5. The Locked Kiln: film under the low wall, ice on the heavy plate, film back out, to the unlocked kiln door. */
function lockedKiln(r, shard) {
  r.expect((s) => !s.level.exits[0].open, 'exit starts locked')
    .walkTo(150.2, 0).form('film').walkTo(154.4, 0).form('ice')
    .waitUntil((s) => s.signals.get('exitOpen'), { toward: [156.2, 0], timeout: 6, label: 'heavy plate pressed' })
    .stop();
  if (shard) {
    r.form('liquid').walkTo(154.6, 2.7).jumpTo(154.7, 4.2).jumpTo(156.1, 4.2).expectShards(3)
      .walkTo(156.2, 2.2, { tol: 0.3 }).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2, label: 'back on the floor' });
  }
  r.form('film').walkTo(150.2, 0).form('liquid')
    .expect((s) => s.level.exits[0].open, 'exit stays unlocked (latched)')
    .walkTo(133.4, -3.6).expectExit();
}

export function solve(r) {
  rink(r, false);
  crateGallery(r);
  chute(r);
  doubleWeight(r);
  lockedKiln(r, false);
}

export function solveAll(r) {
  rink(r, true);
  crateGallery(r);
  // shard 2 floats above the plate: only reachable from on top of the crate
  r.walkTo(54.4, 2.6).jumpTo(56, 2.6)
    .expect((s, p) => p.y > 1, 'standing on the crate')
    .jump(0.6).waitUntil(landed, { timeout: 2 }).expectShards(2)
    .walkTo(56, 0.6, { tol: 0.3 }).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2 });
  chute(r);
  doubleWeight(r);
  lockedKiln(r, true);
}
