// Scripted solutions for l12 "The Great Kiln".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;

/** 1. Stokehole: douse the ember bar as a drop, crawl under it as film, close the circuit, step out. */
function stokehole(r) {
  r.walkTo(8.6, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(10, 0)
    .waitUntil((s) => s.level.embers[0].doused, { mx: 1, timeout: 3, label: 'the ember bar is out' })
    .form('film').walkTo(12.6, 0).walkTo(15, 0)
    .expectSignal('arc', true)
    .expect((s) => s.signals.get('burnA') && s.level.fires[0].active, 'burner A is alight')
    .walkTo(16.6, 0).form('liquid')
    .walkTo(19, 0).waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2 })
    .walkTo(22.5, 0);
}

/** 2. Culvert: film through the grille, ride the covered channel, surface in the pool. */
function culvert(r, shard) {
  r.walkTo(27, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(31, 0).form('film')
    .waitUntil((s, p) => p.floating, { timeout: 3, label: 'dropped through the grille into the water' });
  if (shard) {
    r.form('ice')
      .waitUntil((s, p) => p.grounded && p.y < -3.2, { timeout: 3, label: 'sunk to the channel bed' })
      .waitUntil((s) => s.shardsTaken.length === 2, { toward: [35.6, 0], timeout: 6, label: 'shard on the channel bed' })
      .form('liquid')
      .waitUntil((s, p) => p.floating, { timeout: 4, label: 'floated up again' });
  }
  r.waitUntil((s, p) => p.x > 44.6, { toward: [50, 0], timeout: 8, label: 'carried under the wall' });
  if (!shard) r.expect((s, p) => p.form === 'film', 'still film in the channel');
  r.form('liquid')
    .waitUntil((s) => s.signals.get('burnB'), { toward: [51, 0], timeout: 4, label: 'afloat in the pool: burner B catches' })
    .waitUntil((s, p) => p.x > 51.2, { toward: [53, 0], timeout: 4, label: 'at the far bank' })
    .jumpTo(54, 0)
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'out of the water')
    .expect((s) => s.level.fires[1].active, 'burner B is alight');
}

/** 3. Cold well: frost freezes Mote, ice sinks onto the heavy plate, the frost stops, a drop floats up. */
function coldWell(r) {
  r.walkTo(58, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(62, 0)
    .waitUntil((s, p) => p.form === 'ice', { toward: [66, 0], timeout: 3, label: 'frozen at the edge of the well' })
    .form('liquid', { expect: false })
    .expect((s, p) => p.form === 'ice', 'the frost refuses every other form')
    .waitUntil((s, p) => p.grounded && p.y < -4, { toward: [66.75, 0], timeout: 5, label: 'sunk to the bottom' })
    .waitUntil((s) => s.signals.get('plateC'), { toward: [66.75, 0], timeout: 4, label: 'ice on the heavy plate' })
    .stop()
    .expectSignal('burnC', true)
    .expect((s) => !s.level.zones[0].active, 'the frost is off')
    .form('liquid')
    .waitUntil((s, p) => p.floating && p.y > -1, { timeout: 4, label: 'floated to the top' })
    .waitUntil((s, p) => p.x > 69, { toward: [70.5, 0], timeout: 4, label: 'across' })
    .waitUntil((s, p) => p.floating, { toward: [70.5, 0], timeout: 2, label: 'afloat at the far bank' })
    .jumpTo(71.5, 0)
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'out of the well')
    .expect((s) => s.level.fires[2].active && s.signals.get('lit'), 'burner C is alight; the kiln is lit');
}

/** 4. Throat: the chimney lifts Mote as steam; keep to the clear half of the shaft at each jet. */
function throat(r, shard) {
  r.walkTo(73, 0).walkTo(88, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(90.8, 0, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the chimney boiled Mote')
    .waitUntil((s, p) => p.y > 4.9, { toward: [93.5, 1.3], timeout: 4, label: 'past jet 1, on its clear side' });
  if (shard) {
    r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [93.4, -2.4], timeout: 3.5, label: 'the wide shard, out in the gap' });
  }
  r
    .waitUntil((s, p) => p.y > 8.3, { toward: [93.5, -1.3], timeout: 4, label: 'past jet 2' })
    .waitUntil((s, p) => p.y > 11.7, { toward: [93.5, 1.3], timeout: 4, label: 'past jet 3' })
    .waitUntil((s, p) => p.y > 14.1, { toward: [93.5, 0], timeout: 4, label: 'above the crown' })
    .waitUntil((s, p) => p.x > 97.6, { mx: 1, timeout: 3, label: 'over the crown' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 14) < 1e-6 && p.x > 97, 'on the crown');
}

/** 5. Plunge: the frost takes Mote, the slope does the rest. */
function plunge(r) {
  r.walkTo(98.4, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .waitUntil((s) => s.level.panes[0].broken, { mx: 1, timeout: 10, label: 'glass smashed by the slide' })
    .expectExit({ timeout: 2, toward: [119.6, 0] });
}

export function solve(r) {
  stokehole(r);
  culvert(r, false);
  coldWell(r);
  throat(r, false);
  plunge(r);
}

export function solveAll(r) {
  r.walkTo(5, 2.8).expectShards(1);
  stokehole(r);
  culvert(r, true);
  coldWell(r);
  throat(r, true);
  plunge(r);
}
