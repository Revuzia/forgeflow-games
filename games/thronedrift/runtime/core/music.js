// Thronedrift — stock-music player (Kenney pool via audio_mapper).
// Three looping beds: menu / level / boss, crossfaded on state changes.
// Uses <audio> elements so game_controls.js global mute covers music too.
// Autoplay policy: first .play() may reject pre-gesture — retried on the next
// play() call, and boot retries once on the first pointerdown.

const TRACKS = {
  menu: "assets/audio/music_menu.ogg",
  level: "assets/audio/music_level.ogg",
  boss: "assets/audio/music_boss.ogg",
};
const BASE_VOL = { menu: 0.4, level: 0.34, boss: 0.42 };

let master = 0.5;          // scaled by the settings volume
let current = null, currentName = null;
const pool = {};

function elFor(name) {
  if (!pool[name]) {
    const a = new Audio(TRACKS[name]);
    a.loop = true;
    a.preload = "auto";
    pool[name] = a;
  }
  return pool[name];
}

export const Music = {
  play(name) {
    if (!TRACKS[name]) return;
    if (currentName === name) { this.resume(); return; }
    const next = elFor(name);
    const prev = current;
    current = next; currentName = name;
    next.volume = 0;
    next.currentTime = 0;
    next.play().catch(() => {});     // pre-gesture rejection is fine; resume() retries
    // quick JS crossfade (no WebAudio graph needed for two elements)
    const t0 = performance.now(), DUR = 900;
    const targetV = BASE_VOL[name] * master;
    const prevV = prev ? prev.volume : 0;
    const step = () => {
      const f = Math.min(1, (performance.now() - t0) / DUR);
      next.volume = targetV * f;
      if (prev) prev.volume = prevV * (1 - f);
      if (f < 1) requestAnimationFrame(step);
      else if (prev && prev !== next) prev.pause();
    };
    requestAnimationFrame(step);
  },
  resume() { if (current && current.paused) current.play().catch(() => {}); },
  stop() { if (current) { current.pause(); current = null; currentName = null; } },
  setVolume(v) {
    master = Math.max(0, Math.min(1, v));
    if (current && currentName) current.volume = BASE_VOL[currentName] * master;
  },
  currentName: () => currentName,
};
