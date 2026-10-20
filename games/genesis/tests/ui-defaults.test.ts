// GENESIS — the tool card's values for every power (UI lane; audit blocker "a 139-day tornado, 20 001 strangers"): what
// a cast sends when the player has not touched the card is the power's own params and the data's defaults — never a
// value made up from a slider's range. Checked for EVERY power of powers.json (and the interface's own: the vein brush,
// the invent dialogs), then end to end on the real sim: every disaster cast from an untouched card lives its own kind's
// life at its own kind's reach, and an introduction brings what the command brings by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PowerBook, castValues, buildCommand, worldPrefill, defaultValue, sliderStart, autoWords, toolMode, type Power } from '../src/ui/powers.ts';
import { town } from './helpers/god.ts';

const WORLD = { dayHours: 24, yearDays: 12, axialTilt: 0.41, gravity: 9.8, magnetism: 1, luminosity: 1, starKind: 'G' };

test('tool card: an untouched card sends no number the data did not give, for every power', () => {
  const book = new PowerBook();
  const made: string[] = [];
  for (const p of book.list) {
    const v = castValues(p, {}, (k) => worldPrefill(p, k, WORLD));
    for (const [k, x] of Object.entries(v)) {
      const s = p.schema[k];
      if (p.params[k] !== undefined && x === p.params[k]) continue; // the power's own
      if (s.default !== undefined && x === s.default) continue; // the data's default
      if (worldPrefill(p, k, WORLD) === x) continue; // what the world is now (a setter starts from it)
      made.push(`${p.id}.${k} = ${JSON.stringify(x)}`);
    }
    // nothing outside its range, whatever its source
    for (const [k, x] of Object.entries(v)) {
      const s = p.schema[k];
      if (typeof x !== 'number' || !s) continue;
      if (s.min !== undefined) assert.ok(x >= s.min, `${p.id}.${k} = ${x} < ${s.min}`);
      if (s.max !== undefined) assert.ok(x <= s.max, `${p.id}.${k} = ${x} > ${s.max}`);
    }
  }
  assert.deepEqual(made, [], `values made up by the card:\n${made.join('\n')}`);
});

test('tool card: a default is only ever the data\'s; an unset value reads as "its own" with what that is', () => {
  const book = new PowerBook();
  const tornado = book.get('disaster-tornado')!;
  for (const k of Object.keys(tornado.schema)) assert.equal(defaultValue(k, tornado.schema[k]), tornado.schema[k].default);
  // the kind's own reach and strength (disasters.json), its life in words
  assert.equal(book.defaultOf(tornado, 'radius'), 60);
  assert.equal(book.defaultOf(tornado, 'intensity'), 1);
  assert.equal(book.defaultOf(tornado, 'scale'), 1);
  assert.equal(book.defaultOf(tornado, 'duration'), undefined);
  assert.equal(autoWords(book, tornado, 'duration'), 'its own: 3–6 h');
  assert.equal(autoWords(book, tornado, 'radius'), 'its own: 60 m');
  assert.equal(autoWords(book, book.get('introduce-people')!, 'qty'), 'its own');
  // the slider stands at the known default, at 1 for a factor, at the low end of a wide range
  assert.equal(sliderStart(tornado.schema.radius, 60), 60);
  assert.equal(sliderStart(tornado.schema.scale, undefined), 1);
  assert.equal(sliderStart(tornado.schema.duration, undefined), 1);
  const intro = book.get('introduce-people')!;
  assert.equal(castValues(intro, {}).qty, undefined, 'no 20 001 strangers');
  // the player's own value is kept as given
  assert.equal(castValues(intro, { qty: 12 }).qty, 12);
});

test('tool card: every disaster cast from an untouched card lives its own kind\'s life at its own kind\'s reach (real sim)', () => {
  const { sim, st } = town();
  const book = new PowerBook();
  book.setCommands(sim.query('commands'));
  book.setDisasterKinds(sim.query('disaster-kinds'));
  const pos = [...st.pos];
  const bad: string[] = [];
  let n = 0;
  for (const p of book.list as Power[]) {
    if (p.command !== 'disaster.spawn' || typeof p.params.kind !== 'string') continue;
    const def = (sim.query('disaster-kinds') as { id: string; life?: [number, number]; radius?: number }[]).find((d) => d.id === p.params.kind);
    if (!def) continue;
    // the brush stands at the kind's own reach (src/ui/tools.ts arm → defaultOf)
    const radius = Number(book.defaultOf(p, 'radius') ?? 250);
    const c = buildCommand(p, castValues(p, {}), { hit: { planet: 0, dir: pos } }, toolMode(p) === 'instant' ? null : radius, 0);
    if (c.duration !== undefined) bad.push(`${p.id}: sends a duration ${String(c.duration)}`);
    if (c.scale !== undefined) bad.push(`${p.id}: sends a scale ${String(c.scale)}`);
    const r = sim.applyNow(c);
    if (!r.ok) continue; // a kind this little world cannot hold (a moon to fall needs a moon): not the card's doing
    const id = r.created?.find((e) => e.kind === 'disaster')?.id;
    if (id === undefined) continue;
    const d = sim.query('disaster', { id }) as { life?: number; radius?: number } | null;
    n++;
    const life = Number(d?.life ?? -1);
    const lo = def.life?.[0] ?? 0, hi = def.life?.[1] ?? 0;
    // (a warned kind waits through its warning first: its life may carry it on top — never days for an hour's storm)
    if (def.life && life > 0 && (life < lo * 0.5 || life > hi * 2 + 900)) bad.push(`${p.id}: lives ${life} ticks (its own ${lo}–${hi})`);
    if (def.radius && d?.radius !== undefined && Math.abs(Number(d.radius) / def.radius - 1) > 0.6) bad.push(`${p.id}: reach ${d.radius} m (its own ${def.radius} m)`);
    sim.applyNow({ k: 'disaster.cancel', id, planet: 0 });
  }
  assert.ok(n >= 25, `${n} disasters cast`);
  assert.deepEqual(bad, [], bad.join('\n'));
});
