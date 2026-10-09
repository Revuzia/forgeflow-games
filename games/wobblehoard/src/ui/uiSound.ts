// The interface sounds' ONE delegated listener (UI.md 7). Every button, switch, tab, chip and card in the game is mapped to a sound kind by its class and its role, so a
// screen never calls the audio itself: it builds the kit control and the sound follows. A control opts out with `data-sound="none"` (the Menu and the modals play their
// own open / close cues, so their close buttons say none) or picks another kind with `data-sound="back"`. Programmatic cues (a Menu opening from the P key, a toast, a
// trophy) go through `cue()`, which shares the same sink.
//
// Rules this file keeps (the engine keeps the rest: before the first unlock, in a ceremony, muted, with the Settings switch off and the per-kind gap are all its own):
//   * hover is a tick for a MOUSE or a PEN only (`hoverAllowed(pointerType)`, which boot.ts takes from audio/ui.ts `hoverSoundAllowed`): a finger has no hover;
//   * Calm comes from the settings at the moment of the cue (softer, pure sines);
//   * the light haptic tap (`haptics.uiTap`) rides every press and the double pulse every error; it checks the coarse pointer and the Settings switch itself;
//   * a press on a control that says why it cannot act (`aria-disabled="true"`) is the "not that" sound, never a silent dead button.
// Nothing here imports the audio module (it is a lazy chunk); boot.ts hands the sink in.
import type { UiKind } from '../contracts.ts';
import type { UiTapKind } from '../input/haptics.ts';

export interface UiSoundSink {
  /** `SquishAudio.ui` */
  play(p: { kind: UiKind; calm?: boolean }): void;
  /** Settings.calm now */
  calm(): boolean;
  /** `Haptics.uiTap` (optional: older mocks) */
  tap?(kind: UiTapKind): void;
  /** `hoverSoundAllowed` from audio/ui.ts: true for a mouse or a pen */
  hoverAllowed(pointerType: string): boolean;
}

let sink: UiSoundSink | null = null;
/** how many cues reached the sink (the harness reads it through __WH_UI__) */
let cued = 0;
const kinds: Record<string, number> = {};

const HAPTIC: Partial<Record<UiKind, UiTapKind>> = { press: 'tap', select: 'tap', on: 'tap', off: 'tap', open: 'tap', close: 'tap', back: 'tap', error: 'error', trophy: 'trophy' };

/** Play one interface sound (and its haptic tap) from code: the Menu opening, a toast, a trophy. A no-op until boot.ts has attached the sink. */
export function cue(kind: UiKind, o: { haptic?: boolean } = {}): void {
  if (!sink) return;
  cued++; kinds[kind] = (kinds[kind] ?? 0) + 1;
  try { sink.play({ kind, calm: sink.calm() }); } catch (e) { console.error(e); }
  const t = HAPTIC[kind];
  if (t && o.haptic !== false) { try { sink.tap?.(t); } catch { /* ignore */ } }
}

export function uiSoundStats(): { cues: number; kinds: Readonly<Record<string, number>> } { return { cues: cued, kinds: { ...kinds } }; }

/** What counts as a control for the hover tick and the click cue. */
const CONTROL = 'button, [role="button"], [role="tab"], [role="switch"], a[href], label.k-switch, label.k-seg-opt, label.seg-opt, label.row-switch, .k-card[data-selectable], summary';

/** The kind a click on `el` makes (`null` = silent). Exported for the checks. */
export function kindOfControl(el: Element): UiKind | null {
  const own = el.closest('[data-sound]')?.getAttribute('data-sound');
  if (own === 'none') return null;
  if (own) return own as UiKind;
  if (el.matches('[aria-disabled="true"], :disabled')) return 'error';
  if (el.closest('[role="tab"], .seg-btn')) return 'select';   // a tab or a segment makes the same sound whether or not it is the selected (gel) one
  if (el.closest('.k-gel, .cta')) return 'press';
  if (el.closest('.hoard-btn, [aria-haspopup]')) return 'open';
  if (el.closest('[aria-label^="Close"], .k-close')) return 'close';
  return 'select';
}

export function attachUiSound(doc: Document, s: UiSoundSink): () => void {
  sink = s;
  const controlOf = (t: EventTarget | null): Element | null => (t instanceof Element ? t.closest(CONTROL) : null);
  const onClick = (e: Event): void => {
    const c = controlOf(e.target);
    if (!c) return;
    // a switch and a segmented radio make their sound on `change` (they know on / off); their label's click is skipped here
    if (c.matches('label.k-switch, label.k-seg-opt, label.seg-opt, label.row-switch, [role="switch"]')) return;
    const k = kindOfControl(c);
    if (k) cue(k);
  };
  const onChange = (e: Event): void => {
    const t = e.target;
    if (t instanceof HTMLSelectElement) { if (t.closest('[data-sound="none"]') === null) cue('select'); return; }   // the Hoard's Sort
    if (!(t instanceof HTMLInputElement)) return;
    const own = t.closest('[data-sound]')?.getAttribute('data-sound');
    if (own === 'none') return;
    if (t.type === 'checkbox' && (t.getAttribute('role') === 'switch' || t.closest('.k-switch, .row-switch'))) cue(t.checked ? 'on' : 'off');
    else if (t.type === 'radio') cue('select');
  };
  const onInput = (e: Event): void => {
    const t = e.target;
    if (t instanceof HTMLInputElement && t.type === 'range' && t.closest('[data-sound]')?.getAttribute('data-sound') !== 'none') cue('tick', { haptic: false });
  };
  // hover: one tick as the pointer ENTERS a control (not on every child it crosses)
  const onOver = (e: Event): void => {
    const pe = e as PointerEvent;
    if (!s.hoverAllowed(pe.pointerType ?? '')) return;
    const c = controlOf(e.target);
    if (!c || c.contains(pe.relatedTarget as Node | null)) return;
    if (c.matches('[aria-disabled="true"], :disabled') || c.closest('[data-sound="none"]')) return;
    cue('tick', { haptic: false });
  };
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('change', onChange, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('pointerover', onOver, true);
  return () => {
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('change', onChange, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('pointerover', onOver, true);
    if (sink === s) sink = null;
  };
}
