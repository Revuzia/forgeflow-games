/**
 * CHROMA HIDE — runtime/paint.js  (browser)
 * The paint system — the crown jewel. Wraps three PaintBuffers (albedo /
 * metalness / roughness) into CanvasTextures on a MeshStandardMaterial, and
 * provides: brush painting via raycast-to-UV, an eyedropper that copies a
 * surface's BASE COLOUR only (not its metal/rough — the faithful skill quirk),
 * brush size, palette, x-ray + shadow inspection toggles, orbit-inspect, no undo.
 *
 * Every applied stroke is recorded ({u,v,size,r,g,b,metal,rough}) so the exact
 * paint job can be replayed over the network (chromanet) and hashed headlessly
 * (selftest). Pure stamping math lives in sim/paint_buffer.js.
 */
import * as THREE from "three";
import { PaintBuffer, PAINT_FILLS } from "./sim/paint_buffer.js";
import { clamp, rgbToHex, hexToRgb } from "./sim/util.js";

/**
 * Paint tools. One colour and one brush was never enough to actually imitate a surface:
 * spray gives you soft mottling, marker gives you hard edges (labels, stripes), sponge
 * gives you broken texture. Each tool only re-shapes the dab — the stroke record format
 * is unchanged, so netcode and replay keep working.
 */
export const PAINT_TOOLS = {
  brush:  { id: "brush",  label: "Brush",  icon: "B", sizeMul: 1.00, hardness: 0.60, dabs: 1,  spread: 0 },
  spray:  { id: "spray",  label: "Spray",  icon: "S", sizeMul: 1.15, hardness: 0.06, dabs: 14, spread: 0.95 },
  marker: { id: "marker", label: "Marker", icon: "M", sizeMul: 0.72, hardness: 0.99, dabs: 1,  spread: 0 },
  sponge: { id: "sponge", label: "Sponge", icon: "P", sizeMul: 1.40, hardness: 0.28, dabs: 7,  spread: 1.35 },
};

export class PaintSystem {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.res = opts.res || 1024;

    // three paint buffers + their canvases/textures
    this.buf = {
      albedo: new PaintBuffer(this.res, PAINT_FILLS.albedo),
      metal: new PaintBuffer(this.res, PAINT_FILLS.metal),
      rough: new PaintBuffer(this.res, PAINT_FILLS.rough),
    };
    this.tex = {};
    for (const k of ["albedo", "metal", "rough"]) {
      const c = document.createElement("canvas");
      c.width = c.height = this.res;
      const ctx = c.getContext("2d");
      ctx.putImageData(new ImageData(this.buf[k].data, this.res, this.res), 0, 0);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = k === "albedo" ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      this.tex[k] = t;
      this.buf[k]._canvas = c;
      this.buf[k]._ctx = ctx;
    }

    // material — metalness/roughness scalars must be 1 so the maps fully control
    this.material = new THREE.MeshStandardMaterial({
      map: this.tex.albedo,
      metalnessMap: this.tex.metal,
      roughnessMap: this.tex.rough,
      metalness: 1.0,
      roughness: 1.0,
    });

    // brush state
    this.brush = {
      color: { r: 120, g: 90, b: 70 },
      metal: 0.0,
      rough: 0.8,
      size: this.res * 0.05, // ~50px on 1024
      hardness: 0.6,
      tool: "brush",
    };
    this.strokes = [];      // recorded strokes (net replay + determinism)
    this.palette = [];      // saved swatches (hex)
    this.body = null;
    this.xray = false;
    this._normalDepthTest = true;
  }

  /** Attach the paint material to a body mesh (must have UVs). */
  attachBody(mesh) {
    this.body = mesh;
    this._normalMaterial = mesh.material;
    mesh.material = this.material;
    return this;
  }

  // ── brush setters ─────────────────────────────────────────────────────────
  setColorRgb(r, g, b) { this.brush.color = { r: clamp(r, 0, 255), g: clamp(g, 0, 255), b: clamp(b, 0, 255) }; }
  setColorHex(hex) { const c = hexToRgb(hex); this.setColorRgb(c.r, c.g, c.b); }
  colorHex() { return rgbToHex(this.brush.color.r, this.brush.color.g, this.brush.color.b); }
  setMetal(m) { this.brush.metal = clamp(m, 0, 1); }
  setRough(r) { this.brush.rough = clamp(r, 0, 1); }
  setSize(px) { this.brush.size = clamp(px, 2, this.res * 0.5); }
  nudgeSize(dpx) { this.setSize(this.brush.size + dpx); }
  setTool(id) { if (PAINT_TOOLS[id]) this.brush.tool = id; return this.brush.tool; }
  getTool() { return PAINT_TOOLS[this.brush.tool] || PAINT_TOOLS.brush; }
  savePaletteColor() { const h = this.colorHex(); if (!this.palette.includes(h)) this.palette.push(h); return h; }

  // ── painting ──────────────────────────────────────────────────────────────
  /** Paint at a UV coordinate (records the stroke + updates all three maps). */
  paintAtUV(u, v) {
    const b = this.brush, t = this.getTool();
    const mk = (uu, vv, size) => {
      const s = { u: uu, v: vv, size, r: b.color.r, g: b.color.g, b: b.color.b,
                  metal: b.metal, rough: b.rough, hard: t.hardness };
      this._applyStroke(s); this.strokes.push(s); return s;
    };
    const base = b.size * t.sizeMul;
    if (t.dabs <= 1) return mk(u, v, base);
    // scatter over a disk in UV space — spread is in units of the dab radius
    const rad = (base / this.res) * t.spread;
    let last = null;
    for (let i = 0; i < t.dabs; i++) {
      const ang = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * rad;
      last = mk(clamp(u + Math.cos(ang) * d, 0, 1), clamp(v + Math.sin(ang) * d, 0, 1),
                base * (0.20 + Math.random() * 0.35));
    }
    return last;
  }

  _applyStroke(s) {
    const h = (s.hard != null) ? s.hard : this.brush.hardness;
    const drA = this.buf.albedo.stamp(s.u, s.v, s.size, { r: s.r, g: s.g, b: s.b }, h);
    const mv = Math.round((s.metal ?? 0) * 255), rv = Math.round((s.rough ?? 0.8) * 255);
    const drM = this.buf.metal.stamp(s.u, s.v, s.size, { r: mv, g: mv, b: mv }, h);
    const drR = this.buf.rough.stamp(s.u, s.v, s.size, { r: rv, g: rv, b: rv }, h);
    this._blit("albedo", drA);
    // Two thirds of the upload budget went on the metalness and roughness maps, which
    // most players never move off the defaults. While every stroke so far has used the
    // default finish, those two textures already hold exactly the values being written,
    // so uploading them changes nothing — skip until a stroke actually differs, then
    // stay on permanently.
    const DEF_M = PAINT_FILLS.metal.r, DEF_R = PAINT_FILLS.rough.r;
    if (!this._materialUsed && (mv !== DEF_M || rv !== DEF_R)) this._materialUsed = true;
    if (this._materialUsed) { this._blit("metal", drM); this._blit("rough", drR); }
  }

  /** Push a dirty sub-rect of a buffer into its canvas + flag the texture. */
  /** Push a dirty sub-rect into the 2D canvas and FLAG the texture — but do not upload.
   *
   *  three.js re-uploads a whole CanvasTexture on needsUpdate: there is no partial path.
   *  At 1024² × 4 bytes × three maps that is 12 MB per painting frame, measured at 12.4ms
   *  on top of a 1.15ms idle frame — a stall landing squarely on the core mechanic.
   *  Uploading on a cadence instead (see flushTextures) costs at most ~50ms of latency
   *  before your own dab appears, which is imperceptible, for a 3x cut.
   */
  _blit(k, dr) {
    if (!dr || dr.w <= 0) return;
    const buf = this.buf[k];
    const img = new ImageData(buf.data, this.res, this.res);
    buf._ctx.putImageData(img, 0, 0, dr.x, dr.y, dr.w, dr.h);
    (this._dirty || (this._dirty = {}))[k] = true;
  }

  /** Upload whatever changed. Called on a cadence by the game loop, and unconditionally
   *  at moments where the player must see the result immediately (leaving paint mode,
   *  clearing, the hunt starting). */
  flushTextures() {
    if (!this._dirty) return false;
    let any = false;
    for (const k of ["albedo", "metal", "rough"]) {
      if (this._dirty[k]) { this.tex[k].needsUpdate = true; this._dirty[k] = false; any = true; }
    }
    return any;
  }

  /** Replay a remote/AI stroke list onto this body (chromanet + bots). */
  applyStrokes(list) { for (const s of list) { this._applyStroke(s); this.strokes.push(s); } }

  /** Raycast the pointer against the body; paint if it hits. Returns hit bool. */
  paintAtPointer() {
    if (!this.body) return false;
    const hits = this.engine.raycastPointer([this.body], false);
    if (hits.length && hits[0].uv) { this.paintAtUV(hits[0].uv.x, hits[0].uv.y); return true; }
    return false;
  }

  // ── eyedropper ─────────────────────────────────────────────────────────────
  /**
   * Sample a surface's BASE COLOUR under the pointer and load it into the brush.
   * Faithful quirk: copies colour only — NOT metalness/roughness (those stay as
   * the player set them). Reads material.color, or samples material.map at the UV
   * when the surface is textured. Does not sample the lit framebuffer, so sheen
   * never carries over. Returns the hex sampled, or null on a miss.
   */
  eyedropAtPointer(sceneObjects) {
    const hits = this.engine.raycastPointer(sceneObjects, true);
    if (!hits.length) return null;
    const hit = hits[0];
    const mat = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
    if (!mat) return null;
    let rgb = null;
    if (mat.map && mat.map.image && hit.uv) rgb = this._sampleTexture(mat.map, hit.uv.x, hit.uv.y);
    if (!rgb && mat.color) {
      // material.color is stored LINEAR (color-managed); convert back to the
      // sRGB display value so the sampled hex matches what the player sees and
      // what our sRGB albedo canvas expects.
      const c = mat.color.clone().convertLinearToSRGB();
      rgb = { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) };
    }
    if (!rgb) return null;
    this.setColorRgb(rgb.r, rgb.g, rgb.b);
    return this.colorHex();
  }

  /** Sample a PATCH, not a pixel. One texel is a coin flip on any patterned surface: the
   *  sim scores camouflage against the surface's declared colour, but a single sample can
   *  land on a mortar line or a dark grain and hand back something 90+ RGB units away —
   *  zero blend for a player who did exactly what the game told them to do. Measured on
   *  wood, a typical texel gives 0.56 blend and an unlucky one gives 0.00. Averaging a
   *  small patch converges on the colour the surface actually reads as, which is both
   *  what the player sees and what the sim scores. Real eyedroppers have a sample size. */
  _sampleTexture(tex, u, v) {
    try {
      const PATCH = 9;                       // source texels averaged, per axis
      if (!this._scratch) { this._scratch = document.createElement("canvas"); this._scratch.width = this._scratch.height = 1; }
      const sc = this._scratch, sx = sc.getContext("2d");
      sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = "high";
      const iw = tex.image.width, ih = tex.image.height;
      const px = (u % 1) * iw, py = (1 - (v % 1)) * ih;
      const half = PATCH / 2;
      // clamp the patch inside the image so the average is never padded with transparent
      const sx0 = Math.max(0, Math.min(iw - PATCH, px - half));
      const sy0 = Math.max(0, Math.min(ih - PATCH, py - half));
      sx.clearRect(0, 0, 1, 1);
      sx.drawImage(tex.image, sx0, sy0, PATCH, PATCH, 0, 0, 1, 1);
      const p = sx.getImageData(0, 0, 1, 1).data;
      return { r: p[0], g: p[1], b: p[2] };
    } catch (e) { return null; }
  }

  // ── inspection aids ─────────────────────────────────────────────────────────
  /** X-ray: render the body through walls so wall-pressed areas can be painted. */
  toggleXray() {
    this.xray = !this.xray;
    this.material.depthTest = !this.xray;
    this.material.transparent = this.xray;
    this.material.opacity = this.xray ? 0.75 : 1.0;
    this.body && (this.body.renderOrder = this.xray ? 999 : 0);
    this.material.needsUpdate = true;
    return this.xray;
  }

  /** Toggle the body's cast shadow (keep whichever blends better). */
  toggleShadow() { if (this.body) this.body.castShadow = !this.body.castShadow; return this.body ? this.body.castShadow : false; }

  /** Reset all three maps to blank (there is NO undo — this is a full clear). */
  clear() {
    this.strokes.length = 0;
    this.buf.albedo.fillAll(PAINT_FILLS.albedo);
    this.buf.metal.fillAll(PAINT_FILLS.metal);
    this.buf.rough.fillAll(PAINT_FILLS.rough);
    for (const k of ["albedo", "metal", "rough"]) {
      this.buf[k]._ctx.putImageData(new ImageData(this.buf[k].data, this.res, this.res), 0, 0);
      this.tex[k].needsUpdate = true;   // a wipe is instant, never deferred
    }
  }

  hashes() { return { albedo: this.buf.albedo.hash(), metal: this.buf.metal.hash(), rough: this.buf.rough.hash() }; }
  dispose() { for (const k of ["albedo", "metal", "rough"]) this.tex[k].dispose(); this.material.dispose(); }
}
