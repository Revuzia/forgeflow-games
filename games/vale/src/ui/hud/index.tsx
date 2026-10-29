// VALE HUD — the match HUD (CONTRACT §10 "HUD"; STYLE_BIBLE "HUD density"). screens/match.tsx loads
// this module and mounts `Hud` over the renderer's canvas. One HudModel (events → words and signals)
// and one InputController (real keys and mouse → Commands) live as long as the HUD does.
//
// Layers, back to front:
//   .hudsurface  the full-screen pointer surface: world clicks go to the InputController from here
//   .hudworld    world-anchored marks projected every frame (numbers, move/attack markers, pings)
//   .hud         the widgets: sky strip + announcer (top centre), kill feed / Hour Board (top right),
//                ally frames (left edge), feed (bottom left), Dial Bar (bottom centre) with your status
//                row, the loss-of-control chip and the refusal caption over it, minimap (bottom right,
//                swappable) with the target plate docked on its frame, the optional screen-edge marks
//                (behind every widget), and on demand: shop, scoreboard, death recap, ping wheel,
//                practice tools, surrender vote, the end-of-match banner, and while the GPU view is lost or
//                restoring, the view plate (perf PERF-m4)
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
import { Minimap, minimapScale } from './minimap.tsx';
import { type Caption as CaptionT, HudModel } from './model.ts';
import { DeathRecap, EndBanner, PracticePanel, Scoreboard } from './panels.tsx';
import { ShopPanel } from './shop.tsx';
import { AllyFrames, Feed, RecallBar, RespawnLine } from './side.tsx';
import { Caption, LocChip, ScreenEdge, TargetPlate } from './status.tsx';
import { Announcer, HourBoard, KillFeed, SkyStrip, SurrenderPlate } from './top.tsx';
import { PingWheel, ViewPlate, WorldLayer, type WorldMarks } from './world.tsx';
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
  const r = useMemo(() => (state.renderer ?? {}) as InputRenderer, [state.renderer]);

  const built = useMemo(() => {
    const model = new HudModel(client, cv);
    const index = new AbilityIndex(cv.c);
    const shopOpen = signal(false);
    const board = signal(false);
    const statsOpen = signal(false);
    const marks: WorldMarks = { markers: signal([]) };
    return { model, index, shopOpen, board, statsOpen, marks };
  }, [client]);
  const { model, index, shopOpen, board, statsOpen, marks } = built;

  const mode = cv.mode(client.setup.mode);
  const lanes = cv.map(client.setup.map)?.lanes.length ?? 3;
  const mapShape: HudCtx['mapShape'] = model.ffa ? 'disc' : lanes <= 1 ? 'strip' : 'rect';

  const input = useMemo(() => new InputController({
    client, renderer: selecting(r, model), index, settings: state.settings.peek(),
    surface: document.body,
    hooks: {
      toggleShop: () => { shopOpen.value = !shopOpen.value; sound.play(shopOpen.value ? 'tab' : 'back'); },
      closeShop: () => { if (!shopOpen.value) return false; shopOpen.value = false; sound.play('back'); return true; },
      scoreboard: (on) => { board.value = on; },
      denied: (slot, why) => denied(model, cv, index, slot, why),
      marker: (m) => {
        marks.markers.value = [...marks.markers.peek().slice(-5), { ...m, id: markSeq++, at: performance.now() }];
        if (m.kind === 'attack' && m.target !== undefined) model.select(m.target);
      },
      setCameraLock: (locked) => {
        r.camera?.setMode(locked ? 'locked' : 'semi');
        if (locked) r.camera?.centerOnSelf();
        const c = state.settings.peek().controls;
        session.updateSettings({ controls: { ...c, cameraLock: locked, cameraLockChosen: true } });
        model.say(locked ? cv.t('hud.camera.locked', 'Camera locked to your fighter.') : cv.t('hud.camera.unlocked', 'Camera unlocked.'), 'info');
      },
      blocked: () => overlay.modals.value.length > 0,
      pingsDisabled: () => model.ffa,
      cast: (slot) => {
        // the sim refuses a cast while you cannot act: the slot shakes and the loss-of-control chip pulses
        if (model.derived().castLock) { lockPulse(model, slot); return; }
        model.pressed.value = { n: model.pressed.peek().n + 1, slot };
      },
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
    let pre = false;
    const start = window.setInterval(() => {
      // once (this ticks every 500 ms through the pregame)
      if (client.view.phase === 'pregame' && !pre) { pre = true; model.say(cv.t('hud.pregame_shop', 'Buy items and set your abilities before the bell.'), 'hint'); }
      if (client.view.phase === 'live') { clearInterval(start); timer = window.setTimeout(next, 1500); }
    }, 500);
    return () => { clearInterval(start); clearTimeout(timer); };
  }, [client]);

  // Esc: aiming / the wheel / the shop answer before the in-match menu (the controller handles those
  // first in the capture phase); the scoreboard never needs Esc (it is held)
  useEsc(() => { if (shopOpen.value) { shopOpen.value = false; return true; } return false; });

  // one context value per match: a new object per HUD render would force every useHud() consumer to
  // re-render, pinned ones included (HUD-4)
  const ctx = useMemo((): HudCtx => ({
    client, model, input, index, r, shopOpen, board, statsOpen, mapShape,
    key: (action: string) => keyShort(input.keymap.code(action as Action)),
  }), [client, model, input, index, r, shopOpen, board, statsOpen, mapShape]);
  const side = state.settings.value.gameplay.minimapSide;
  const cursor = input.cursor.value;
  return (
    <HudContext.Provider value={ctx}>
      <div ref={surface} class={`hudsurface cur-${cursor}`} aria-hidden="true" />
      <WorldLayer marks={marks} />
      <div class={`hud hud--${model.ffa ? 'ffa' : 'team'} hud--map-${side} hud--mode-${mode?.id ?? 'x'}`} style={{ '--hk': state.settings.value.access.hudScale || 1 } as CSSProperties}>
        <ScreenEdge />
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
          <LocChip />
          <Caption />
          <DialBar />
        </div>
        <div class="hud__map" style={{ '--mk': minimapScale(state.settings.value) } as CSSProperties}><TargetPlate /><Minimap /></div>
        <PracticePanel />
        <ShopPanel />
        <Scoreboard />
        <DeathRecap />
        <PingWheel />
        <EndBanner />
        <ViewPlate />
      </div>
    </HudContext.Provider>
  );
}

let markSeq = 1;

/** the renderer seam the input controller gets: the real renderer, plus target selection for the HUD's
 *  target plate (a left click on a unit selects it) */
function selecting(r: InputRenderer, model: HudModel): InputRenderer {
  const w: InputRenderer = {
    setTarget: (id) => { r.setTarget?.(id); model.select(id); },
    get camera() { return r.camera; },
  };
  if (r.pickGround) w.pickGround = (x, y) => r.pickGround!(x, y);
  if (r.pickEntity) w.pickEntity = (x, y) => r.pickEntity!(x, y);
  if (r.worldToScreen) w.worldToScreen = (x, y, h) => r.worldToScreen!(x, y, h);
  if (r.setAim) w.setAim = (a) => r.setAim!(a);
  if (r.setHover) w.setHover = (id) => r.setHover!(id);
  return w;
}

const CAPTION_MS = 1200;
let captionTimer = 0;
function caption(model: HudModel, text: string, tone: CaptionT['tone']): void {
  if (!text) return;
  model.caption.value = { n: model.caption.peek().n + 1, text, tone };
  clearTimeout(captionTimer);
  captionTimer = window.setTimeout(() => { model.caption.value = { ...model.caption.peek(), text: '' }; }, CAPTION_MS);
}
/** a press while you cannot act: the slot shakes and the loss-of-control chip (which names the status
 *  and its seconds) pulses, instead of a second caption saying the same */
function lockPulse(model: HudModel, slot: string): void {
  model.denied.value = { n: model.denied.peek().n + 1, slot, why: 'locked' };
  model.locPulse.value = model.locPulse.peek() + 1;
}

/** a refused press: the slot shakes, and a 1.2 s caption over the Dial Bar says why (pings: the feed) */
function denied(model: HudModel, cv: HudModel['cv'], index: AbilityIndex, slot: string, why: DenyReason): void {
  model.denied.value = { n: model.denied.peek().n + 1, slot, why };
  const say = (key: string, fallback: string, params?: Record<string, string | number>): void => caption(model, cv.t(key, fallback, params), 'warn');
  const d = model.derived();
  // you cannot act (the controller refuses at the press, 'cc'): the loss-of-control chip names it — pulse it
  if (why === 'cc' && !d.loc) { say('hud.caption.cc', 'You cannot act right now'); return; }
  if (why !== 'ping_limit' && why !== 'ping_fray' && why !== 'dead' && (why === 'cc' || d.castLock || (why === 'silenced' && d.loc))) { lockPulse(model, slot); return; }
  switch (why) {
    case 'ping_limit': model.say(cv.t('ping.limit', 'Pings are limited to 5 every 4 s.'), 'warn'); break;
    case 'ping_fray': model.say(cv.t('ping.unavailable_fray', 'Pings are for teammates. Nobody shares your side in FRAY.'), 'warn'); break;
    case 'cooldown': {
      const me = model.me;
      const i = slot.startsWith('item') ? Number(slot.slice(4)) - 1 : -1;
      const av = me?.abilities.find((a) => a.slot === slot);
      const cd = i >= 0 ? me?.itemCooldowns[i] ?? 0 : av?.cooldown ?? 0;
      const name = i >= 0 ? cv.item(me?.items[i])?.name ?? '' : index.get(av?.id)?.name ?? '';
      if (cd > 0) say('hud.caption.cooldown', '{name} ready in {t}', { name, t: cd < 1 ? `${cd.toFixed(1)} s` : cdWords(Math.ceil(cd - 0.001)) });
      else say('hud.ability.on_cooldown', 'Cooling down');
      break;
    }
    case 'resource': {
      const f = cv.fighter(model.me?.fighter);
      const res = cv.resource(f?.resource);
      say('hud.ability.no_resource', 'Not enough {resource}', { resource: res?.name ?? cv.t('hud.resource', 'Resource') });
      break;
    }
    case 'rank': say('hud.caption.rank', 'Level this ability up first'); break;
    case 'silenced': say('hud.caption.silenced', 'Silenced: abilities are sealed'); break;
    case 'target': say('hud.caption.target', 'No valid target there'); break;
    case 'no_active': say('hud.caption.no_active', 'That item has no active'); break;
    default: break;
  }
}
const cdWords = (t: number): string => (t >= 60 ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : `${t} s`);
