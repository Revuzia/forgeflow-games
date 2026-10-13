// VALE UI — Match host (client_hud §4). The renderer draws the match scene (state.ts hands it the
// MatchClient on the 'match' event); this screen mounts the HUD over it. The HUD lives in
// src/ui/hud/index.tsx (another engineer's module): it is loaded when present and must export
// `Hud(props: { client: MatchClient })`; until then the host shows only a quiet status line.
// Esc opens the in-match menu (Resume · Settings · Leave match) unless the HUD claims Esc first
// (useEsc in the HUD wins: newest claim answers first).

import type { ComponentType, JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { MatchClient } from '../../contracts/session.ts';
import { useApp, useEsc } from '../app_ctx.ts';
import { Button } from '../components/Button.tsx';
import { confirmDialog } from '../components/Modal.tsx';
import { fmtClock } from '../format.ts';

type HudModule = { Hud?: ComponentType<{ client: MatchClient }>; default?: ComponentType<{ client: MatchClient }> };
const HUD_LOADERS = import.meta.glob<HudModule>('../hud/index.tsx');
let hudCache: ComponentType<{ client: MatchClient }> | null | undefined;

function useHud(): ComponentType<{ client: MatchClient }> | null {
  const [hud, setHud] = useState<ComponentType<{ client: MatchClient }> | null>(hudCache ?? null);
  useEffect(() => {
    if (hudCache !== undefined) return;
    const load = Object.values(HUD_LOADERS)[0];
    if (!load) { hudCache = null; return; }
    load().then((m) => { hudCache = m.Hud ?? m.default ?? null; setHud(() => hudCache ?? null); }, (e: unknown) => { console.error('[vale] HUD failed to load', e); hudCache = null; });
  }, []);
  return hud;
}

export function MatchScreen(): JSX.Element {
  const { cv, state, overlay, router, sound } = useApp();
  const client = state.match.value;
  const Hud = useHud();
  const queue = cv.queue(client?.setup.queue);
  const free = queue?.kind === 'practice' || queue?.kind === 'custom';

  const leave = (): void => {
    void confirmDialog(overlay, {
      title: cv.t('hud.menu.leave', 'Leave match'),
      body: free ? cv.t('hud.menu.leave_confirm_practice', 'Leave practice? Nothing is lost.') : cv.t('hud.menu.leave_confirm', 'Leave the match? It counts as a loss and earns no rewards.'),
      confirm: cv.t('btn.leave_match', 'Leave match'), cancel: cv.t('btn.stay', 'Stay'), tone: 'danger',
    }).then((yes) => { if (yes) state.match.value?.leave(); });
  };
  const openMenu = (): void => {
    sound.play('click');
    overlay.open({
      title: cv.t('hud.menu.title', 'Menu'), size: 's',
      render: (close) => (
        <div class="stack">
          <Button variant="secondary" size="l" data-autofocus="" onPress={close}>{cv.t('hud.menu.resume', 'Resume')}</Button>
          <Button variant="secondary" size="l" onPress={() => { close(); router.go('settings'); }}>{cv.t('hud.menu.settings', 'Settings')}</Button>
          <Button variant="quiet" size="l" onPress={() => { close(); leave(); }}>{cv.t('hud.menu.leave', 'Leave match')}</Button>
        </div>
      ),
    });
  };
  useEsc(() => { openMenu(); return true; });

  if (!client) return <div class="matchhost" />;
  return (
    <div class="matchhost">
      {Hud ? <Hud client={client} /> : <HostStatus client={client} onMenu={openMenu} />}
    </div>
  );
}

/** shown only while no HUD module exists: where you are, the clock, and how to reach the menu */
function HostStatus(p: { client: MatchClient; onMenu: () => void }): JSX.Element {
  const { cv } = useApp();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, []);
  const v = p.client.view;
  const map = cv.map(p.client.setup.map);
  const pre = v.phase === 'pregame';
  return (
    <div class="hoststatus plate" role="status">
      <span class="t-label">{map?.name}</span>
      <span class="num t-num-clock">{pre ? cv.t('hud.pregame', 'The match begins in {t}', { t: fmtClock(-v.time) }) : fmtClock(Math.max(0, v.time))}</span>
      <Button variant="quiet" size="s" onPress={p.onMenu}>{cv.t('hud.menu.title', 'Menu')} <span class="keycap keycap--quiet">Esc</span></Button>
    </div>
  );
}
