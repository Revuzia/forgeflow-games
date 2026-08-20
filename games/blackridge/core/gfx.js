// core/gfx.js [A0] — renderer construction, caps, DPR, resize
// (architecture §3.18). Post owns tonemapping (toneMapping NONE here);
// output stays linear (post encodes). info.autoReset=false — the ONE reset
// per frame lives in boot.js's frame fn and nowhere else.

import * as THREE from "three";

// PERF GATE (owner decision 2026-08-20: 60 fps on Intel integrated is a HARD
// gate above visuals). Measured on this box with EXT_disjoint_timer_query_webgl2:
// at DPR 1.5 the drawing buffer is 2880x1620 = 4.67 Mpx; at 1.0 it is 1920x1080
// = 2.07 Mpx. The frame is 93% GPU and almost entirely fill-bound, so that 2.25x
// pixel cut is very close to a 2.25x frame-time cut — the single biggest lever
// on the board (ablation: 182.8 -> 84.1 ms, -54%, everything else held).
// The image quality that DPR 1.5 was buying is bought back by the FXAA pass in
// post.js (~1 ms) instead of by 4.67 Mpx of supersample.
export const DPR_CAP = 1.0; // doctrine §3 — never above 1.5; perf gate pins 1.0

export function initRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    // v3: the composer's HDR target now carries samples:4 (post.js build()),
    // which is what actually anti-aliases the scene — every scene pass goes
    // through the composer, so this flag only covers direct-to-canvas draws.
    // Left false deliberately: enabling it allocates a second MSAA backbuffer
    // that nothing renders into. The old comment ("bloom+grain hide it") was
    // the bug — grain was hiding aliasing instead of the pipeline removing it.
    antialias: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // post encodes
  renderer.toneMapping = THREE.NoToneMapping;             // post owns AgX
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;       // 1024 map, moon only
  // v2.2: PCFSoft honours shadow.radius — plain PCF ignored it, so the moon
  // shadow (radius 4, LD §3.2) rendered hard (A6 needsElsewhere).
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.info.autoReset = false;                        // honest counters
  return renderer;
}

// Mirrors the index.html capability gate (the two are duplicated on purpose:
// the gate must run before any module load, so it cannot import this).
// Same return shape: `ok` = can run, `fatal` = why it cannot.
export function checkCaps() {
  const missing = [];
  let gl = null;
  try {
    gl = document.createElement("canvas").getContext("webgl2");
  } catch (e) { /* some builds throw */ }

  if (!gl) {
    missing.push("WebGL2");
  } else {
    if (!gl.getExtension("EXT_color_buffer_float")) missing.push("EXT_color_buffer_float");
    if (!gl.getExtension("OES_texture_float_linear")) missing.push("OES_texture_float_linear");
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  }

  const fatal = [];
  if (missing.includes("WebGL2")) fatal.push("WebGL2");
  if (missing.includes("EXT_color_buffer_float")) fatal.push("EXT_color_buffer_float");
  return { ok: fatal.length === 0, fatal, missing };
}
