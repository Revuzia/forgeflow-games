// VALE harness — render bench: a REAL match (createSim via LocalMatchHost + the BOTS lane's
// controllers on every seat, your seat on autopilot) with the real catalog, rendered by
// src/render. Dev bench: it may import src/sim and src/session (CONTRACT §14: harness).
//
//   /_harness/web/render_bench.html?mode=rift&q=high&t=75&dev=1&hud=0&manual=1
//     mode    index or id of a catalog mode with ≥ 1 lane (default: the first)
//     q       low | medium | high | ultra
//     t       seconds of match to fast-forward before rendering (bots play it out)
//     manual  1 = no rAF loop; drive frames from Playwright with __VALE_BENCH__.frames(n, dt)
//     hud     0 hides the stats box (screenshots)
//     cb      off | deutan | protan | tritan
//
// window.__VALE_BENCH__: { ready, stats(), frames(n, dt), ff(sec), fight(), focus(x, y), focusEntity(id),
//   setQuality(tier), telegraphTest(), clearAim(), zoom(d), entities(kind), you(), menu(station) }

import type { CatalogT } from '../../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../../src/contracts/sim.ts';
import { loadCatalog } from '../../src/boot/catalog.ts';
import { createRenderer, presetVideo, type Renderer, type Tier } from '../../src/render/index.ts';
import { defaultSettings } from '../../src/session/settings.ts';
import { LocalMatchHost } from '../../src/session/match_host.ts';
import { createBots } from '../../src/sim/bots/index.ts';

const qs = new URLSearchParams(location.search);
const hud = document.getElementById('hud')!;
if (qs.get('hud') === '0') hud.classList.add('off');
const canvas = document.getElementById('c') as HTMLCanvasElement;

/** world events that carry no VFX id: the harness may name content ids (CONTRACT §0) */
function eventVfx(catalog: CatalogT): Record<string, string> {
  const want: Record<string, string> = {
    levelUp: 'lib_level_up', respawn: 'lib_respawn', death: 'lib_death_shatter', unitDeath: 'lib_wick_death',
    structureFall: 'lib_structure_fall', recall: 'lib_recall', pickup: 'lib_sunmote_pickup', objective: 'lib_objective_taken',
    blink: 'lib_blink', crit: 'lib_crit', heal: 'lib_heal_rise', shield: 'lib_shield_up', ultWindup: 'lib_ult_windup',
  };
  const ids = new Set(catalog.vfx.map((v) => v.id));
  return Object.fromEntries(Object.entries(want).filter(([, id]) => ids.has(id)));
}
function statusVfx(catalog: CatalogT): Record<string, string> {
  const want: Record<string, string> = { stun: 'lib_stun_ring', root: 'lib_root_bind', slow: 'lib_slow_glass', silence: 'lib_silence', reveal: 'lib_reveal_mark' };
  const ids = new Set(catalog.vfx.map((v) => v.id));
  return Object.fromEntries(Object.entries(want).filter(([, id]) => ids.has(id)));
}

function buildSetup(catalog: CatalogT, modeArg: string | null, seed: number): MatchSetup {
  const modes = catalog.modes;
  const mode = (modeArg && (modes.find((m) => m.id === modeArg) ?? modes[Number(modeArg)])) || modes[0];
  const queue = catalog.queues.find((q) => q.mode === mode.id && q.kind === 'standard') ?? catalog.queues.find((q) => q.mode === mode.id)!;
  const n = mode.teams * mode.perTeam;
  const ffa = mode.rules.end.kind === 'last_standing_or_score' || mode.pick === 'ffa_pick';
  const fighters = catalog.fighters.map((f) => f.id);
  const seats: SeatSetup[] = [];
  for (let i = 0; i < n; i++) {
    const fighter = fighters[(i * 7 + 3) % fighters.length];
    const skin = catalog.skins.find((s) => s.fighter === fighter && s.tier === 'base')?.id ?? catalog.skins.find((s) => s.fighter === fighter)?.id ?? '';
    const team = ffa ? i : Math.floor(i / mode.perTeam);
    const roles = catalog.roles.filter((r) => r.assign).sort((a, b) => (a.assign?.order ?? 0) - (b.assign?.order ?? 0));
    seats.push({
      player: i, team, name: catalog.botNames[(i * 5 + 1) % catalog.botNames.length], fighter, skin,
      role: mode.roles ? roles[i % mode.perTeam]?.id : undefined,
      loadout: { spells: catalog.setup.defaults.spells.slice(), boons: catalog.setup.defaults.boons.slice() },
      controller: i === 0 ? 'human' : 'bot', botDifficulty: 'veteran', colorIndex: i,
    });
  }
  return { matchId: `bench-${seed}`, seed, queue: queue.id, mode: mode.id, map: mode.map, seats, catalogVersion: catalog.version };
}

async function main(): Promise<void> {
  const cat = await loadCatalog({ url: new URL('/catalog/manifest.json', location.href).href });
  const catalog = cat.catalog;
  const settings = defaultSettings();
  const tier = (qs.get('q') ?? 'high') as Tier;
  settings.video = presetVideo(tier, settings.video);
  const cb = qs.get('cb');
  if (cb === 'deutan' || cb === 'protan' || cb === 'tritan') settings.access.colorblind = cb;
  settings.controls.cameraLock = false;
  const renderer: Renderer = createRenderer(canvas, catalog, settings, cat.assetUrl, {
    dev: qs.get('dev') === '1',
    devModelUrl: new URL('/art/out/_proof/_proof_mannequin.glb', location.href).href,
    eventVfx: eventVfx(catalog), statusVfx: statusVfx(catalog),
    dynamicResolution: qs.get('dyn') === '1',
    preserveDrawingBuffer: true, quiet: true,
  });
  const resize = (): void => renderer.resize(canvas.clientWidth, canvas.clientHeight);
  addEventListener('resize', resize);
  resize();

  if (qs.get('menu')) {
    renderer.setScene('menu');
    renderer.setMenuView({ screen: qs.get('menu') ?? 'home', fighter: qs.get('fighter') ?? undefined });
    install(renderer, null, catalog);
    loop(renderer, null);
    return;
  }

  const setup = buildSetup(catalog, qs.get('mode'), Number(qs.get('seed') ?? 7));
  const host = new LocalMatchHost(catalog, setup, 0, { bots: createBots(catalog, setup), autopilot: true, maxTimeScale: 16, pregameSeconds: 0 });
  host.start();
  await renderer.preload(setup, (p) => { hud.textContent = `loading ${(p * 100) | 0}%`; });
  const ffTo = Number(qs.get('t') ?? 0);
  if (ffTo > 0) ff(host, ffTo);
  renderer.setScene(host);
  install(renderer, host, catalog);
  loop(renderer, host);
}

function ff(host: LocalMatchHost, seconds: number): void {
  host.setTimeScale(16);
  const target = host.view.time + seconds;
  let guard = 0;
  while (host.view.time < target && !host.ended && guard++ < 100000) host.pump(0.25);
  host.setTimeScale(1);
}

let manual = qs.get('manual') === '1';
function loop(renderer: Renderer, host: LocalMatchHost | null): void {
  let last = performance.now();
  const tick = (): void => {
    if (manual) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    host?.pump(dt);
    renderer.render(dt);
    const s = renderer.stats();
    if (!hud.classList.contains('off')) hud.textContent = `${s.mode} ${s.tier}  ${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms cpu\ncalls ${s.calls} (scene ${s.sceneCalls})  tris ${(s.triangles / 1000).toFixed(0)}k\nscale ${s.renderScale} dpr ${s.pixelRatio.toFixed(2)}  ${s.width}×${s.height}\nactors ${s.actors}  vfx ${s.vfx}  particles ${s.particles}  tele ${s.telegraphs}${host ? `\nmatch ${host.view.time.toFixed(1)} s` : ''}`;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function install(renderer: Renderer, host: LocalMatchHost | null, catalog: CatalogT): void {
  const view = () => host?.view;
  const you = () => { const v = view(); const p = v?.players.find((x) => x.player === 0); return p ? v!.entity(p.entity) : undefined; };
  const api = {
    ready: true,
    catalog,
    renderer,
    host,
    stats: () => renderer.stats(),
    /** render n frames of dt seconds each (pumping the match) — use with ?manual=1 */
    frames: (n = 1, dt = 1 / 30): ReturnType<Renderer['stats']> => {
      for (let i = 0; i < n; i++) { host?.pump(dt); renderer.render(dt); }
      return renderer.stats();
    },
    setManual: (on: boolean) => { manual = on; if (!on) loop(renderer, host); },
    ff: (sec: number) => { if (host) ff(host, sec); return host?.view.time; },
    time: () => host?.view.time ?? 0,
    you: () => { const e = you(); return e ? { id: e.id, x: e.x, y: e.y, team: e.team, alive: e.alive } : null; },
    entities: (kind?: string) => (view()?.entities ?? []).filter((e) => !kind || e.kind === kind).map((e) => ({ id: e.id, kind: e.kind, def: e.def, team: e.team, x: +e.x.toFixed(2), y: +e.y.toFixed(2), hp: Math.round(e.hp), maxHp: Math.round(e.maxHp), alive: e.alive, state: e.state, mask: e.visibleMask })),
    /** the densest fighter cluster with both sides present */
    fight: () => {
      const v = view();
      if (!v) return null;
      const fs = v.entities.filter((e) => e.kind === 'fighter' && e.alive);
      let best: { x: number; y: number; n: number } | null = null;
      for (const f of fs) {
        const near = v.entities.filter((e) => (e.kind === 'fighter' || e.kind === 'minion') && e.alive && Math.hypot(e.x - f.x, e.y - f.y) < 9);
        const teams = new Set(near.filter((e) => e.kind === 'fighter').map((e) => e.team));
        const n = near.length + (teams.size > 1 ? 20 : 0);
        if (!best || n > best.n) {
          const cx = near.reduce((s, e) => s + e.x, 0) / near.length, cy = near.reduce((s, e) => s + e.y, 0) / near.length;
          best = { x: cx, y: cy, n };
        }
      }
      return best;
    },
    focus: (x: number, y: number) => { renderer.camera.setMode('free'); renderer.camera.focusOn(x, y); },
    focusEntity: (id: number) => { const e = view()?.entity(id); if (e) { renderer.camera.setMode('free'); renderer.camera.focusOn(e.x, e.y); } },
    follow: () => renderer.camera.setMode('locked'),
    zoom: (d: number) => renderer.camera.setZoom(d),
    setQuality: (t: Tier) => renderer.setQuality(presetVideo(t)),
    menu: (station: string, fighter?: string) => renderer.setMenuView({ screen: station, fighter }),
    /** synthetic telegraphs around a point: enemy delayed circle, enemy cone, enemy line, ally ring, own aim */
    telegraphTest: (x: number, y: number) => {
      const v = view();
      if (!v) return;
      const me = you();
      const myTeam = me?.team ?? 0;
      const enemy = v.entities.find((e) => e.kind === 'fighter' && e.team !== myTeam);
      const ally = v.entities.find((e) => e.kind === 'fighter' && e.team === myTeam && e.id !== me?.id) ?? me;
      if (!enemy || !ally) return;
      const t = v.time;
      const ev: SimEvent[] = [
        { e: 'area', t, src: enemy.id, ability: 'bench', x: x + 3.2, y: y - 0.6, shape: { kind: 'circle', radius: 2.6 }, delay: 1.6, telegraph: 'everyone' },
        { e: 'area', t, src: enemy.id, ability: 'bench', x: x + 1.2, y: y + 0.6, shape: { kind: 'circle', radius: 1.8 }, delay: 2.4, telegraph: 'everyone' },
        { e: 'cast', t, src: enemy.id, slot: 'a2', ability: 'bench', x: x - 6, y: y + 3, castTime: 0.4 },
        { e: 'area', t, src: enemy.id, ability: 'bench', x: x + 6.5, y: y + 2.2, shape: { kind: 'rect', length: 8, width: 1.4 }, delay: 1.0, telegraph: 'everyone' },
        { e: 'area', t, src: ally.id, ability: 'bench', x: x - 4.2, y: y - 1.5, shape: { kind: 'ring', radius: 2.4, inner: 1.2 }, delay: 2.0, telegraph: 'everyone' },
      ];
      renderer.injectEvents(ev);
      renderer.setAim({ shape: 'cone', x: x - 4, y: y + 2.6, dir: -0.3, radius: 4.5, angleDeg: 70, range: 6, casterX: x - 4, casterY: y + 2.6 });
    },
    clearAim: () => renderer.setAim(null),
    hover: (id: number | null) => renderer.setHover(id),
    pick: (x: number, y: number) => renderer.pickEntity(x, y),
    ground: (x: number, y: number) => renderer.pickGround(x, y),
    screen: (x: number, y: number, h = 0) => renderer.worldToScreen(x, y, h),
  };
  (window as unknown as { __VALE_BENCH__: typeof api }).__VALE_BENCH__ = api;
}

main().catch((e: unknown) => {
  hud.classList.remove('off');
  hud.textContent = `bench failed: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`;
  console.error(e);
  (window as unknown as { __VALE_BENCH__: unknown }).__VALE_BENCH__ = { ready: false, error: String(e) };
});
