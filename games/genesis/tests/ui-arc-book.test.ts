// ARC §5 (stage C), the UI side, coded to StoryView (§5.3) and PlanetSnap.age / epithet (§6.2) ahead of the sim: the
// Book's order, its export (every age heading; "The Book of the {people} of {planet}.md"), a paragraph's place, the HUD
// age line, the title card and when it shows, the save card's story line and the title's Continue line, the words that
// open the Book, the stub's story answers, and the chronicle.age cue by tone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { asStory, bookBlocks, bookExport, bookFileName, ageYears, paragraphPlace, ageLine, titleCard, AgeWatch, openBookIntent, type StoryView } from '../src/ui/book.ts';
import { saveStoryLine, continueLine } from '../src/ui/saves.ts';
import { arcStub, arcStubQuery } from '../src/client/arcstub.ts';
import { cueFor } from '../src/audio/eventmap.ts';

export const STORY: StoryView = {
  planet: 0,
  title: 'The Book of the Ashuk of Teru',
  opening: 'First the air thickened, and the sea came. Then rain, and the first green on the shore.',
  people: { character: 'trust', line: 'They were a people of trust: they asked, and waited, and were not often let down.' },
  god: { character: 'faithfulness', line: 'Their god kept its word.', epithet: 'the One Who Drowned the World, who keeps its word' },
  ages: [
    { id: 3, name: 'The Flood of Aru', kind: 'flood', from: 44, to: 46, paragraphs: ['The water came at night.', 'Of Aru, the house of Hesh came through the Flood of Aru whole: nine of them.'] },
    { id: 1, name: 'The Days of Making', kind: 'making', from: 1, to: 12, paragraphs: ['There was rock, and then air.'] },
    { id: 4, name: 'The Age of the Bow', kind: 'covenant', from: 46, to: null, paragraphs: ['A bow stood over Aru and Tesh after the rain. The god had promised never again to destroy them by water.', 'And so it is now.'], told: 'As it is told now in Tesh: the water rose forty days, and the god wept.' },
    { id: 2, name: 'The Years of Plenty at Aru', kind: 'plenty', from: 12, to: 44, paragraphs: ['At Aru they sowed, and the rain came when it was asked.', 'And the years of plenty ended, when the water rose.'] },
  ],
  generations: ['From Aru came Tesh and Vorn.', 'Vorn was lost in the Flood of Aru.'],
  promises: ['After the Flood of Aru the god promised the house of Hesh never again to destroy them by water. It has kept that promise 23 years.'],
  closing: 'The story is not finished. The promise holds.',
};

test('the Book keeps §5.5 order: title, opening, the two characters, what they call you, ages oldest first, Generations, Promises, closing', () => {
  const s = asStory(JSON.parse(JSON.stringify(STORY)))!;
  const b = bookBlocks(s);
  assert.deepEqual(b.map((x) => x.t), ['title', 'opening', 'character', 'character', 'epithet', 'age', 'age', 'age', 'age', 'section', 'section', 'closing']);
  assert.deepEqual(b.filter((x) => x.t === 'age').map((x) => (x as { name: string }).name), ['The Days of Making', 'The Years of Plenty at Aru', 'The Flood of Aru', 'The Age of the Bow']);
  const bow = b.find((x) => x.t === 'age' && x.kind === 'covenant') as { years: string; told?: string; open: boolean };
  assert.equal(bow.years, 'since year 46');
  assert.equal(bow.open, true);
  assert.match(bow.told!, /^As it is told now in Tesh/);
  assert.deepEqual(b.filter((x) => x.t === 'section').map((x) => (x as { name: string }).name), ['Generations', 'Promises']);
  // a migrated world's note sits under the title
  const m = bookBlocks({ ...s, note: 'What came before is remembered only in the chronicle.' });
  assert.deepEqual(m.slice(0, 2).map((x) => x.t), ['title', 'note']);
  assert.equal(ageYears({ from: 31, to: 44 }), 'years 31–44');
  assert.equal(ageYears({ from: 31, to: 31 }), 'year 31');
  assert.equal(asStory(null), null);
  assert.equal(asStory({ ok: false }), null);
});

test('the export carries every age heading and the closing (never "The End"), under the Book\'s own name', () => {
  for (const fmt of ['md', 'html', 'txt'] as const) {
    const out = bookExport(STORY, fmt);
    for (const a of STORY.ages) assert.ok(out.includes(fmt === 'txt' ? a.name.toUpperCase() : a.name), `${fmt}: ${a.name}`);
    assert.ok(out.includes('The story is not finished. The promise holds.'));
    assert.ok(!/The End/.test(out));
  }
  const md = bookExport(STORY, 'md');
  assert.match(md, /^# The Book of the Ashuk of Teru\n/);
  assert.match(md, /\n## The Age of the Bow\n\n_since year 46_\n/);
  assert.match(md, /What they call you: \*\*the One Who Drowned the World, who keeps its word\*\*/);
  assert.match(md, /> _As it is told now in Tesh: the water rose forty days, and the god wept._/);
  assert.equal(bookFileName(STORY, 'md'), 'The Book of the Ashuk of Teru.md');
  assert.equal(bookFileName({ title: 'The Book: of A/B' }, 'html'), 'The Book of A B.html');
  assert.match(bookExport({ ...STORY, title: 'A <b>' }, 'html'), /<title>A &lt;b&gt;<\/title>/);
});

test('a paragraph made from a chronicle line that names a place flies there', () => {
  const entries = [
    { tick: 9, year: 44, day: 3, weight: 3, kind: 'god', planet: 0, text: 'Year 44. Of Aru, the house of Hesh came through the Flood of Aru whole: nine of them.', refs: [{ kind: 'settlement', id: 1 }] },
    { tick: 8, year: 44, day: 2, weight: 1, kind: 'god', planet: 1, text: 'The water came at night.', refs: [{ kind: 'settlement', id: 5 }] },
  ];
  assert.deepEqual(paragraphPlace(STORY.ages[0].paragraphs[1], entries as never, 0), { kind: 'settlement', id: 1, planet: 0 });
  assert.equal(paragraphPlace(STORY.ages[0].paragraphs[0], entries as never, 0), null); // another world's line
  assert.equal(paragraphPlace('And so it is now.', entries as never, 0), null);
});

test('the HUD age line, the title card, and when the card shows (a new age; never on load, a new world or a rewind)', () => {
  assert.deepEqual(ageLine({ id: 4, name: 'The Age of the Bow', kind: 'covenant', since: 1000 }, 212), { name: 'The Age of the Bow', since: 'since year 212' });
  assert.equal(ageLine(null, null), null);
  assert.deepEqual(titleCard('The Scattering at Kel-Amar'), { pre: 'Here begins', name: 'The Scattering at Kel-Amar', post: '.' });
  const w = new AgeWatch();
  const A = (id: number, name = `Age ${id}`) => ({ id, name, kind: 'x', since: 0 });
  assert.equal(w.step('w1', 0, A(1), 100), null);     // the first age seen on a world: no card
  assert.equal(w.step('w1', 0, A(1), 101), null);
  assert.equal(w.step('w1', 0, A(2, 'The Age of the Bow'), 102), 'The Age of the Bow');
  assert.equal(w.step('w1', 0, undefined, 103), null); // a snapshot without the field changes nothing
  assert.equal(w.step('w1', 0, A(2), 104), null);
  assert.equal(w.step('w2', 0, A(3), 105), null);     // another world
  assert.equal(w.step('w2', 0, A(4), 50), null);      // a rewind / load: starts over
  assert.equal(w.step('w2', 0, A(5), 51), 'Age 5');
  assert.equal(w.step('w2', 0, A(6), 51 + 10 * 1440), null); // a jump forward (a load of a later save)
});

test('the save card shows the age and the epithet; the title\'s Continue line names the age and year', () => {
  assert.equal(saveStoryLine({ age: 'The Age of the Bow', epithet: 'the Patient' }), 'The Age of the Bow · they call you the Patient');
  assert.equal(saveStoryLine({}), '');
  assert.equal(continueLine({ age: 'The Age of the Bow', calendar: 'Year 212 · spring · day 3 · 14:20' }), 'the Age of the Bow, year 212');
  assert.equal(continueLine({ calendar: 'Year 3' }), null);
  const saves = readFileSync(new URL('../src/ui/saves.ts', import.meta.url), 'utf8');
  assert.match(saves, /age: pv\.age\.name/);
  assert.match(saves, /epithet: pv\.epithet/);
});

test('words that open the Book (§6.5 open-book), a town named after "of"', () => {
  assert.deepEqual(openBookIntent('tell me our story'), { open: true, town: null });
  assert.deepEqual(openBookIntent('Read the story of Aru'), { open: true, town: 'Aru' });
  assert.deepEqual(openBookIntent('what kind of god am I?'), { open: true, town: null });
  assert.deepEqual(openBookIntent('what kind of people are they'), { open: true, town: null });
  assert.equal(openBookIntent('flood Aru').open, false);
  assert.equal(openBookIntent('make it rain on the story-teller').open, false);
});

test('the stub answers query(story) for the world, and a town\'s own book only when it was stubbed', () => {
  arcStub('story', STORY);
  assert.equal((arcStubQuery('story', { planet: 0 }) as StoryView).title, STORY.title);
  assert.equal(arcStubQuery('story', { planet: 0, settlement: 1 }), undefined);
  arcStub('story', { planet: 0, settlement: 1, story: { ...STORY, title: 'The Book of Aru' } });
  assert.equal((arcStubQuery('story', { planet: 0, settlement: 1 }) as StoryView).title, 'The Book of Aru');
  assert.equal((arcStubQuery('story', { planet: 0 }) as StoryView).title, STORY.title);
  arcStub('story', null);
  assert.equal(arcStubQuery('story', {}), undefined);
});

test('chronicle.age plays the golden or dark age cue by tone; the UI words keep the voice', () => {
  const ev = (kind: string) => cueFor({ t: 'chronicle.age', planet: 0, tick: 1, data: { age: 1, kind, name: 'x' } } as never)?.cue;
  assert.equal(ev('flood'), 'age.dark');
  assert.equal(ev('brokenvow'), 'age.dark');
  assert.equal(ev('covenant'), 'age.golden');
  assert.equal(ev('plenty'), 'age.golden');
  // the UI's own words for §4/§5 (book.ts): no banned word, no placeholder, no slider number
  const src = readFileSync(new URL('../src/ui/book.ts', import.meta.url), 'utf8');
  const strings = [...src.matchAll(/'([^'\n]{8,})'/g)].map((m) => m[1]).filter((s) => /^[A-Z]/.test(s) && / /.test(s));
  const banned = /\b(babel|eden|noah|thee|thou|thy|unto|behold|smite|hath|doth|garden|genesis)\b/i;
  for (const s of strings) assert.ok(!banned.test(s) && s.length <= 140, s);
});
