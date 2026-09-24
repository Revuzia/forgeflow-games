// Audio lane LIVE check: a real AudioContext unlocked by a real (Playwright) click through the
// engine's own gesture listener, the real 25 ms look-ahead timer, a live crossfade, and a real
// World stepping at 30 Hz feeding Sfx.onEvents every animation frame. Analysers on both buses.
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import type { SimEvent, TitanInput } from '../../../src/core/types.ts';
import { AudioEngine } from '../../../src/audio/audio.ts';
import { Sfx } from '../../../src/audio/sfx.ts';
import { Music } from '../../../src/audio/music.ts';

const out = document.getElementById('o')!;
const eng = new AudioEngine();
const sfx = new Sfx(eng);
const music = new Music(eng);
music.play('lockwater');          // requested BEFORE unlock: must start by itself once the click unlocks
music.setIntensity(1);
const w = createWorld({ titan: 'hearthback', biome: 'lockwater', seed: 5 });
const pending: SimEvent[] = [];
const rep = { unlockedAt: -1, state: '', ctxTimeStart: 0, ctxTimeEnd: 0, frames: 0, ticks: 0, eventsFed: 0, maxVoices: 0,
  musicRms: [] as number[], sfxRms: [] as number[], track: '' as string | null, errors: [] as string[], ok: false };
window.addEventListener('error', (e) => rep.errors.push(String(e.message)));

let anaM: AnalyserNode | null = null, anaS: AnalyserNode | null = null;
const buf = new Float32Array(2048);
const rms = (a: AnalyserNode) => { a.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return Math.sqrt(s / buf.length); };

let t0 = 0, simTimer: ReturnType<typeof setInterval> | null = null;
eng.onReady(() => {
  const ac = eng.ctx!;
  rep.unlockedAt = performance.now(); rep.ctxTimeStart = ac.currentTime;
  anaM = ac.createAnalyser(); anaS = ac.createAnalyser();
  eng.musicBus!.connect(anaM); eng.sfxBus!.connect(anaS);
  eng.setVolumes(0.8, 0.6, 0.8);
  t0 = performance.now();
  let k = 0;
  simTimer = setInterval(() => {
    k++;
    const a = k * 0.02;
    const input: TitanInput = { mx: Math.sin(a), mz: Math.cos(a * 0.8), ability: k % 120 === 0, abilityHeld: false, dash: k % 75 === 0 };
    stepWorld(w, input);
    rep.ticks++;
    for (const e of w.events) pending.push(e);
  }, 1000 / 30);
  setTimeout(() => music.play('boss'), 4000);   // live crossfade
});

function frame(): void {
  if (eng.ready && anaM && anaS) {
    rep.frames++;
    rep.eventsFed += pending.length;
    sfx.onEvents(w, pending, w.titan.x, w.titan.z);
    pending.length = 0;
    rep.maxVoices = Math.max(rep.maxVoices, sfx.activeVoices);
    if (rep.frames % 15 === 0) { rep.musicRms.push(+rms(anaM).toFixed(4)); rep.sfxRms.push(+rms(anaS).toFixed(4)); }
    const el = (performance.now() - t0) / 1000;
    out.textContent = `live ${el.toFixed(1)} s · ctx ${eng.ctx?.state} t=${eng.ctx?.currentTime.toFixed(2)} · ticks ${rep.ticks} · events ${rep.eventsFed} · voices ${sfx.activeVoices}`;
    if (el > 8.5 && !rep.ok && rep.state === '') {
      if (simTimer) clearInterval(simTimer);
      rep.state = eng.ctx?.state ?? 'none';
      rep.ctxTimeEnd = eng.ctx?.currentTime ?? 0;
      rep.track = music.track;
      rep.ok = rep.state === 'running' && rep.ctxTimeEnd - rep.ctxTimeStart > 7 && rep.errors.length === 0
        && rep.musicRms.some((v) => v > 0.005) && rep.sfxRms.some((v) => v > 0.001) && rep.maxVoices <= 24;
      (window as unknown as Record<string, unknown>).__LIVE_REPORT__ = rep;
      (window as unknown as Record<string, unknown>).__SNAP_READY__ = true;
      music.stop();
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
