// The drawn jelly alphabet (UI.md 5). Pure data: no DOM, so the node probes can import it.
//
// Every glyph is ONE centre-line path on a cap-100 grid: y 10 is the cap line, y 90 the baseline (the 18-unit body stroke then spans
// y 1..99 = the cap height; round letters overshoot to 8 / 92), x runs from 10 to w - 10, integers, commands M L H V C Q only.
// The renderer strokes that line five times (shadow, outline, shade, body, highlight; jelly.css owns the widths). Advance = w + ADV.
// Original drawings: no outline of any existing typeface was traced.

export const CAP = 100;        // the body's cap height in glyph units
export const ADV = 10;         // letter-spacing added to w
export const SPACE_W = 40;     // the advance of a space

/** [w, centre-line path]. Keys are upper case; the renderer folds lower case up. */
export const GLYPHS: Readonly<Record<string, readonly [number, string]>> = {
  A: [78, 'M9 90L14 36C14 22 24 8 39 8C54 8 64 22 64 36L69 90M11 66H67'],
  B: [65, 'M10 90V10H34C47 10 54 18 54 30C54 42 47 50 34 50H10M34 50C49 50 56 59 56 70C56 82 48 90 34 90H10'],
  C: [70, 'M56 28C52 16 44 8 34 8C18 8 8 24 8 50C8 76 18 92 34 92C44 92 52 84 56 72'],
  D: [68, 'M10 10H30C52 10 60 28 60 50C60 72 52 90 30 90H10V10'],
  E: [68, 'M58 10H28Q10 10 10 28V72Q10 90 28 90H58M10 50H48'],
  F: [62, 'M54 10H28Q10 10 10 28V90M10 48H46'],
  G: [72, 'M54 24C50 14 44 8 34 8C18 8 8 24 8 50C8 76 18 92 34 92C50 92 60 80 60 58H38'],
  H: [68, 'M10 10V90M58 10V90M10 50H58'],
  I: [20, 'M10 10V90'],
  J: [54, 'M44 10V60C44 80 36 90 26 90C16 90 10 84 10 74'],
  K: [67, 'M10 10V90M58 10L12 52L58 90'],
  L: [62, 'M10 10V70Q10 90 30 90H54'],
  M: [96, 'M10 90V12L43 64L76 12V90'],
  N: [66, 'M10 90V10L56 90V10'],
  O: [72, 'M36 8C52 8 64 24 64 50C64 76 52 92 36 92C20 92 8 76 8 50C8 24 20 8 36 8'],
  P: [67, 'M10 90V10H36C50 10 58 20 58 34C58 48 50 58 36 58H10'],
  Q: [72, 'M36 8C52 8 64 24 64 50C64 76 52 92 36 92C20 92 8 76 8 50C8 24 20 8 36 8M42 64L64 94'],
  R: [67, 'M10 90V10H36C50 10 58 20 58 33C58 46 50 54 36 54H10M34 54L58 90'],
  S: [62, 'M49 28C47 16 39 9 29 9C17 9 11 17 11 28C11 40 21 46 31 50C43 55 51 60 51 72C51 83 43 91 31 91C19 91 11 84 9 72'],
  T: [64, 'M8 10H56M32 10V90'],
  U: [68, 'M10 10V60C10 80 20 92 34 92C48 92 58 80 58 60V10'],
  V: [64, 'M8 10L32 90L56 10'],
  W: [94, 'M9 10L27 90L47 30L67 90L85 10'],
  X: [66, 'M9 10L57 90M57 10L9 90'],
  Y: [64, 'M8 10L32 52L56 10M32 52V90'],
  Z: [68, 'M12 10H56L12 90H58'],
  0: [70, 'M35 8C50 8 56 26 56 50C56 74 50 92 35 92C20 92 14 74 14 50C14 26 20 8 35 8'],
  1: [70, 'M18 30L36 10V90M18 90H56'],
  2: [70, 'M12 30C12 17 22 8 35 8C49 8 58 17 58 30C58 46 40 62 10 90H60'],
  3: [70, 'M12 24C14 14 22 8 34 8C48 8 56 16 56 28C56 40 48 48 32 48C50 48 60 56 60 68C60 82 50 92 34 92C22 92 14 86 10 76'],
  4: [70, 'M54 10V90M10 72H60M54 10C24 10 10 36 10 72'],
  5: [70, 'M56 10H18L14 46C20 41 28 38 36 38C50 38 58 49 58 64C58 80 49 92 34 92C22 92 14 86 10 76'],
  6: [70, 'M56 14C50 9 42 8 34 8C20 8 10 30 10 66M10 66C10 52 20 42 34 42C48 42 58 52 58 66C58 80 48 92 34 92C20 92 10 80 10 66'],
  7: [70, 'M10 10H58C48 34 40 62 30 90'],
  8: [70, 'M34 9C45 9 54 18 54 30C54 42 45 51 34 51C23 51 14 42 14 30C14 18 23 9 34 9M34 49C47 49 58 58 58 70C58 82 47 91 34 91C21 91 10 82 10 70C10 58 21 49 34 49'],
  9: [70, 'M12 86C18 91 26 92 34 92C48 92 58 70 58 34M58 34C58 48 48 58 34 58C20 58 10 48 10 34C10 20 20 8 34 8C48 8 58 20 58 34'],
  '.': [20, 'M10 84V86'],
  ',': [24, 'M12 84V88Q12 98 8 104'],
  '!': [20, 'M10 10V56M10 84V86'],
  '?': [68, 'M12 28C12 16 22 8 32 8C44 8 52 16 52 28C52 44 30 44 30 62M30 84V86'],
  "'": [20, 'M10 10V30'],
  '-': [40, 'M10 52H30'],
  ':': [20, 'M10 40V42M10 84V86'],
  '/': [52, 'M12 92L40 8'],
  '+': [64, 'M10 50H46M28 32V68'],
  '%': [84, 'M18 24V26M66 74V76M66 10L18 90'],
  '&': [80, 'M62 90L22 36C14 24 22 10 36 10C50 10 54 24 46 36C38 48 12 58 12 72C12 84 22 91 34 91C52 91 62 72 62 56'],
  '#': [76, 'M26 12L20 88M54 12L48 88M10 34H66M8 66H64'],
  '(': [36, 'M26 6C8 26 8 74 26 94'],
  ')': [36, 'M10 6C28 26 28 74 10 94'],
};

/** Everything the set draws, in sheet order. */
export const SET_ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const SET_DIGITS = '0123456789';
export const SET_PUNCT = ".,!?'-:/+%&#()";

/** The glyph for a character (lower case folds up); undefined when the set does not draw it (the caller falls back to system 800). */
export function glyphFor(ch: string): readonly [number, string] | undefined {
  return GLYPHS[ch.toUpperCase()];
}

/** Advance in glyph units of one character (a space is SPACE_W; an undrawn character is undefined). */
export function advanceOf(ch: string): number | undefined {
  if (ch === ' ') return SPACE_W;
  const g = glyphFor(ch);
  return g ? g[0] + ADV : undefined;
}

/** DOM id of a glyph's path in the hidden defs svg (code point, so punctuation is a valid id). */
export const glyphId = (ch: string): string => `jg-${ch.toUpperCase().codePointAt(0)!.toString(16)}`;
