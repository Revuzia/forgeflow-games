// The parts of an element that live outside the sim: its entry in the UI table (names, wording,
// form buttons, icons), its hint tokens for every input method, its themes, and its hero view.
// Everything is checked for every element that has levels, so a new element is covered by
// registering it (ELEMENTS.md lists what each check wants).

import { test, assert, eq } from './lib/harness.js';
import { ELEMENT_UI, UI_ELEMENT_ORDER, elementUi, isElementId } from '../src/ui/elements.js';
import { ICONS, FORM_KEYS, FORM_LABELS, HERO_ICONS, COLLECTIBLE_ICONS, GAUGE_ICONS } from '../src/ui/icons.js';
import { TOKENS, INPUT_MODES, PAD_FORM_BUTTONS, resolvePrompt, hardCodedControls } from '../src/ui/prompts.js';
import { ELEMENTS, ELEMENT_IDS } from '../src/sim/elements/index.js';
import { campaigns, ELEMENT_ORDER } from '../src/levels/index.js';
import { THEMES, THEME_NAMES, resolveTheme } from '../src/render/themes.js';
import { SAVE_ELEMENTS } from '../src/save.js';
import { Sim } from '../src/sim/sim.js';

test('ui table: all three elements are described, in title order, with everything the screens need', () => {
  eq(UI_ELEMENT_ORDER, ['water', 'fire', 'clay']);
  eq(UI_ELEMENT_ORDER, SAVE_ELEMENTS, 'the save file accepts exactly the elements the UI knows');
  for (const id of UI_ELEMENT_ORDER) {
    const u = ELEMENT_UI[id];
    eq(u.id, id);
    for (const k of ['name', 'hero', 'campaign', 'pitch', 'tagline', 'accent', 'accentDeep', 'deaths', 'win']) assert(typeof u[k] === 'string' && u[k], `${id}.${k}`);
    assert(u.pitch.length <= 48, `${id}: the pitch must fit a phone card (${u.pitch.length} chars)`);
    eq(u.forms.length, 4);
    for (const f of u.forms) {
      assert(f.id && f.label && f.button && /^#[0-9a-f]{6}$/i.test(f.color), `${id}: form ${JSON.stringify(f)}`);
      assert(ICONS[f.id], `${id}: no icon for form "${f.id}"`);
      assert(FORM_LABELS[f.id] === f.label && /^[1-4]$/.test(FORM_KEYS[f.id]));
    }
    for (const k of ['one', 'many', 'label']) assert(u.collectible[k], `${id}.collectible.${k}`);
    assert(HERO_ICONS[id] && COLLECTIBLE_ICONS[id].length === 2 && GAUGE_ICONS[id], `${id}: hero, collectible and gauge icons`);
    assert(typeof u.gauge.name === 'string' && typeof u.gauge.meter === 'boolean');
  }
  eq(elementUi('fire').hero, 'Cinder'); eq(elementUi('lava').id, 'water'); eq(elementUi(undefined).id, 'water'); eq(elementUi('__proto__').id, 'water');
  assert(isElementId('clay') && !isElementId('toString') && !isElementId(3));
});

test('ui table and sim agree: same forms in the same button order, same names, specials named alike', () => {
  for (const id of ELEMENT_IDS) {
    const E = ELEMENTS[id], u = ELEMENT_UI[id];
    assert(u, `element ${id} has no entry in src/ui/elements.js`);
    eq(u.forms.map((f) => f.id), E.forms, `${id}: button order`);
    eq(u.name, E.name); eq(u.hero, E.hero); eq(u.campaign, E.campaign);
    for (const f of u.forms) eq(f.special, E.formDefs[f.id].special, `${id}.${f.id}: special`);
    eq(u.gauge.meter, E.gauge.refill === 0, `${id}: a gauge that never refills by itself gets its own meter`);
  }
  // an element with levels must be known to the sim; one without (clay, for now) needs only its UI entry
  for (const e of ELEMENT_ORDER) if (campaigns[e].levels.length) assert(ELEMENT_IDS.includes(e), `${e} has levels but no sim definition`);
});

test('prompts: every form of every element has a token, worded per input method by its button', () => {
  for (const id of UI_ELEMENT_ORDER) {
    ELEMENT_UI[id].forms.forEach((f, i) => {
      const t = TOKENS[f.id];
      assert(t, `no token {${f.id}}`);
      eq(t.keyboard, `press ${i + 1}`); eq(t.touch, `tap the ${f.button} button`); eq(t.pad, `press ${PAD_FORM_BUTTONS[i]}`);
      if (f.special) {
        const s = TOKENS[f.special];
        assert(s, `no token {${f.special}} for the special of ${f.id}`);
        eq(s.keyboard, `press ${i + 1} again`); eq(s.touch, `tap the ${f.button} button again`); eq(s.pad, `press ${PAD_FORM_BUTTONS[i]} again`);
      }
    });
  }
  for (const [name, t] of Object.entries(TOKENS)) for (const m of INPUT_MODES) assert(typeof t[m] === 'string' && t[m], `{${name}} on ${m}`);
  // water's wording is exactly what it was
  eq(TOKENS.liquid, { keyboard: 'press 1', touch: 'tap the drop button', pad: 'press X' });
  eq(TOKENS.film, { keyboard: 'press 4', touch: 'tap the film button', pad: 'press RB' });
});

test('prompts: fire hints read naturally on keyboard, touch and gamepad, including the special', () => {
  eq(resolvePrompt('{blaze} to flare up.', 'keyboard'), 'Press 2 to flare up.');
  eq(resolvePrompt('{blaze} to flare up.', 'touch'), 'Tap the blaze button to flare up.');
  eq(resolvePrompt('{blaze} to flare up.', 'pad'), 'Press Y to flare up.');
  eq(resolvePrompt('Jump, then {flare} in mid-air.', 'keyboard'), 'Jump, then press 2 again in mid-air.');
  eq(resolvePrompt('Jump, then {flare} in mid-air.', 'touch'), 'Jump, then tap the blaze button again in mid-air.');
  eq(resolvePrompt('Jump, then {flare} in mid-air.', 'pad'), 'Jump, then press Y again in mid-air.');
  eq(resolvePrompt('{ember} to settle; {smoke} to rise; {spark} to dart.', 'touch'), 'Tap the ember button to settle; tap the smoke button to rise; tap the spark button to dart.');
  eq(resolvePrompt('{shed} to leave a shell.', 'keyboard'), 'Press 3 again to leave a shell.');
  eq(hardCodedControls('{flare} in mid-air, then {ember}.'), []);
});

test('themes: every theme a level names exists, and each campaign uses its own', () => {
  for (const n of ['pilot', 'flue', 'wire']) { assert(THEME_NAMES.includes(n), n); eq(resolveTheme(n).name, n); }
  for (const l of campaigns.fire.levels) assert(['pilot', 'flue', 'wire'].includes(l.theme), `${l.id}: fire levels use pilot / flue / wire, not ${l.theme}`);
  for (const l of campaigns.water.levels) assert(['slip', 'loft', 'kiln'].includes(l.theme || 'slip'), `${l.id}: water themes are unchanged`);
  for (const n of ['wedge', 'bisque', 'glost']) { assert(THEME_NAMES.includes(n), n); eq(resolveTheme({ theme: n }).name, n, 'Clay has its three themes waiting for its levels'); }
  eq(resolveTheme({ theme: 'porcelain' }).name, 'slip', 'a theme that does not exist falls back');
  for (const n of THEME_NAMES) assert(typeof THEMES[n].moteLight === 'number', `${n}.moteLight`);
});

test('hero views: each element with levels has its own hero with a body, a face and a light for every form', async () => {
  const THREE = await import('../vendor/three.module.min.js');
  const { createHero, hasHero } = await import('../src/render/hero/index.js');
  const { Particles, Prints } = await import('../src/render/particles.js');
  const { HeroView } = await import('../src/render/hero/base.js');
  const mk = (pieces, element) => new Sim({ id: 't', name: 'T', spawn: [0, 0, 0], element, pieces: [{ type: 'block', box: [-9, -1, -9, 9, 0, 9] }, { type: 'exit', pos: [7, 0, 7] }, ...pieces] });
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 100); cam.position.set(0, 4, 8);
  const ldir = new THREE.Vector3(0.3, 0.8, 0.5);
  for (const e of ELEMENT_ORDER) {
    if (!campaigns[e].levels.length) continue;
    assert(hasHero(e), `${e} has levels but no hero view (src/render/hero/index.js)`);
    const hero = createHero(e, new Particles(200), new Prints(8));
    assert(hero instanceof HeroView);
    eq(hero.cfg.forms, ELEMENTS[e].forms, `${e}: hero forms`);
    assert(hero.sceneObjects.length >= 3 && hero.eyeMeshes.length === 2, 'two eyes, a body group, a ground mark, a ring');
    const sim = mk([], e);
    hero.snap(sim);
    for (const form of ELEMENTS[e].forms) {
      assert(hero.bodies[form], `${e}: no body for ${form}`);
      assert(Array.isArray(hero.cfg.formColors[form]) && typeof hero.cfg.lid[form] === 'number', `${e}.${form}: colour and lid colour`);
      sim.forceForm(form);
      for (let i = 0; i < 40; i++) { sim.step(); sim.drainEvents().forEach((ev) => hero.onEvent(ev, sim)); hero.update(sim, 1, 1 / 60, i / 60, ldir, cam); }
      assert(hero.bodies[form].visible, `${e}.${form}: its body is showing`);
      for (const other of ELEMENTS[e].forms) if (other !== form) assert(!hero.bodies[other].visible, `${e}: ${other} still showing as ${form}`);
      const E = hero.eyes;
      assert(E.visible && Number.isFinite(E.position.y + E.position.z) && E.position.y > 0.03, `${e}.${form}: the face is placed on the body`);
      for (const m of hero.eyeMeshes) assert(m.scale.x > 0.03 && Number.isFinite(m.position.x), `${e}.${form}: eye size`);
      const lt = hero.light(form, sim.player, { rm: false, time: 1 });
      assert(lt.color.length === 3 && lt.power > 0, `${e}.${form}: light`);
      const mk2 = hero.groundMark(form, 0, { rm: true, time: 0 });
      assert(mk2.size > 0 && mk2.alpha > 0, `${e}.${form}: ground mark`);
    }
  }
  assert(!hasHero('toString'));
});
