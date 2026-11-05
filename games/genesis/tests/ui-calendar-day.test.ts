// postrel punch #4: the client calendar must never return a fractional day, even when asked for a tick
// more than a year past the planet's last params update on a world with a fractional year length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldView } from '../src/client/worldview.ts';

function cal(yearDays: number, dayOfYear: number, dtTicks: number, hourAtLon0 = 5) {
  const pv = { params: { hourAtLon0, dayHours: 24, dayOfYear, year: 7, yearDays, sunFrozen: false, seasonPinned: null }, paramsTick: 1000 };
  return (WorldView.prototype.calendar as any).call({ renderTick: 1000 }, pv, 1000 + dtTicks);
}

test('calendar day stays a whole number across year rollovers with fractional yearDays', () => {
  for (const yd of [12.4, 7.83, 25.17, 3.5, 1.2]) {
    for (let dt = -5 * 24 * 60; dt < 5 * Math.ceil(yd) * 24 * 60; dt += 397) {
      for (const d0 of [0, Math.floor(yd)]) {
        const c = cal(yd, d0, dt);
        assert.ok(Number.isInteger(c.day), `yearDays ${yd} dt ${dt}: day ${c.day}`);
        assert.ok(c.day >= 1 && c.day <= Math.ceil(yd), `yearDays ${yd} dt ${dt}: day ${c.day} out of range`);
        assert.ok(Number.isInteger(c.year), `year ${c.year}`);
        assert.ok(c.yearFrac >= 0 && c.yearFrac < 1 + 1e-9, `yearFrac ${c.yearFrac}`);
      }
    }
  }
});

test('the reported case: a save ~37k ticks past paramsTick reads as an integer day', () => {
  const c = cal(12.4, 3, 37000);
  assert.ok(Number.isInteger(c.day), String(c.day));
  assert.match(`day ${c.day}`, /^day \d+$/);
});

test('saves kept with a fractional day read back whole (title Continue line, save list)', async () => {
  const { tidyDay } = await import('../src/ui/saves.ts');
  assert.equal(tidyDay('Year 7 · spring · day 1.1999999999999993 · 06:12'), 'Year 7 · spring · day 1 · 06:12');
  assert.equal(tidyDay('Y7 · d12.4000001'), 'Y7 · d12');
  assert.equal(tidyDay('Year 7 · spring · day 14 · 06:12'), 'Year 7 · spring · day 14 · 06:12');
  assert.equal(tidyDay('A moment'), 'A moment');
});
