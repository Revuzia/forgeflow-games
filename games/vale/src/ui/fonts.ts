// VALE UI — fonts (bible §Type; tokens.type.loading). Four OFL faces from @fontsource (5.3.0):
//   display  Gloock 400                        font-display: block, 300 ms budget (results, titles)
//   heading  Instrument Sans Variable (wght 400–700, wdth 75–100)   swap
//   body     Atkinson Hyperlegible Next 400/500/600/700              swap
//   numeric  Atkinson Hyperlegible Mono 500/700/800                  swap
// Preloaded before first paint (within the block budget): display 400, body 400, body 600, numeric 700.
// Size-adjusted local fallbacks ('Vale <Role> Fallback', styles/base.css) keep layout from jumping.

import '@fontsource-variable/instrument-sans/standard.css';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/500.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/500.css';
import '@fontsource/atkinson-hyperlegible-mono/700.css';
import '@fontsource/atkinson-hyperlegible-mono/800.css';
import gloockLatin from '@fontsource/gloock/files/gloock-latin-400-normal.woff2?url';
import gloockLatinExt from '@fontsource/gloock/files/gloock-latin-ext-400-normal.woff2?url';
import { TOKENS } from './tokens.ts';

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

let started: Promise<void> | null = null;

/** register the display face (block) and preload the critical faces; resolves within the block budget */
export function loadFonts(): Promise<void> {
  if (started) return started;
  if (typeof document === 'undefined' || !('fonts' in document)) return (started = Promise.resolve());
  const faces = [
    new FontFace('Gloock', `url(${gloockLatin}) format('woff2')`, { weight: '400', display: 'block', unicodeRange: LATIN }),
    new FontFace('Gloock', `url(${gloockLatinExt}) format('woff2')`, { weight: '400', display: 'block', unicodeRange: LATIN_EXT }),
  ];
  for (const f of faces) document.fonts.add(f);
  const loads = [
    faces[0].load(),
    document.fonts.load('400 16px "Atkinson Hyperlegible Next"'),
    document.fonts.load('600 16px "Atkinson Hyperlegible Next"'),
    document.fonts.load('700 16px "Atkinson Hyperlegible Mono"'),
    document.fonts.load('600 15px "Instrument Sans Variable"'),
  ].map((p) => p.catch(() => undefined));
  const budget = new Promise<void>((ok) => setTimeout(ok, TOKENS.type.loading.blockBudgetMs));
  started = Promise.race([Promise.all(loads).then(() => undefined), budget]);
  return started;
}
