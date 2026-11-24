// Per-element campaigns (src/levels/index.js). The Water campaign keeps its own, older test file
// (levels.test.js, untouched). This file checks the registry as a whole and applies the same
// house rules to every level of every OTHER element, so a new campaign (Clay) is covered the day
// its first level is registered:
//   ids <prefix>NN in play order, the level's `element` matches its campaign, a known chapter and
//   theme, no load warnings, exactly 3 collectibles, at least one checkpoint (or brazier), a
//   hints.start line, every hint shown by a hint piece, token-only wording that fits the phone
//   card on every input method, a stable spawn, an idle player neither dies nor wins, and the two
//   scripted proofs in tests/solutions/<id>.js: solve(r) and solveAll(r), deterministic, deathless.

import { test, assert, eq } from './lib/harness.js';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import {
  levels, chapters, campaigns, allLevels, ELEMENT_ORDER, CAMPAIGN_LENGTH,
  getLevel, getCampaign, campaignOf, elementOfLevel, levelIndex, nextLevelId,
} from '../src/levels/index.js';
import { ELEMENT_IDS, getElement } from '../src/sim/elements/index.js';
import { ELEMENT_UI, UI_ELEMENT_ORDER } from '../src/ui/elements.js';
import { THEME_NAMES } from '../src/render/themes.js';
import { Sim } from '../src/sim/sim.js';
import { play } from './lib/play.js';
import { resolvePrompt, tokensIn, hardCodedControls, TOKENS, INPUT_MODES, HINT_MAX_CHARS } from '../src/ui/prompts.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('campaigns: water is the published twelve, untouched; every element has a campaign', () => {
  eq(ELEMENT_ORDER, ['water', 'fire', 'clay']);
  eq(ELEMENT_ORDER, UI_ELEMENT_ORDER, 'the title screen and the registry agree on the order');
  eq(campaigns.water.levels, levels); eq(campaigns.water.chapters, chapters);
  eq(levels.map((l) => l.id), ['l01', 'l02', 'l03', 'l04', 'l05', 'l06', 'l07', 'l08', 'l09', 'l10', 'l11', 'l12']);
  for (const l of levels) eq(l.element, undefined, `${l.id}: published water levels carry no element field`);
  eq(chapters.map((c) => c.name), ['The Slip Room', 'The Drying Loft', 'The Great Kiln']);
  eq(campaigns.fire.chapters.map((c) => c.name), ['Pilot Light', 'Flue', 'Live Wire']);
  eq(campaigns.clay.chapters.map((c) => c.name), ['Wedging', 'Bisque', 'Glost']);
  for (const e of ELEMENT_ORDER) {
    const c = campaigns[e];
    eq(c.element, e); eq(getCampaign(e), c);
    eq(c.name, ELEMENT_UI[e].campaign);
    assert(c.levels.length <= CAMPAIGN_LENGTH, `${e}: more than ${CAMPAIGN_LENGTH} levels`);
    c.levels.forEach((l, i) => {
      eq(l.id, `${c.prefix}${String(i + 1).padStart(2, '0')}`, `${e} ids must be ${c.prefix}01, ${c.prefix}02, ... in play order`);
      eq(elementOfLevel(l), e, `${l.id} must say element: '${e}'`);
      assert(c.chapters.some((ch) => ch.id === (l.chapter || 1)), `${l.id}: unknown chapter ${l.chapter}`);
    });
    // a campaign with levels needs the engine to know its element
    if (c.levels.length) assert(ELEMENT_IDS.includes(e) && getElement(e).campaign === c.name, `${e} has levels but no element definition`);
  }
  eq(getCampaign('lava'), null); eq(getCampaign('__proto__'), null);
});

test('campaigns: lookups work across elements, and "next" never leaves a campaign', () => {
  const ids = allLevels.map((l) => l.id);
  eq(new Set(ids).size, ids.length, 'duplicate level ids');
  eq(getLevel('f01'), campaigns.fire.levels[0]); eq(getLevel('l01'), levels[0]); eq(getLevel('nope'), null);
  eq(campaignOf('f02'), campaigns.fire); eq(campaignOf('l07'), campaigns.water); eq(campaignOf('zz'), null);
  eq(levelIndex('f01'), 0); eq(levelIndex('l12'), 11); eq(levelIndex('zz'), -1);
  eq(nextLevelId('l12'), null, 'the end of Water is the end, not the start of Fire');
  eq(nextLevelId('f01'), 'f02');
  const lastFire = campaigns.fire.levels[campaigns.fire.levels.length - 1].id;
  eq(nextLevelId(lastFire), null);
  eq(nextLevelId('zz'), null);
  assert(campaigns.fire.levels.length >= 3, 'the first three Fire levels are registered');
});

for (const element of ELEMENT_ORDER) {
  if (element === 'water') continue;               // tests/levels.test.js
  const camp = campaigns[element];
  for (const data of camp.levels) {
    const id = data.id;

    test(`${id}: loads with no warnings and follows the house rules`, () => {
      const sim = new Sim(data);
      const L = sim.level;
      eq(sim.element.id, element);
      eq(L.warnings, [], 'level warnings');
      eq(L.shards.length, 3, 'every level has exactly 3 collectibles');
      assert(L.checkpoints.length + (L.braziers ? L.braziers.length : 0) >= 1, 'every level has at least one checkpoint (a brazier counts)');
      assert(typeof data.name === 'string' && data.name.length <= 24, 'name must fit the HUD (<= 24 chars)');
      assert(THEME_NAMES.includes(data.theme), `theme ${JSON.stringify(data.theme)} is not one of ${THEME_NAMES.join(', ')}`);
      assert(data.hints && typeof data.hints.start === 'string', 'needs a hints.start line');
      for (const [k, raw] of Object.entries(data.hints)) {
        const where = `${id} hint "${k}"`;
        assert(typeof raw === 'string' && raw.length > 0, `${where} must be a non-empty string`);
        eq(hardCodedControls(raw), [], `${where} hard-codes a control (use a {token})`);
        for (const t of tokensIn(raw)) {
          assert(TOKENS[t], `${where}: unknown token {${t}}`);
          // a form or special token must belong to this level's element
          const owner = Object.values(ELEMENT_UI).find((u) => u.forms.some((f) => f.id === t || f.special === t));
          assert(!owner || owner.id === element, `${where}: {${t}} belongs to ${owner && owner.name}, not ${element}`);
        }
        for (const m of INPUT_MODES) {
          const text = resolvePrompt(raw, m);
          assert(!/[{}]/.test(text), `${where} on ${m} still has a brace: ${text}`);
          assert(text.length <= HINT_MAX_CHARS, `${where} is ${text.length} chars on ${m} (max ${HINT_MAX_CHARS}): "${text}"`);
          assert(/^[A-Z0-9]/.test(text), `${where} on ${m} must start with a capital: ${text}`);
        }
      }
      const used = new Set(L.hintZones.map((h) => h.key)); used.add('start');
      for (const k of Object.keys(data.hints)) assert(used.has(k), `hint "${k}" is never shown (no hint piece uses it)`);
      for (let i = 0; i < 120; i++) sim.step();
      assert(sim.player.grounded, 'spawn point is not on the ground');
      assert(Math.hypot(sim.player.x - data.spawn[0], sim.player.z - data.spawn[2]) < 0.05, 'spawn point pushes the hero sideways');
      assert(Math.abs(sim.player.y - data.spawn[1]) < 0.4, 'spawn point is far above/below the floor');
      eq(sim.deaths, 0);
      assert(!sim.completed, 'spawn must not touch the exit');
      eq(sim.player.form, sim.element.defaultForm);
    });

    test(`${id}: an idle player neither dies nor wins for 20 s`, () => {
      const sim = new Sim(data);
      for (let i = 0; i < 2400; i++) sim.step();
      eq(sim.deaths, 0); assert(!sim.completed);
    });

    const file = path.join(here, 'solutions', `${id}.js`);
    test(`${id}: has a solvability script (tests/solutions/${id}.js)`, () => { assert(existsSync(file), `missing ${file}`); });
    if (!existsSync(file)) continue;

    test(`${id}: scripted play reaches the exit`, async () => {
      const mod = await import(pathToFileURL(file).href);
      assert(typeof mod.solve === 'function', 'solution must export solve(r)');
      const r = play(data);
      mod.solve(r);
      assert(r.sim.completed, 'solve(r) returned without completing the level (end with r.expectExit())');
      eq(r.sim.deaths, 0, 'the reference route should not need a death');
      const res = r.result();
      assert(res && res.id === id && res.timeMs > 0, 'complete event carries id and time');
      assert(res.timeMs < 5 * 60 * 1000, 'levels should be completable in under 5 minutes');
    });

    test(`${id}: scripted play collects all 3 collectibles and exits`, async () => {
      const mod = await import(pathToFileURL(file).href);
      assert(typeof mod.solveAll === 'function', 'solution must export solveAll(r)');
      const r = play(data);
      mod.solveAll(r);
      assert(r.sim.completed, 'solveAll(r) returned without completing the level');
      eq(r.result().shards, [0, 1, 2], 'collectibles');
      eq(r.sim.deaths, 0);
    });

    test(`${id}: the solution is deterministic`, async () => {
      const mod = await import(pathToFileURL(file).href);
      const a = play(data); mod.solveAll(a);
      const b = play(data); mod.solveAll(b);
      eq(a.sim.fingerprint(), b.sim.fingerprint());
      eq(a.result().timeMs, b.result().timeMs);
    });
  }
}
