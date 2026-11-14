// HIT PARADE - the SHELL-ONLY boot entry (harness only). With HP_SHELL_ENTRY=1, vite.config.ts resolves index.html's
// `/src/main.ts` to this file (`python _harness/bootguard.py --shell-only`), so every boot-guard case runs against the
// REAL index.html guard + BootUI + settings + save + input + loop + flow + __HP__ before (or without) the full game
// graph of the other lanes. It imports `three` (so the build has the same vendor-three modulepreload chunk the guard
// watches) and a stylesheet (the guard's stylesheet case). It reaches phase 'title' like the real boot. Never deployed.

import './shell_entry.css';
import * as THREE from 'three';
import { BootUI, guardKeptCard } from '../ui/boot.ts';
import { SaveStore } from '../ui/save.ts';
import { SettingsStore } from '../ui/settings.ts';
import { Input } from '../input.ts';
import { GameLoop } from '../app/loop.ts';
import { Flow } from '../app/flow.ts';
import { installTestSurface } from '../testsurface.ts';

window.__HP_MAIN__ = true;
const params = new URLSearchParams(location.search);
const flow = new Flow();
const save = new SaveStore();
const settings = new SettingsStore(save);
const boot = new BootUI();
window.__HP_BOOT__?.handoff();

function start(): void {
  flow.go('loading', 'shell entry');
  boot.progress(0.2, 'Loading...');
  const c = settings.get().controls;
  const input = new Input({ keys: [c[0].keys, c[1].keys], pads: [c[0].pad, c[1].pad] });
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x140d1f, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(35, window.innerWidth / Math.max(1, window.innerHeight), 0.1, 100);
  const words: [number, number] = [0, 0];
  const loop = new GameLoop(() => { input.sampleAll(words); }, () => { renderer.render(scene, cam); });
  loop.simEnabled = false;
  installTestSurface({
    version: 'hit-parade-shell-entry', dev: params.get('dev') === '1', flow,
    loop: () => loop, input: () => input, settings: () => settings, save: () => save,
    match: () => null, fighters: () => null, events: () => [],
    extra: () => ({ shellEntry: true }),
    canvas: () => canvas, render: () => renderer.render(scene, cam),
    renderInfo: () => ({ calls: renderer.info.render.calls, programs: renderer.info.programs?.length ?? 0 }),
    audio: () => null, net: () => null, touch: () => ({ mode: input.mode }),
    step: (n) => loop.stepSync(n), freeze: (on) => { loop.simEnabled = !on; },
  });
  loop.start();
  boot.progress(1, 'Ready');
  boot.hide();
  const title = document.createElement('div');
  title.className = 'hp-shell-title';
  title.innerHTML = 'HIT PARADE<small>SHELL-ONLY BOOT (HARNESS ENTRY)</small>';
  document.body.append(title);
  flow.go('title', 'shell entry ready');
}

// the stylesheet failed: the guard kept its card (its auto-retry / RELOAD is the way on) and nothing else starts
if (guardKeptCard()) flow.fail('stylesheet failed to load (boot guard card kept)');
else start();
