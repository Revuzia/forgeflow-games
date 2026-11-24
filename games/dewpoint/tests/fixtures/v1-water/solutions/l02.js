// Scripted solutions for l02 "Cold Shoulder".

function crateOntoPlate(r) {
  r.form('ice')
    .walkTo(2.4, 2.5, { tol: 0.25 }).stop()                  // line up behind the crate
    .waitUntil((s) => s.level.crates[0].body.x >= 7.9, { mx: 1, timeout: 12, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('hp1', true)
    .form('liquid');
}

function throughDoorAndUp(r) {
  r.walkTo(10.4, 0)
    .expect((s) => s.level.doors[0].open >= 1, 'door A held open by the crate')
    .walkTo(14, 0).walkTo(21.5, 0).walkTo(24, 0, { y: 3 })
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

function slideThroughPane(r) {
  r.walkTo(26.5, 0).form('ice')
    .waitUntil((s) => s.level.panes[0].broken, { mx: 1, timeout: 8, label: 'pane smashed' })
    .waitUntil((s, p) => p.form === 'liquid', { mx: 1, timeout: 4, label: 'melted on the hot tiles' })
    .walkTo(49, 0);
}

function unlockExit(r, shard) {
  r.expect((s) => !s.level.exits[0].open, 'exit starts locked')
    .walkTo(51.3, 0).form('film').walkTo(54.3, 0).form('ice')
    .waitUntil((s) => s.signals.get('exitOpen'), { toward: [56.2, 0], timeout: 6, label: 'heavy plate pressed' })
    .stop();
  if (shard) {
    r.form('liquid').walkTo(54.7, 2.7).jumpTo(54.7, 4.2).jumpTo(56.1, 4.2).expectShards(3)
      .walkTo(56.1, 2.2, { tol: 0.3 }).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2, label: 'back on the floor' });
  }
  r.form('film').walkTo(51.3, 0).form('liquid')
    .expect((s) => s.level.exits[0].open, 'exit stays unlocked (latched)')
    .walkTo(49.6, -3.6).expectExit();
}

export function solve(r) {
  crateOntoPlate(r);
  throughDoorAndUp(r);
  slideThroughPane(r);
  unlockExit(r, false);
}

export function solveAll(r) {
  crateOntoPlate(r);
  // shard 1 floats above the plate: only reachable from on top of the crate
  r.walkTo(6.6, 2.5).jumpTo(8, 2.5)
    .expect((s, p) => p.y > 1, 'standing on the crate')
    .jump(0.6).waitUntil((s, p) => p.grounded, { timeout: 2 }).expectShards(1)
    .walkTo(8, 0.6, { tol: 0.3 }).waitUntil((s, p) => p.grounded && p.y < 0.01, { timeout: 2 });
  throughDoorAndUp(r);
  r.walkTo(25.7, -2.5).jumpTo(25.7, -3.9).expectShards(2)      // pedestal on the top deck
    .walkTo(25.7, -2.4, { tol: 0.3 }).waitUntil((s, p) => p.grounded, { timeout: 2 })
    .walkTo(24, 0);
  slideThroughPane(r);
  unlockExit(r, true);
}
