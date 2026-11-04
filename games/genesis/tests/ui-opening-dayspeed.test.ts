// GENESIS — the opening's "let the day pass" (release minor 2). The opening brief asked 3x-10x when 1x was 10 ticks a
// second; LIVING §1.1 made 1x one tick a second, so that range is 30-100 ticks a second now. DAY_SPEED must stay inside
// it, be a speed step the HUD offers (so the HUD shows it lit), and bring Cinder's night in well under a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAY_SPEED } from '../src/ui/opening.ts';
import { SPEED_PRESETS, TICKS_PER_SECOND_1X } from '../src/sim/types.ts';

test('"let the day pass" is the old 3x-10x in today\'s ticks, a HUD step, and a Cinder day in under 30 s', () => {
  const OLD_1X_TPS = 10; // LIVING §1.1: "1x = 1 tick per real second (was 10)"
  const tps = DAY_SPEED * TICKS_PER_SECOND_1X;
  assert.ok(tps >= 3 * OLD_1X_TPS && tps <= 10 * OLD_1X_TPS, `${tps} tps is within the brief's old 3x-10x`);
  assert.ok((SPEED_PRESETS as readonly number[]).includes(DAY_SPEED), 'a speed step the HUD has a button for');
  const kinds = JSON.parse(readFileSync(new URL('../src/data/planetkinds.json', import.meta.url), 'utf8'));
  const barren = (kinds.kinds ?? kinds).find((k: { id: string }) => k.id === 'barren');
  const daySeconds = (barren.dayHours * 60) / tps; // 1 tick = 1 game minute
  assert.ok(daySeconds >= 10 && daySeconds <= 30, `a Cinder day in ${daySeconds.toFixed(1)} s`);
});
