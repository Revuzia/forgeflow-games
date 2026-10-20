// GENESIS — the site's frame (UI lane; parity audit B4): a saved world the frame would not download is offered as a
// page of text (gzip + base64 between two marker lines) that Saves reads back — byte for byte, from the plain text or
// from the page saved as HTML; anything else is not mistaken for one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { savedWorldText, savedWorldFromText } from '../src/ui/embed.ts';

test('a saved world kept as text comes back byte for byte (plain, and inside a saved HTML page)', async () => {
  const bytes = new Uint8Array(200_000);
  let x = 12345;
  for (let i = 0; i < bytes.length; i++) { x = (x * 1103515245 + 12345) >>> 0; bytes[i] = i % 7 === 0 ? x >>> 24 : i & 0xff; }
  const text = await savedWorldText('Gaia, year 3', new Blob([bytes]));
  assert.match(text, /^GENESIS saved world: Gaia, year 3\n/);
  assert.match(text, /encoding: gzip\+base64/);
  assert.ok(text.split('\n').every((l) => l.length <= 140), 'short lines: a browser shows them, a page keeps them');
  const back = new Uint8Array((await savedWorldFromText(text))!);
  assert.equal(back.length, bytes.length);
  assert.ok(back.every((b, i) => b === bytes[i]), 'the same bytes');
  const html = `<!doctype html><html><head><title>x</title></head><body><header>Gaia</header><main><pre>${text.replace(/"/g, '&quot;')}</pre></main></body></html>`;
  const back2 = new Uint8Array((await savedWorldFromText(html))!);
  assert.ok(back2.length === bytes.length && back2.every((b, i) => b === bytes[i]), 'from the page saved as HTML');
});

test('text that is not a saved world is not one', async () => {
  assert.equal(await savedWorldFromText('hello'), null);
  assert.equal(await savedWorldFromText('-----END GENESIS SAVED WORLD-----\n-----BEGIN GENESIS SAVED WORLD-----'), null);
});
