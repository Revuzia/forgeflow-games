// DYEFIELD — the achievement toast (_spec/CONTRACT_STATS.md §S8.2). A standalone DOM module: it mounts its own
// #df-ach-toast into #ui (top-centre, z-index 35: above the touch overlay, below the menus), pointer-events none, a polite
// live region. One toast at a time (3.2 s), queued; more than 3 waiting collapse into "+N more". Reduce motion → fade only.
// Unlocks happen at finalize, so toasts play over the victory slate: the box stays in the top band, clear of its buttons.

import './stats.css';
import type { AchievementDef } from '../types.ts';

export const TOAST_MS = 3200;
export const TIER_COLORS: Readonly<Record<string, string>> = { bronze: '#cd7f32', silver: '#c0c0c0', gold: '#ffd700' };

export interface Toaster {
  show(a: AchievementDef, xp: boolean): void;
  note(text: string): void;
  dispose(): void;
  /** read-back for the harness */
  stats(): { shown: number; queued: number; collapsed: number; visible: boolean; text: string };
}

type Item = { kind: 'ach'; a: AchievementDef; xp: boolean } | { kind: 'note'; text: string } | { kind: 'more'; n: number };

export function createToaster(uiRoot: HTMLElement, o: { reduceMotion(): boolean; sound?(s: 'click'): void }): Toaster {
  const doc = uiRoot.ownerDocument;
  doc.getElementById('df-ach-toast')?.remove();
  const box = doc.createElement('div');
  box.id = 'df-ach-toast';
  box.className = 'df-ach-toast';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-live', 'polite');
  box.hidden = true;
  uiRoot.append(box);

  const q: Item[] = [];
  let timer = 0;
  let shown = 0, collapsed = 0;
  let disposed = false;

  const render = (it: Item): void => {
    box.replaceChildren();
    box.classList.toggle('rm', !!o.reduceMotion());
    if (it.kind === 'ach') {
      box.dataset.tier = it.a.tier;
      const chip = doc.createElement('span');
      chip.className = 'chip';
      chip.style.setProperty('--tier', TIER_COLORS[it.a.tier] ?? TIER_COLORS.bronze);
      chip.textContent = it.a.tier === 'gold' ? '★' : it.a.tier === 'silver' ? '◆' : '●';
      chip.setAttribute('aria-hidden', 'true');
      const txt = doc.createElement('span');
      txt.className = 'txt';
      const cap = doc.createElement('small');
      cap.textContent = 'ACHIEVEMENT';
      const name = doc.createElement('b');
      name.textContent = it.a.name;
      txt.append(cap, name);
      const xp = doc.createElement('span');
      xp.className = it.xp ? 'xp' : 'xp local';
      xp.textContent = it.xp ? `+${it.a.points.toLocaleString('en-US')} XP` : 'Saved on this device';
      box.append(chip, txt, xp);
    } else {
      box.dataset.tier = 'note';
      const txt = doc.createElement('span');
      txt.className = 'txt';
      const b = doc.createElement('b');
      b.textContent = it.kind === 'note' ? it.text : `+${it.n} more achievement${it.n === 1 ? '' : 's'}`;
      txt.append(b);
      box.append(txt);
    }
    box.hidden = false;
    box.classList.remove('in');
    void box.offsetWidth;                                   // restart the entry animation
    box.classList.add('in');
    shown++;
    try { o.sound?.('click'); } catch { /* audio is optional */ }
  };

  const next = (): void => {
    timer = 0;
    if (disposed) return;
    if (!q.length) { box.hidden = true; box.classList.remove('in'); return; }
    // more than 3 waiting → the rest collapse into one "+N more" line after the next three
    if (q.length > 3) {
      const keep = q.slice(0, 3);
      const rest = q.slice(3);
      const n = rest.reduce((s, it) => s + (it.kind === 'more' ? it.n : it.kind === 'ach' ? 1 : 0), 0);
      const notes = rest.filter((it) => it.kind === 'note');
      collapsed += n;
      q.length = 0;
      q.push(...keep, ...notes);
      if (n > 0) q.push({ kind: 'more', n });
    }
    render(q.shift()!);
    timer = window.setTimeout(next, TOAST_MS);
  };

  const push = (it: Item): void => {
    if (disposed) return;
    q.push(it);
    if (!timer) next();
  };

  return {
    show: (a, xp) => push({ kind: 'ach', a, xp }),
    note: (text) => push({ kind: 'note', text }),
    dispose: () => { disposed = true; if (timer) window.clearTimeout(timer); box.remove(); },
    stats: () => ({ shown, queued: q.length, collapsed, visible: !box.hidden, text: box.textContent ?? '' }),
  };
}
