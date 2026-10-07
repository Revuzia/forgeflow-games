// probe (lane SIM): per-team vision grids, sight sources, thickets, wards, invisibility, reveal,
// structures always visible, no wall occlusion (documented), 10 Hz cadence.
import { buildCatalog, fighter } from './fixtures/catalog_fixture.ts';
import { addUnit, check, fighterEnt, finish, makeWorld, section, stepN } from './fixtures/sim_fixture.ts';
import { NEUTRAL_TEAM } from '../src/sim/entity.ts';
import { spawnUnit } from '../src/sim/spawn.ts';
import { applyStatus } from '../src/sim/status.ts';
import { FIGHTER_SIGHT } from '../src/sim/vision.ts';

const cat = buildCatalog({ fighters: [fighter('fx_fighter_a'), fighter('fx_fighter_b')] });
const seen = (mask: number, team: number): boolean => (mask & (1 << team)) !== 0;

section('grids + sight', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 50, y: 10 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  const g0 = w.visionGrid(0);
  check('grid dims: cell = navCell × 4', g0.cell === 2 && g0.width === 30 && g0.height === 30 && g0.data.length === 900);
  check('visionGrid returns the same live object', w.visionGrid(0) === g0);
  const at = (g: typeof g0, x: number, y: number): number => g.data[Math.floor(y / g.cell) * g.width + Math.floor(x / g.cell)];
  check('cells around a fighter are seen (255)', at(g0, 10, 10) === 255 && at(g0, 10 + FIGHTER_SIGHT - 1, 10) === 255);
  check('far cells unseen (0)', at(g0, 40, 40) === 0 && at(g0, 10 + FIGHTER_SIGHT + 3, 10) === 0);
  check('own units always visible to own team', seen(a.visibleMask, 0) && seen(b.visibleMask, 1));
  check('enemy out of sight is hidden', !seen(b.visibleMask, 0) && !seen(a.visibleMask, 1));
  b.x = 20; b.y = 10;
  stepN(w, 3);
  check('enemy inside sight is visible', seen(b.visibleMask, 0) && seen(a.visibleMask, 1));
  // walls do not occlude sight in this slice
  a.x = 25; a.y = 20; b.x = 34; b.y = 20;
  stepN(w, 3);
  check('no wall occlusion: seen across the wall (documented)', seen(b.visibleMask, 0) && !w.nav.lineOfWalk(25, 20, 34, 20));
  // 10 Hz cadence
  b.x = 55; b.y = 55;
  stepN(w, 3);
  const last = w.vision.lastUpdateTick;
  b.x = 27; b.y = 22;
  w.step();
  const updatedNow = w.vision.lastUpdateTick === w.tick;
  if (!updatedNow) check('between rebuilds the mask is stale (10 Hz)', !seen(b.visibleMask, 0));
  stepN(w, 3);
  check('rebuilt every 3 ticks', w.vision.lastUpdateTick - last >= 3 && w.vision.lastUpdateTick - last <= 6 && seen(b.visibleMask, 0));
});

section('thickets', () => {
  // thicket polygon: [8,40]–[16,48]
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 12, y: 36 }, { fighter: 'fx_fighter_b', team: 1, x: 12, y: 44 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  stepN(w, 3);
  check('unit in a thicket is hidden from an outsider in sight range', !seen(b.visibleMask, 0) && b.thicket === 0);
  check('the hidden unit still sees out', seen(a.visibleMask, 1));
  a.x = 10; a.y = 41;
  stepN(w, 3);
  check('entering the same thicket reveals it', seen(b.visibleMask, 0) && seen(a.visibleMask, 1));
  a.x = 12; a.y = 36;
  const ward = spawnUnit(w, 'fx_ward', 0, 14, 46, { owner: 0, duration: 60 });
  stepN(w, 3);
  check('an allied ward inside the thicket reveals it', seen(b.visibleMask, 0) && ward.sight === 8);
  ward.alive = false;
  stepN(w, 3);
  check('dead ward no longer reveals', !seen(b.visibleMask, 0));
  applyStatus(w, a, b, 'reveal', 1);
  stepN(w, 3);
  check('reveal overrides the thicket', seen(b.visibleMask, 0));
});

section('invisible, structures, neutrals, projectiles', () => {
  const w = makeWorld(cat, [{ fighter: 'fx_fighter_a', team: 0, x: 10, y: 10 }, { fighter: 'fx_fighter_b', team: 1, x: 14, y: 10 }]);
  const a = fighterEnt(w, 0), b = fighterEnt(w, 1);
  applyStatus(w, b, b, 'invisible', 3);
  stepN(w, 3);
  check('invisible unit hidden even in sight', !seen(b.visibleMask, 0));
  applyStatus(w, a, b, 'reveal', 1);
  stepN(w, 3);
  check('reveal shows an invisible unit', seen(b.visibleMask, 0));
  const t = addUnit(w, 'fx_tower', 1, 55, 55);
  stepN(w, 3);
  check('structures are always visible to everyone', seen(t.visibleMask, 0) && seen(t.visibleMask, 1));
  check('structures give their team vision', w.vision.seen(1, 55, 50) && !w.vision.seen(0, 55, 50));
  const m = spawnUnit(w, 'fx_monster', NEUTRAL_TEAM, 12, 14);
  stepN(w, 3);
  check('neutral monster visible to teams that see its cell', seen(m.visibleMask, 0) && seen(m.visibleMask, 1));
  m.x = 45; m.y = 45;
  stepN(w, 3);
  check('neutral monster gives no vision and hides in fog', !seen(m.visibleMask, 0) && !w.vision.seen(0, 45, 45) && w.vision.grid(1) !== undefined);
  const mm = addUnit(w, 'fx_minion', 1, 40, 30);
  stepN(w, 3);
  check('minions give their team sight (sightRange)', w.vision.seen(1, 40, 37) && !seen(mm.visibleMask, 0));
});

finish('probe_sim_core_vision');
