// ARC §1.4 / §8.1 M5: the town's heart in the UI (chip glyph, Hearts layer colours and words).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEART_COLORS, HEART_KINDS, deltaE, heartGlyph, heartHover, heartAlpha, shareWords, duskWords, type TownHeart } from '../src/ui/hearts.ts';
import { OVERLAYS } from '../src/ui/overlays.ts';
import { icon, iconKeys } from '../src/ui/icons.ts';

const H = (o: Partial<TownHeart>): TownHeart => ({ kind: 'quiet', proud: false, devoted: 0, fearful: 0, restless: 0, defiant: 0, pride: 0.2,
  defiance: 0, dusk: 0.5, duskYearAgo: 0.6, caption: '', line: '', remember: [], answered: '', ...o });

test('M5: the four kinds and the proud rim are pairwise distinct (ΔE >= 15) in every palette', () => {
  for (const [name, pal] of Object.entries(HEART_COLORS)) {
    const keys = [...HEART_KINDS, 'proud'] as const;
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
      const d = deltaE(pal[keys[i]], pal[keys[j]]);
      assert.ok(d >= 15, `${name}: ${keys[i]} vs ${keys[j]} ΔE ${d.toFixed(1)}`);
    }
  }
  assert.deepEqual(Object.keys(HEART_COLORS).sort(), ['deuteranopia', 'monochrome', 'protanopia', 'standard', 'tritanopia']);
});

test('the glyph shows only for a heart that is not quiet, or a proud town; its tooltip is the caption', () => {
  assert.equal(heartGlyph({ name: 'Aru', heart: undefined }), null);
  assert.equal(heartGlyph({ name: 'Aru', heart: H({}) }), null);
  const f = heartGlyph({ name: 'Aru', heart: H({ kind: 'fearful', fearful: 0.5, caption: 'They watch the sky' }) })!;
  assert.equal(f.icon, 'heart-fearful');
  assert.equal(f.title, 'Aru: They watch the sky');
  const p = heartGlyph({ name: 'Aru', heart: H({ proud: true }) })!;
  assert.equal(p.icon, null);
  assert.ok(p.proud && /boast/.test(p.title));
  const d = heartGlyph({ name: 'Aru', heart: H({ kind: 'defiant', defiant: 0.4 }), defiant: { kind: 'curse', tick: 77 } })!;
  assert.equal(d.icon, 'heart-defiant');
  assert.equal(d.defiantTick, 77);
  assert.equal(d.title, 'Aru: They raise their fists · they cursed the sky', 'falls back to the §1.4 caption, then the act (§3.4)');
  for (const k of [...HEART_KINDS.map((k) => `heart-${k}`), 'heart-proud', 'heart']) {
    assert.ok(iconKeys().includes(k), `icon ${k}`);
    assert.ok(icon(k).includes('<path'), k);
  }
});

test('the Hearts layer: in LAYERS, words not numbers on hover, alpha 0.35 + 0.5 share', () => {
  const def = OVERLAYS.find((o) => o.id === 'hearts');
  assert.deepEqual(def, { id: 'hearts', label: 'Hearts', icon: 'heart', fields: ['territory'], live: true });
  const line = heartHover({ name: 'Aru', population: 40, heart: H({ kind: 'fearful', fearful: 0.5, proud: true, dusk: 9 / 40, caption: 'They watch the sky' }) });
  assert.equal(line, 'Aru · They watch the sky (about half) · proud · 9 of 40 came at dusk');
  assert.ok(!/\d\.\d|%/.test(line));
  assert.equal(heartAlpha(H({})), 0);
  assert.ok(Math.abs(heartAlpha(H({ kind: 'devoted', devoted: 0.6 })) - 0.65) < 1e-9);
  assert.equal(shareWords(0.5), 'about half');
  assert.equal(shareWords(0.9), 'nearly all');
  assert.equal(shareWords(0.1), 'a few');
  assert.equal(duskWords(H({ dusk: 0.6 }), 40), '24 of 40 came at dusk');
});
