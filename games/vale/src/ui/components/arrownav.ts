// VALE UI — spatial arrow-key navigation. Inside any container marked `data-arrownav`, the arrow keys
// move focus between its `[data-nav]` items by geometry (nearest item in that direction, preferring the
// same row/column), so grids of fighter cards, offer shelves, the Mode Dial and the nav bar are all
// reachable without a mouse. Controls that own their arrows (sliders, segmented groups, tabs, selects)
// stop propagation before this sees the key. Tab order stays the document order.

const DIRS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

export function arrowNav(e: KeyboardEvent): void {
  const d = DIRS[e.key];
  if (!d || e.altKey || e.ctrlKey || e.metaKey) return;
  const cur = document.activeElement as HTMLElement | null;
  if (!cur || cur.matches('input, textarea, [contenteditable="true"]')) return;
  const box = cur.closest<HTMLElement>('[data-arrownav]');
  if (!box || !cur.matches('[data-nav]')) return;
  const items = [...box.querySelectorAll<HTMLElement>('[data-nav]')].filter((x) => x !== cur && x.offsetParent !== null && !x.closest('[inert]'));
  const a = cur.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best: HTMLElement | null = null, bestScore = Infinity;
  for (const it of items) {
    const b = it.getBoundingClientRect();
    const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
    const along = dx * d[0] + dy * d[1];
    if (along <= 2) continue;
    const across = Math.abs(dx * d[1]) + Math.abs(dy * d[0]);
    const score = along + across * 2.2;
    if (score < bestScore) { bestScore = score; best = it; }
  }
  if (best) {
    e.preventDefault();
    best.focus({ preventScroll: false });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
