// VALE HUD — the match HUD (CONTRACT §10 "HUD"; STYLE_BIBLE "HUD density"). screens/match.tsx loads
// this module and mounts `Hud` over the renderer's canvas. One HudModel (events → words and signals)
// and one InputController (real keys and mouse → Commands) live as long as the HUD does.
//
// Layers, back to front:
//   .hudsurface  the full-screen pointer surface: world clicks go to the InputController from here
//   .hudworld    world-anchored marks projected every frame (numbers, move/attack markers, pings)
//   .hud         the widgets: sky strip + announcer (top centre), kill feed / Hour Board (top right),
//                ally frames (left edge), feed (bottom left), Dial Bar (bottom centre), minimap
//                (bottom right, swappable), and on demand: shop, scoreboard, death recap, ping wheel,
//                practice tools, surrender vote, the end-of-match banner
// The centre 40 % × 50 % of the screen holds no HUD (bible). Widgets catch the pointer; the gaps
// between them fall through to the surface.

import type { CSSProperties, JSX } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { effect, signal } from '@preact/signals';
import type { MatchClient } from '../../contracts/session.ts';
import { AbilityIndex, InputController, type Action, type DenyReason, type InputRenderer } from '../../input/index.ts';
import { useApp, useEsc } from '../app_ctx.ts';
import { keyShort } from '../keys.ts';
import { HudContext, type HudCtx } from './ctx.ts';
import { DialBar } from './dialbar.tsx';
import { Minimap } from './minimap.tsx';
import { HudModel } from './model.ts';
import { DeathRecap, EndBanner, PracticePanel, Scoreboard } from './panels.tsx';
import { ShopPanel } from './shop.tsx';
import { AllyFrames, Feed, LevelUpPop, RecallBar, RespawnLine } from './side.tsx';
import { Announcer, HourBoard, KillFeed, SkyStrip, SurrenderPlate } from './top.tsx';
import { PingWheel, WorldLayer, type WorldMarks } from './world.tsx';
import '../styles/hud.css';

/** first-match hints, one every few seconds once the match is live (once per device) */
const HINTS: { key: string; params: Action[] }[] = [
  { key: 'hint.move', params: [] },
  { key: 'hint.attack', params: ['attackMove'] },
  { key: 'hint.abilities', params: ['a1', 'a2', 'a3', 'ult'] },
  { key: 'hint.shop', params: [] },
  { key: 'hint.ping', params: ['ping'] },
  { key: 'hint.scoreboard', params: ['scoreboard'] },
  { key: 'hint.recall', params: [] },
];
const HINT_GAP_MS = 7000;

export function Hud(p: { client: MatchClient }): JSX.Element {
  const app = useApp();
  const { cv, state, overlay, sound, session } = app;
  const client = p.client;
  const surface = useRef<HTMLDivElement>(null);
  const r = (state.renderer ?? {}) as InputRenderer;

  const built = useMemo(() => {
    const model = new HudModel(client, cv);
    const index = new AbilityIndex(cv.c);
    const shopOpen = signal(false);
    const board = signal(false);
    const marks: WorldMarks = { markers: signal([]) };
    return { model, index, shopOpen, board, marks };
  }, [client]);
  const { model, index, shopOpen, board, marks } = built;

  const mode = cv.mode(client.setup.mode);
  const lanes = cv.map(client.setup.map)?.lanes.length ?? 3;
  const mapShape: HudCtx['mapShape'] = model.ffa ? 'disc' : lanes <= 1 ? 'strip' : 'rect';

  const input = useMemo(() => new InputController({
    client, renderer: r, index, settings: state.settings.peek(),
    surface: document.body,
    hooks: {
      toggleShop: () => { shopOpen.value = !shopOpen.value; sound.play(shopOpen.value ? 'tab' : 'back'); },
      closeShop: () => { if (!shopOpen.value) return false; shopOpen.value = false; sound.play('back'); return true; },
      scoreboard: (on) => { board.value = on; },
      denied: (slot, why) => denied(model, cv, slot, why),
      marker: (m) => { marks.markers.value = [...marks.markers.peek().slice(-5), { ...m, id: markSeq++, at: performance.now() }]; },
      setCameraLock: (locked) => {
        r.camera?.setMode(locked ? 'locked' : 'semi');
        if (locked) r.camera?.centerOnSelf();
        const c = state.settings.peek().controls;
        session.updateSettings({ controls: { ...c, cameraLock: locked } });
        model.say(locked ? cv.t('hud.camera.locked', 'Camera locked to your fighter.') : cv.t('hud.camera.unlocked', 'Camera unlocked.'), 'info');
      },
      blocked: () => overlay.modals.value.length > 0,
      pingsDisabled: () => model.ffa,
      cast: (slot) => { model.pressed.value = { n: model.pressed.peek().n + 1, slot }; },
    },
  }), [client]);

  // the surface exists after the first render: point the controller at it, attach, run the frame loop
  useEffect(() => {
    if (surface.current) input.setSurface(surface.current);
    const detach = input.attach();
    const cam = r.camera;
    if (cam) { cam.setMode(state.settings.peek().controls.cameraLock ? 'locked' : 'semi'); cam.centerOnSelf(); }
    let raf = 0;
    const loop = (now: number): void => {
      raf = requestAnimationFrame(loop);
      try { model.tick(); input.frame(now); } catch (e) { console.error('[vale] hud frame', e); }
    };
    raf = requestAnimationFrame(loop);
    const stopSettings = effect(() => { input.setSettings(state.settings.value); });
    return () => { cancelAnimationFrame(raf); detach(); stopSettings(); model.dispose(); };
  }, [input]);

  // first-match hints (strings hint.*), once per device
  useEffect(() => {
    if (state.prefs.peek().seenScreens.includes('match_hints') || cv.queue(client.setup.queue)?.kind === 'practice') return;
    let i = 0;
    let timer = 0;
    const next = (): void => {
      if (i >= HINTS.length) { state.setPrefs({ seenScreens: [...state.prefs.peek().seenScreens, 'match_hints'] }); return; }
      const h = HINTS[i++];
      const params: Record<string, string> = {};
      for (const a of h.params) params[a] = keyShort(input.keymap.code(a));
      const text = cv.t(h.key, '', params);
      if (text) model.say(text, 'hint');
      timer = window.setTimeout(next, HINT_GAP_MS);
    };
    const start = window.setInterval(() => {
      if (client.view.phase === 'pregame' && i === 0) { model.say(cv.t('hud.pregame_shop', 'Buy items and set your abilities before the bell.'), 'hint'); i = 0; }
      if (client.view.phase === 'live') { clearInterval(start); timer = window.setTimeout(next, 1500); }
    }, 500);
    return () => { clearInterval(start); clearTimeout(timer); };
  }, [client]);

  // Esc: aiming / the wheel / the shop answer before the in-match menu (the controller handles those
  // first in the capture phase); the scoreboard never needs Esc (it is held)
  useEsc(() => { if (shopOpen.value) { shopOpen.value = false; return true; } return false; });

  const ctx: HudCtx = {
    client, model, input, index, r, shopOpen, board, mapShape,
    key: (action: string) => keyShort(input.keymap.code(action as Action)),
  };
  const side = state.settings.value.gameplay.minimapSide;
  const cursor = input.cursor.value;
  return (
    <HudContext.Provider value={ctx}>
      <div ref={surface} class={`hudsurface cur-${cursor}`} aria-hidden="true" />
      <WorldLayer marks={marks} />
      <div class={`hud hud--${model.ffa ? 'ffa' : 'team'} hud--map-${side} hud--mode-${mode?.id ?? 'x'}`} style={{ '--hk': state.settings.value.access.hudScale || 1 } as CSSProperties}>
        <div class="hud__top">
          <SkyStrip />
          <Announcer />
          <SurrenderPlate />
        </div>
        <div class="hud__tr">
          {model.ffa ? <HourBoard /> : null}
          <KillFeed />
        </div>
        <AllyFrames />
        <div class="hud__bl">
          <Feed />
        </div>
        <div class="hud__bottom">
          <RecallBar />
          <RespawnLine />
          <LevelUpPop />
          <DialBar />
        </div>
        <div class="hud__map"><Minimap /></div>
        <PracticePanel />
        <ShopPanel />
        <Scoreboard />
        <DeathRecap />
        <PingWheel />
        <EndBanner />
      </div>
    </HudContext.Provider>
  );
}

let markSeq = 1;

/** a refused press: the slot shakes, and the reason goes to the feed when it is not obvious */
function denied(model: HudModel, cv: HudModel['cv'], slot: string, why: DenyReason): void {
  model.denied.value = { n: model.denied.peek().n + 1, slot, why };
  const say = (key: string, fallback: string, params?: Record<string, string | number>): void => model.say(cv.t(key, fallback, params), 'warn');
  switch (why) {
    case 'ping_limit': say('ping.limit', 'Pings are limited to 5 every 4 s.'); break;
    case 'ping_fray': say('ping.unavailable_fray', 'Pings are for teammates. Nobody shares your side in FRAY.'); break;
    case 'resource': {
      const f = cv.fighter(model.me?.fighter);
      const res = cv.resource(f?.resource);
      say('hud.denied.resource', 'Not enough {res}.', { res: res?.name ?? cv.t('hud.resource', 'Resource') });
      break;
    }
    case 'rank': say('hud.denied.rank', 'Level up this ability first.'); break;
    case 'silenced': say('hud.denied.silenced', 'You are silenced.'); break;
    case 'target': say('hud.denied.target', 'No valid target there.'); break;
    case 'no_active': say('hud.denied.no_active', 'That item has no active.'); break;
    default: break;
  }
}
