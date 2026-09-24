// DYEFIELD — boot cards (CONTRACT §5.1 ui/boot.ts): loading card (wordmark DYEFIELD, mode line
// "Harbor Cup • 4 v 4", progress) → CLICK TO PLAY (pointer lock) → play. The error card shows the
// message and never leaves a blank canvas. After 2+ pointerlockerrors with zero successful locks
// ever, the play card swaps to the "mouse capture blocked" message (doctrine §6).
// index.html paints the same loading card statically before the module graph runs; this class
// adopts it (#df-boot) so there is no flash between the two.

export const MODE_LINE = 'Harbor Cup • 4 v 4';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function wordmark(): HTMLElement {
  const h = el('h1', 'df-wordmark');
  h.setAttribute('aria-label', 'DYEFIELD');
  const a = el('span', 'dye', 'DYE');
  const b = el('span', 'field', 'FIELD');
  h.append(a, b);
  return h;
}

function modeLine(): HTMLElement {
  const p = el('p', 'df-mode');
  const m1 = el('i', '', '◉'); m1.setAttribute('aria-hidden', 'true');
  const m2 = el('i', 'g', '▲'); m2.setAttribute('aria-hidden', 'true');
  p.append(m1, el('span', '', MODE_LINE), m2);
  return p;
}

export type BootCard = 'loading' | 'play' | 'blocked' | 'error' | 'none';

export class BootUI {
  readonly root: HTMLElement;
  card: BootCard = 'loading';
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;
  private readonly box: HTMLElement;
  private shown = 0;

  constructor() {
    const existing = document.getElementById('df-boot');
    if (existing) {
      this.root = existing;
      this.box = existing.querySelector('.df-card') as HTMLElement ?? existing;
      this.bar = existing.querySelector('.df-progress b') as HTMLElement ?? el('b');
      this.status = existing.querySelector('.df-status') as HTMLElement ?? el('div');
    } else {
      this.root = el('div', 'df-boot');
      this.root.id = 'df-boot';
      this.box = el('div', 'df-card');
      const prog = el('div', 'df-progress');
      this.bar = el('b');
      prog.append(this.bar);
      this.status = el('div', 'df-status', 'Loading…');
      this.box.append(wordmark(), modeLine(), prog, this.status);
      this.root.append(this.box);
      document.body.append(this.root);
    }
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
  }

  /** f in 0..1 (monotonic: never moves backwards) */
  progress(f: number, status?: string): void {
    if (this.card !== 'loading') return;
    const v = Math.max(this.shown, Math.min(1, Math.max(0, f)));
    this.shown = v;
    this.bar.style.width = `${Math.max(4, v * 100).toFixed(1)}%`;
    if (status !== undefined) this.status.textContent = status;
  }

  /** CLICK TO PLAY: resolves the click handler on a real click anywhere on the card. */
  showPlay(onClick: (e: MouseEvent) => void): void {
    this.card = 'play';
    this.root.classList.remove('gone');
    this.box.className = 'df-card';
    this.box.replaceChildren(wordmark(), modeLine());
    const btn = el('button', 'df-btn df-play', 'CLICK TO PLAY');
    btn.type = 'button';
    btn.id = 'df-play';
    this.box.append(btn);
    this.root.onclick = (e) => { e.preventDefault(); onClick(e); };
    btn.focus({ preventScroll: true });
  }

  /** doctrine §6: lock refused twice with zero successes → tell the player instead of an eternal prompt */
  showBlocked(onRetry?: (e: MouseEvent) => void): void {
    this.card = 'blocked';
    this.root.classList.remove('gone');
    this.box.className = 'df-card df-err';
    const h = el('h2', '', 'MOUSE CAPTURE BLOCKED');
    const p = el('p', 'df-sub', 'This browser refused to capture the mouse. Reload the page, or click here to try again.');
    const b = el('button', 'df-btn', 'RELOAD');
    b.type = 'button';
    b.onclick = (e) => { e.stopPropagation(); location.reload(); };
    this.box.replaceChildren(wordmark(), h, p, b);
    // the refusal can be transient (an unfocused window): a click anywhere else on the card retries
    this.root.onclick = onRetry ? (e) => { e.preventDefault(); onRetry(e); } : null;
  }

  hide(): void {
    this.card = 'none';
    this.root.onclick = null;
    this.root.classList.add('gone');
  }

  error(title: string, message: string): void {
    this.card = 'error';
    this.root.classList.remove('gone');
    this.root.setAttribute('role', 'alertdialog');
    this.box.className = 'df-card df-err';
    const h = el('h2', '', title);
    const pre = el('pre', '', message);
    const b = el('button', 'df-btn', 'RELOAD');
    b.type = 'button';
    b.onclick = () => location.reload();
    this.box.replaceChildren(wordmark(), h, pre, b);
    this.root.onclick = null;
  }
}
