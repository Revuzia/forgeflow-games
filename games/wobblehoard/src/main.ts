// WOBBLEHOARD entry: install the theme tokens, then boot (src/shell/boot.ts). Kept tiny so a failure anywhere still lands on the
// friendly error card instead of a blank page.
import './ui/styles.css';
import { installTheme } from './ui/theme.ts';
import { boot } from './shell/boot.ts';
import { showErrorCard } from './ui/errorCard.ts';

installTheme(); // tokens first: styles.css only reads var(--wh-*)

boot().catch((err) => {
  console.error(err);
  const root = document.getElementById('ui') ?? document.body;
  root.querySelector('.title')?.remove();
  showErrorCard(root, { title: 'Something went wrong', message: 'The game could not start. Reloading usually fixes it.', detail: err instanceof Error ? err.message : String(err) });
  document.body.dataset.phase = 'error';
  window.__whBooted = true;
});
