// The merge pad and Tidy-up (MERGE.md 3.1, 3.3, 7; COLLECTION 9.3 "Merge").
//
//   Pad: the inputs are chosen for you (the newest copies that are not hearted, resting or the keeper); a slot can be swapped for another
//   copy, with the reason in text on copies that cannot go in. Before anything is sent: the odds lines (copy.ts mergePreviewLines: the
//   tier-up chance and why, pity, what you still lack, the lock, merges today), every possible result with its exact chance and a NEW
//   tag, and the last-copy warning (a modal, focus on Cancel). Hold 0.5 s to merge; letting go early sends nothing. Then, result first:
//   collection.merge(ids, digest) -> if ok, the pad closes and the ceremony plays the stored result (env.playMerge). A stale preview
//   ('odds_changed') shows the fresh odds and "The odds changed. Have another look."; other refusals say which copy and why.
//   Tidy-up: one plan (Common and Uncommon by default; a switch adds Rare and above), one hold, the merges run one by one and stop at
//   the first refusal; the full ceremony plays for the best result only (MERGE M-5) and the rest are listed.
import type { TierName } from '../../contracts.ts';
import { COPY, lastCopyCopy, mergePreviewLines, mergeRuleCopy, tidyCapCopy, tidyNoteCopy, unpickableChip } from '../../collection/copy.ts';
import type { HoardItem, MergeOk, MergePreviewResult, MergeResult, TidyResult } from '../../collection/types.ts';
import { h, icon } from '../dom.ts';
import { createHoldButton } from './hold.ts';
import type { HoardEnv } from './types.ts';

export interface MergePad {
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(species: string, opener?: HTMLElement | null): void;
  openTidy(opener?: HTMLElement | null): void;
  /** silent: do not move focus back to the opener */
  close(silent?: boolean): void;
  escape(): boolean;
  refresh(): void;
  destroy(): void;
}

const pct = (p: number): string => { const v = p * 100; return v >= 10 || Number.isInteger(v) ? `${Math.round(v * 10) / 10}%` : `${v.toFixed(v < 1 ? 2 : 1)}%`; };

export function createMergePad(root: HTMLElement, env: HoardEnv, o: { onMerged(): void; onClosed(focusBack: HTMLElement | null): void }): MergePad {
  const c = env.collection;
  let mode: 'merge' | 'tidy' | null = null;
  let species = '';
  let ids: string[] = [];
  let picking = -1;
  let confirmedLast = false;
  let waiting = false;
  let message = '';
  let opener: HTMLElement | null = null;
  let includeRare = false;
  let tidyDone: TidyResult | null = null;

  const el = h('div', { class: 'hmerge', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-merge-title', hidden: '' } });
  const scrim = h('div', { class: 'hmerge-scrim', attrs: { hidden: '' } });
  scrim.addEventListener('click', () => { if (!waiting) pad.close(); });
  root.append(scrim, el);
  const status = h('p', { class: 'hmerge-status', attrs: { role: 'status', 'aria-live': 'polite' } });

  const hold = createHoldButton(COPY.holdToMerge, env.holdMs, () => { void doMerge(); }, 'hold-btn');
  const tidyHold = createHoldButton('Hold to tidy up', env.holdMs, () => { void doTidy(); }, 'hold-btn');

  const now = (): number => env.now();
  const copiesOf = (sp: string): HoardItem[] => c.items().filter((it) => it.species === sp).sort((a, b) => b.bornAt - a.bornAt);
  const whyNot = (it: HoardItem): string | null => {
    if (it.fav) return unpickableChip('favourite');
    if (it.reserved) return unpickableChip('reserved');
    if (it.offered) return unpickableChip('offered');
    if (it.lockedUntil !== null && it.lockedUntil > now()) return unpickableChip('locked', it.lockedUntil - now());
    return null;
  };
  const keeperOf = (sp: string): string | null => c.stacks().find((s) => s.species === sp)?.keeper ?? null;

  function defaults(sp: string): string[] {
    const d = c.mergeInputs(sp as never);
    if (d) return d.slice();
    // too few spares: the keeper may go in too (a last-copy merge, behind the warning)
    const k = keeperOf(sp);
    const ok = copiesOf(sp).filter((it) => !whyNot(it)).sort((a, b) => (a.id === k ? 1 : b.id === k ? -1 : 0));
    return ok.slice(0, env.mergeCost).map((it) => it.id);
  }

  function header(text: string): HTMLElement {
    const x = h('button', { class: 'icon-btn small', attrs: { type: 'button', 'aria-label': 'Close' } }, icon('close'));
    x.addEventListener('click', () => { if (!waiting) pad.close(); });
    return h('div', { class: 'hmerge-head' }, h('h2', { class: 'hmerge-title', text, attrs: { id: 'wh-merge-title', tabindex: '-1' } }), x);
  }

  function preview(): MergePreviewResult | null { return ids.length === env.mergeCost ? c.previewMerge(ids) : null; }

  function renderMerge(): void {
    const keep = document.activeElement && el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.key ?? null : null;
    el.textContent = '';
    const st = c.stacks().find((s) => s.species === species);
    const name = st?.name ?? species;
    el.append(header(`Merge ${name}`), h('p', { class: 'hmerge-rule', text: mergeRuleCopy() }));
    // the slots
    const slots = h('div', { class: 'hmerge-slots' });
    for (let i = 0; i < env.mergeCost; i++) {
      const it = ids[i] ? c.item(ids[i]) : null;
      const b = h('button', { class: 'slot', attrs: { type: 'button', 'aria-expanded': String(picking === i), 'data-key': `slot-${i}`, 'aria-label': it ? `Slot ${i + 1}: ${it.name}${it.id === keeperOf(species) ? ', your keeper' : ''}. Change it.` : `Slot ${i + 1}: empty. Pick a copy.` } },
        it ? env.swatch(it) : h('span', { class: 'slot-empty', text: '?' }), h('span', { class: 'slot-word', text: it ? (it.id === keeperOf(species) ? 'Keeper' : 'Spare') : 'Pick one' }), h('span', { class: 'slot-change', text: 'Change' }));
      b.disabled = waiting;
      b.addEventListener('click', () => { picking = picking === i ? -1 : i; renderMerge(); });
      slots.append(b);
      if (i < env.mergeCost - 1) slots.append(h('span', { class: 'slot-plus', text: '+', attrs: { 'aria-hidden': 'true' } }));
    }
    el.append(slots);
    if (picking >= 0) {
      const list = h('div', { class: 'hmerge-pick', attrs: { role: 'listbox', 'aria-label': `Copies for slot ${picking + 1}` } });
      for (const it of copiesOf(species)) {
        const why = whyNot(it);
        const used = ids.includes(it.id);
        const b = h('button', { class: 'pick', attrs: { type: 'button', role: 'option', 'aria-selected': String(ids[picking] === it.id), 'data-key': `pick-${it.id}` } },
          env.swatch(it), h('span', { class: 'pick-word', text: it.id === keeperOf(species) ? 'Keeper' : 'Spare' }), why ? h('span', { class: 'pick-why', text: why }) : used ? h('span', { class: 'pick-why', text: 'In a slot' }) : null);
        b.disabled = !!why || (used && ids[picking] !== it.id);
        b.addEventListener('click', () => { ids[picking] = it.id; picking = -1; confirmedLast = false; message = ''; renderMerge(); el.querySelector<HTMLElement>('[data-key="slot-0"]')?.focus(); });
        list.append(b);
      }
      el.append(list);
    }
    const pv = preview();
    const body = h('div', { class: 'hmerge-body' });
    let canHold = false;
    if (!pv) body.append(h('p', { class: 'hmerge-warn', text: `Pick ${env.mergeCost === 2 ? 'two' : env.mergeCost} copies.` }));
    else if (!pv.ok) body.append(h('p', { class: 'hmerge-warn', text: pv.message ?? COPY.somethingWrong }));
    else {
      const lines = mergePreviewLines(pv.preview, pv.mergesToday);
      const ul = h('ul', { class: 'hmerge-lines' });
      lines.forEach((t, i) => ul.append(h('li', { class: i === 0 ? 'lead' : '', text: t })));
      body.append(ul);
      const outs = h('ul', { class: 'hmerge-outs', attrs: { 'aria-label': 'What it can become' } });
      for (const r of pv.preview.outcomes) {
        const w = env.species(r.species);
        const tierWord = env.tiers.find((t) => t.id === r.tier)?.label ?? r.tier;
        outs.append(h('li', { class: 'out', attrs: { 'data-up': String(r.tier !== pv.preview.stayTier) } },
          env.icon(r.species, { cls: 'sp-icon out-icon' }), env.gem(r.tier as TierName, 'gem gem-sm'),
          h('span', { class: 'out-name', text: w?.name ?? r.species }), h('span', { class: 'out-tier', text: tierWord }),
          r.isNew ? h('span', { class: 'out-new', text: 'NEW' }) : null, h('span', { class: 'out-p', text: pct(r.probability) })));
      }
      body.append(h('p', { class: 'hmerge-sub', text: 'What it can become' }), outs);
      if (pv.mergesLeft <= 0) body.append(h('p', { class: 'hmerge-warn', text: `${pv.mergesToday} merges today. They're resting until tomorrow.` }));
      else canHold = !pv.preview.usesLastCopy || confirmedLast;
      if (pv.preview.usesLastCopy && !confirmedLast && pv.mergesLeft > 0) queueMicrotask(() => { if (mode === 'merge' && !waiting) lastCopyModal(name); });
    }
    el.append(body);
    hold.setDisabled(!canHold || waiting);
    hold.setLabel(waiting ? 'Merging…' : COPY.holdToMerge);
    hold.el.dataset.key = 'hold';
    status.textContent = message;
    el.append(h('div', { class: 'hmerge-foot' }, hold.el, h('p', { class: 'hmerge-help', text: 'Press and hold. Let go early and nothing happens.' })), status);
    if (keep) el.querySelector<HTMLElement>(`[data-key="${keep}"]`)?.focus();
  }

  let modal: HTMLElement | null = null;
  function lastCopyModal(name: string): void {
    if (modal) return;
    const cancel = h('button', { class: 'act-btn', text: 'Cancel', attrs: { type: 'button' } });
    const go = h('button', { class: 'act-btn primary', text: 'Merge anyway', attrs: { type: 'button' } });
    modal = h('div', { class: 'hmodal', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-last-copy' } },
      h('p', { class: 'hmodal-text', text: lastCopyCopy(name), attrs: { id: 'wh-last-copy' } }), h('div', { class: 'hmodal-acts' }, cancel, go));
    const done = (yes: boolean): void => {
      modal?.remove(); modal = null;
      if (yes) { confirmedLast = true; renderMerge(); el.querySelector<HTMLElement>('[data-key="hold"]')?.focus(); }
      else { ids = defaults(species).filter((id) => id !== keeperOf(species)); renderMerge(); el.querySelector<HTMLElement>('[data-key="slot-0"]')?.focus(); }
    };
    cancel.addEventListener('click', () => done(false));
    go.addEventListener('click', () => done(true));
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === cancel ? go : cancel).focus(); }
    });
    el.append(modal);
    cancel.focus();
  }

  async function doMerge(): Promise<void> {
    const pv = preview();
    if (!pv || !pv.ok || waiting) return;
    waiting = true; message = ''; renderMerge();
    const slow = setTimeout(() => { if (waiting) { message = COPY.takingAMoment; status.textContent = message; } }, 8000);
    let r: MergeResult;
    try { r = await c.merge(ids, pv.digest); } catch { r = { ok: false, ledger: c.ledger, error: 'unavailable', message: COPY.somethingWrong }; }
    clearTimeout(slow);
    waiting = false;
    if (!r.ok) {
      message = r.message ?? COPY.somethingWrong;
      if (r.error === 'odds_changed') { message = COPY.oddsChanged; confirmedLast = false; }
      if (r.error === 'not_yours' || r.error === 'locked' || r.error === 'favourite') ids = defaults(species);
      renderMerge();
      env.announce(message);
      el.querySelector<HTMLElement>('[data-key="hold"]')?.focus();
      return;
    }
    pad.close(true);
    o.onMerged();
    await env.playMerge(r);
  }

  /* ─────────────── Tidy-up ─────────────── */
  function renderTidy(): void {
    el.textContent = '';
    el.append(header('Tidy up'));
    if (tidyDone) {
      const ok = tidyDone.results.filter((r): r is MergeOk => r.ok);
      el.append(h('p', { class: 'hmerge-rule', text: ok.length ? `${ok.length === 1 ? 'One merge' : `${ok.length} merges`} done.` : 'Nothing was merged.' }));
      const ul = h('ul', { class: 'hmerge-outs' });
      tidyDone.results.forEach((r, i) => {
        if (!r.ok) { ul.append(h('li', { class: 'out stop', text: r.message ?? COPY.somethingWrong })); return; }
        const from = r.parents[0]?.name ?? '';
        const tierWord = env.tiers.find((t) => t.id === r.item.tier)?.label ?? r.item.tier;
        ul.append(h('li', { class: 'out', attrs: { 'data-best': String(i === tidyDone!.best) } },
          h('span', { class: 'out-from', text: `${from} →` }), env.icon(r.item.species, { cls: 'sp-icon out-icon' }), env.gem(r.item.tier as TierName, 'gem gem-sm'),
          h('span', { class: 'out-name', text: r.item.name }), h('span', { class: 'out-tier', text: tierWord }),
          r.is_new ? h('span', { class: 'out-new', text: 'NEW' }) : null, r.tier_up ? h('span', { class: 'out-up', text: 'TIER UP' }) : null));
      });
      const doneBtn = h('button', { class: 'cta-btn', text: 'Done', attrs: { type: 'button', 'data-key': 'done' } });
      doneBtn.addEventListener('click', () => pad.close());
      el.append(ul, doneBtn);
      return;
    }
    const left = c.practice().mergeCap - c.practice().mergesToday;
    const plan = c.tidyPlan({ includeRare });
    el.append(h('p', { class: 'hmerge-rule', text: `Merges your spare ${includeRare ? '' : 'Common and Uncommon '}squishies in pairs of the same kind. Hearted copies and your keepers are never touched.` }));
    const tog = h('label', { class: 'hmerge-toggle' });
    const cb = h('input', { attrs: { type: 'checkbox', 'data-key': 'rare' } }) as HTMLInputElement;
    cb.checked = includeRare;
    cb.addEventListener('change', () => { includeRare = cb.checked; renderTidy(); el.querySelector<HTMLElement>('[data-key="rare"]')?.focus(); });
    tog.append(cb, h('span', { text: 'Include Rare and above' }));
    el.append(tog);
    if (!plan.length) {
      el.append(h('p', { class: 'hmerge-warn', text: left <= 0 ? `${c.practice().mergeCap} merges today. They're resting until tomorrow.` : COPY.noSpares }));
    } else {
      const groups = new Map<string, string[][]>();
      for (const pair of plan) { const it = c.item(pair[0]); const k = it?.species ?? '?'; groups.set(k, [...(groups.get(k) ?? []), pair]); }
      const ul = h('ul', { class: 'hmerge-outs' });
      for (const [sp, pairs] of groups) {
        const it = c.item(pairs[0][0]);
        const pv = c.previewMerge(pairs[0]);
        const odds = pv.ok ? mergePreviewLines(pv.preview, pv.mergesToday)[0] : '';
        ul.append(h('li', { class: 'out' }, env.icon(sp, { cls: 'sp-icon out-icon' }), it ? env.gem(it.tier as TierName, 'gem gem-sm') : null,
          h('span', { class: 'out-name', text: it?.name ?? sp }), h('span', { class: 'out-tier', text: pairs.length === 1 ? '1 merge' : `${pairs.length} merges` }),
          h('span', { class: 'out-odds', text: odds })));
      }
      el.append(ul, h('p', { class: 'hmerge-sub', text: `${tidyCapCopy(left)}. ${tidyNoteCopy}` }));
    }
    tidyHold.setDisabled(!plan.length || waiting);
    tidyHold.setLabel(waiting ? 'Tidying…' : 'Hold to tidy up');
    el.append(h('div', { class: 'hmerge-foot' }, tidyHold.el, h('p', { class: 'hmerge-help', text: 'Press and hold. Let go early and nothing happens.' })), status);
  }

  async function doTidy(): Promise<void> {
    if (waiting) return;
    const plan = c.tidyPlan({ includeRare });
    if (!plan.length) return;
    waiting = true; renderTidy();
    let r: TidyResult;
    try { r = await c.tidy(plan); } catch { r = { ok: false, ledger: c.ledger, results: [], done: 0, best: null, error: 'unavailable' }; }
    waiting = false;
    tidyDone = r;
    const best = r.best !== null ? r.results[r.best] : null;
    env.announce(r.done ? `Tidied up: ${r.done === 1 ? 'one merge' : `${r.done} merges`}.` : 'Nothing was merged.');
    if (best && best.ok) {
      // the full ceremony for the best result only (MERGE M-5); the list of every result comes back after it
      o.onMerged();
      await env.playMerge(best);
      mode = 'tidy'; el.hidden = false; scrim.hidden = false; el.dataset.mode = 'tidy';
      renderTidy();
      el.querySelector<HTMLElement>('[data-key="done"]')?.focus();
      return;
    }
    renderTidy();
    el.querySelector<HTMLElement>('[data-key="done"]')?.focus();
  }

  const pad: MergePad = {
    el,
    get isOpen() { return mode !== null && !el.hidden; },
    open(sp, from) {
      mode = 'merge'; species = sp; ids = defaults(sp); picking = -1; confirmedLast = false; message = ''; opener = from ?? null; tidyDone = null;
      el.hidden = false; scrim.hidden = false; el.dataset.mode = 'merge';
      renderMerge();
      requestAnimationFrame(() => { if (!modal) el.querySelector<HTMLElement>('#wh-merge-title')?.focus(); });
    },
    openTidy(from) {
      mode = 'tidy'; opener = from ?? null; tidyDone = null; message = '';
      el.hidden = false; scrim.hidden = false; el.dataset.mode = 'tidy';
      renderTidy();
      requestAnimationFrame(() => el.querySelector<HTMLElement>('#wh-merge-title')?.focus());
    },
    close(silent = false) {
      if (mode === null) return;
      hold.cancel(); tidyHold.cancel();
      modal?.remove(); modal = null;
      mode = null; el.hidden = true; scrim.hidden = true;
      if (!silent) o.onClosed(opener);
    },
    escape() {
      if (mode === null) return false;
      if (modal) { modal.querySelector<HTMLButtonElement>('button')?.click(); return true; }
      if (!waiting) pad.close();
      return true;
    },
    refresh() { if (mode === 'merge' && !waiting && !el.hidden) renderMerge(); },
    destroy() { pad.close(true); el.remove(); scrim.remove(); },
  };
  return pad;
}
