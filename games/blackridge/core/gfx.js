// core/gfx.js [A0] — renderer construction, caps, DPR, resize
// (architecture §3.18). Post owns tonemapping (toneMapping NONE here);
// output stays linear (post encodes). info.autoReset=false — the ONE reset
// per frame lives in boot.js's frame fn and nowhere else.

import * as THREE from "three";

export const DPR_CAP = 1.5; // doctrine §3 — never above 1.5

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
