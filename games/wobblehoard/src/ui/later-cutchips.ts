// D-103 (owner 2026-11-23: several squishies can be cut at the same time): RECONNECT ONE. While two or more squishies are in pieces, the Cut bar shows a row of chips, one per
// cut squishy: the join mark (the same one as Reconnect all), its face, and how many pieces it is in. A tap puts THAT squishy back together (Cutter.reconnect); Reconnect all
// still does everyone. With one squishy cut the row is not there (Reconnect all is that chip), so the published bar is unchanged.
// Part of the later-play chunk (ui/later-play.ts imports it): no first-play bytes. Every word comes in through `labels` (the shell's cutText.ts is their home).
//
// DOM contract (the harness finds things by these): .cutbar > .cutbar-chips[role=group] (between the hint line and the buttons) > button.cutbar-chip[data-key=chip][data-id=<the squishy's key>].
// A chip is aria-disabled (not `disabled`: it keeps the focus) while a cut or a join of ITS squishy plays; the others stay live.
import type { Game } from '../shell/game.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { speciesIcon } from './speciesIcon.ts';
import './cutchips.css';

export interface CutChipLabels {
  /** the row's accessible name */
  group: string;
  /** the row's small visible word (wide layouts) */
  lead: string;
  /** a chip's accessible name: the squishy's name and its pieces */
  chip(name: string, pieces: number): string;
  /** said when a chip reconnects at once (Skip animations: the cutter itself is silent then) */
  whole(name: string): string;
}

export function attachCutChips(o: { game: Game; labels: CutChipLabels; say(text: string): void }): { destroy(): void } {
  const g = o.game, L = o.labels;
  const bar = document.querySelector<HTMLElement>('.cutbar');
  if (!bar) return { destroy() { /* no Cut bar on this page */ } };
  const lead = h('span', { class: 'cutbar-chips-lead', text: L.lead, attrs: { 'aria-hidden': 'true' } });
  const row = h('div', { class: 'cutbar-chips', attrs: { role: 'group', 'aria-label': L.group, hidden: '' } }, lead);
  const acts = bar.querySelector('.cutbar-acts');
  if (acts) bar.insertBefore(row, acts); else bar.append(row);

  let key = '';
  function render(): void {
    const rows = g.cut.sets;
    let n = 0;
    if (rows && g.tool === 'cut') for (let i = 0; i < rows.length; i++) if (rows[i].pieces > 1) n++;
    if (n < 2) { if (key !== '') { key = ''; row.hidden = true; row.replaceChildren(lead); } return; }
    let k = '';
    for (let i = 0; i < rows!.length; i++) { const r = rows![i]; if (r.pieces > 1) k += `${r.key}:${r.pieces}:${r.busy ? 1 : 0}|`; }
    if (k === key) return;
    key = k;
    const focused = document.activeElement instanceof HTMLElement && row.contains(document.activeElement) ? document.activeElement.dataset.id ?? null : null;
    const chips: HTMLElement[] = [];
    for (let i = 0; i < rows!.length; i++) {
      const r = rows![i];
      if (r.pieces <= 1) continue;
      const b = h('button', { class: 'k-chip cutbar-chip', attrs: { type: 'button', 'data-key': 'chip', 'data-id': r.key, 'aria-label': L.chip(r.name, r.pieces), 'aria-disabled': String(r.busy), title: L.chip(r.name, r.pieces) } },
        h('span', { class: 'cutbar-chip-join', attrs: { 'aria-hidden': 'true' } }, icon('join')),
        speciesIcon(r.species || 'dollop', { cls: 'sp-icon cutbar-chip-face' }),
        h('span', { class: 'cutbar-chip-name', text: r.name, attrs: { 'aria-hidden': 'true' } }),
        h('span', { class: 'k-chip-n cutbar-chip-n', text: String(r.pieces), attrs: { 'aria-hidden': 'true' } }));
      chips.push(b);
    }
    row.replaceChildren(lead, ...chips);
    row.hidden = false;
    if (focused !== null) (chips.find((c) => c.dataset.id === focused) ?? chips[0])?.focus({ preventScroll: true });
  }
  row.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cutbar-chip');
    if (!b || b.getAttribute('aria-disabled') === 'true') return;
    const id = b.dataset.id ?? '', animated = !g.settings.skipAnimations;
    const name = b.querySelector('.cutbar-chip-name')?.textContent ?? '';
    let ok = false;
    try { ok = g.cut.reconnect?.(id, animated) === true; } catch { ok = false; }
    if (ok && !animated) o.say(L.whole(name));
    render();
  });
  const offs = [g.onStep(render), g.on('tool', () => render())];
  render();
  return { destroy() { for (const f of offs) f(); row.remove(); } };
}
