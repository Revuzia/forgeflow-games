import { twoTowns, must } from './helpers/god.ts';
import { WorldView } from '../src/client/worldview.ts';
const { sim, st, lune } = twoTowns();
must(sim, { k: 'disaster.spawn', kind: 'drought', pos: st.pos });
sim.drainEvents();
must(sim, { k: 'miracle.water', pos: lune.pos, radius: 100 });
const ev = sim.drainEvents();
console.log('events', ev.map((e) => e.t).join(','));
console.log('relent', JSON.stringify(ev.filter((e) => e.t === 'disaster.relent')));
