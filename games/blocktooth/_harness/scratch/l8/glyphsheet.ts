// L8 scratch: render every glyph (and a sample of cards) to an HTML contact sheet for the self-critique.
import { writeFileSync } from 'node:fs';
import { GLYPH_IDS, glyphSvg, iconFor, familyColor } from '../../../src/ui/icons.ts';
import { UPGRADES } from '../../../src/data/upgrades.ts';
const cells = GLYPH_IDS.map((id, i) => `<div class="c"><div class="t">${glyphSvg(id, ['#ff6f5e', '#4fb3b0', '#ffd166', '#e63946', '#c9a47a', '#a07ce8'][i % 6], 56)}</div><b>${id}</b></div>`).join('');
const cards = UPGRADES.filter((_, i) => i % 5 === 0).slice(0, 40).map((u) => `<div class="c"><div class="t">${glyphSvg(iconFor(u), familyColor(u), 40)}</div><b>${u.name}</b></div>`).join('');
writeFileSync(process.argv[2], `<!doctype html><html><body style="margin:0;background:#2a6f73;font:11px monospace;color:#fff">
<style>.g{display:flex;flex-wrap:wrap;gap:6px;padding:8px}.c{width:92px;text-align:center}.t{width:64px;height:64px;margin:0 auto;background:#f4ecd8;border:2px solid #1b1426;display:flex;align-items:center;justify-content:center}</style>
<div class="g">${cells}</div><hr><div class="g">${cards}</div></body></html>`);
