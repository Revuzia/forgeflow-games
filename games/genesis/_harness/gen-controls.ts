// GENESIS — rewrites the generated controls text: CONTROLS.md and public/game_meta.json's controls_keyboard /
// controls_gamepad, from src/ui/controlstext.ts (the same rows as the in-game F1 card). Run after a default binding
// changes: node _harness/gen-controls.ts   (tests/ui-meta.test.ts fails while either is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { controlsMarkdown, metaKeyboard, metaGamepad } from '../src/ui/controlstext.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const metaPath = `${root}public/game_meta.json`;
const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
meta.controls_keyboard = metaKeyboard();
meta.controls_gamepad = metaGamepad();
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
writeFileSync(`${root}CONTROLS.md`, controlsMarkdown());
console.log('wrote CONTROLS.md and public/game_meta.json controls');
