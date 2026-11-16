// VALE harness - orch1 W2-E: summarise a w2e_capture output dir (layout findings by kind, truncation list, console, number meter).
//   node _harness/w2e_report.mjs <dir>      (dir holds data/w2e_*.json written by ux_lib Rec.finish)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const files = readdirSync(join(dir, 'data')).filter((f) => f.startsWith('w2e_') && f.endsWith('.json'));
const out = { dir, phases: {} };
for (const f of files) {
  const d = JSON.parse(readFileSync(join(dir, 'data', f), 'utf8'));
  const kinds = {}; const plates = []; const ell = []; const recap = [];
  for (const l of d.layout) {
    const vp = l.file.split('/')[0];
    const k = `${vp} ${l.kind}`; kinds[k] = (kinds[k] ?? 0) + 1;
    if (l.kind === 'outside-viewport-plate' || l.kind === 'outside-viewport') plates.push({ vp, step: l.step, el: l.el, text: l.text, rect: l.rect });
    if (l.kind === 'ellipsis-truncated' || l.kind === 'clipped-x' || l.kind === 'line-clamped') ell.push({ vp, step: l.step, el: l.el, text: l.text });
    if (l.kind === 'recap-over-dialbar') recap.push({ vp, step: l.step, rect: l.rect, dialbar: l.dialbar });
  }
  const errs = d.console.filter((c) => c.type === 'error' || c.type === 'pageerror');
  out.phases[d.phase] = { shots: d.steps.length, kinds, outsideViewport: plates, recapOverDialbar: recap, truncated: ell, consoleErrors: errs.length, consoleErrorSample: errs.slice(0, 4).map((e) => e.text.slice(0, 160)),
    meters: d.notes.filter((n) => /number meter/.test(n.text)).map((n) => ({ step: n.step, text: n.text, ...n.data })), captured: d.notes.find((n) => n.text === 'captured')?.data ?? null };
}
console.log(JSON.stringify(out, null, 1));
