// GENESIS — package.json carries the released version (release minor 6: it still said the scaffold's 0.1.0 after 1.0
// shipped). The README's "Release X.Y" line is the source of truth; package.json and its lock must agree with it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('package.json and package-lock.json carry the README release version', () => {
  const m = /\*\*Release (\d+)\.(\d+)/.exec(read('README.md'));
  assert.ok(m, 'the README names its release');
  const want = `${m[1]}.${m[2]}.0`;
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.version, want, 'package.json version');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, want, 'package-lock.json version');
  assert.equal(lock.packages?.['']?.version, want, 'package-lock.json root package version');
});
