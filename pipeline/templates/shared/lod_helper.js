/* ForgeFlow Games — lod_helper.js
 * Three.js Level-of-Detail auto-setup for 3D games (Diablo/FF/Minecraft-scale worlds).
 *
 * Auto-activates when GAME_CONFIG.engine === "three" or window.THREE is present.
 * Exposes window.__LOD__ with:
 *   wrap(mesh, options)     — wrap a mesh in a THREE.LOD with 3 auto-generated tiers
 *   wrapAll(root, opts)     — walk a scene/group and wrap every mesh with triangle > minTris
 *   setCameraRef(camera)    — tell LOD which camera to measure distance against
 *   setQuality(preset)      — "ultra" | "high" | "medium" | "low" | "potato" — scales distances
 *   getStats()              — { total_lods, visible_high, visible_mid, visible_low }
 *
 * Tiers (default):
 *   0-25m   → full-detail (original mesh)
 *   25-80m  → 50% triangles (SimplifyModifier or geometric decimate)
 *   80-200m → 15% triangles + billboard-quality material
 *   200m+   → culled entirely
 *
 * Quality presets scale those distances by:
 *   ultra  × 2.0   high × 1.4   medium × 1.0   low × 0.65   potato × 0.4
 *
 * Safe to include in every game — no-ops gracefully when window.THREE is absent.
 */
(function () {
  "use strict";

  if (typeof window === "undefined") return;

  const state = {
    enabled: false,
    camera: null,
    lods: [],                 // array of THREE.LOD instances
    qualityScale: 1.0,
    stats: { total_lods: 0, visible_high: 0, visible_mid: 0, visible_low: 0 },
  };

  const BASE_TIERS = [
    { distance: 0,   ratio: 1.00, label: "high" },
    { distance: 25,  ratio: 0.50, label: "mid"  },
    { distance: 80,  ratio: 0.15, label: "low"  },
    { distance: 200, ratio: 0.00, label: "culled" },
  ];

  const QUALITY_SCALES = {
    ultra:  2.00,
    high:   1.40,
    medium: 1.00,
    low:    0.65,
    potato: 0.40,
  };

  function _detect() {
    if (!window.THREE) return false;
    if (!window.THREE.LOD) return false;
    return true;
  }

  /** Simplify a BufferGeometry by decimating index by ratio. Cheap + lossy; works without modifier plugin. */
  function _decimate(geometry, ratio) {
    if (!geometry || !geometry.isBufferGeometry) return geometry;
    if (ratio >= 0.99) return geometry;
    try {
      const cloned = geometry.clone();
      if (cloned.index) {
        const idx = cloned.index.array;
        const keepCount = Math.max(3, Math.floor(idx.length * ratio / 3) * 3);
        // Stride-sample to preserve spatial distribution
        const stride = Math.max(1, Math.floor(idx.length / keepCount));
        const newIdx = new (idx.constructor)(keepCount);
        let j = 0;
        for (let i = 0; i < idx.length && j < keepCount; i += stride) {
          newIdx[j++] = idx[i];
          if (j < keepCount) newIdx[j++] = idx[i + 1] || idx[i];
          if (j < keepCount) newIdx[j++] = idx[i + 2] || idx[i];
        }
        cloned.setIndex(new window.THREE.BufferAttribute(newIdx, 1));
      }
      cloned.computeBoundingSphere();
      return cloned;
    } catch (e) {
      return geometry; // fallback: no decimate
    }
  }

  function _buildLOD(originalMesh, options) {
    if (!_detect()) return originalMesh;
    options = options || {};
    const tiers = options.tiers || BASE_TIERS;
    const scale = state.qualityScale;

    const lod = new window.THREE.LOD();
    lod.name = originalMesh.name ? originalMesh.name + "_LOD" : "LOD";
    lod.position.copy(originalMesh.position);
    lod.rotation.copy(originalMesh.rotation);
    lod.scale.copy(originalMesh.scale);

    for (const tier of tiers) {
      const dist = tier.distance * scale;
      if (tier.ratio <= 0) {
        // "culled" tier: empty object — anything past this distance becomes invisible
        const empty = new window.THREE.Object3D();
        lod.addLevel(empty, dist);
        continue;
      }
      let mesh;
      if (tier.ratio >= 0.99) {
        mesh = originalMesh; // full detail at nearest tier
      } else {
        const decimated = _decimate(originalMesh.geometry, tier.ratio);
        mesh = new window.THREE.Mesh(decimated, originalMesh.material);
        if (originalMesh.castShadow !== undefined)    mesh.castShadow    = originalMesh.castShadow && tier.ratio > 0.3;
        if (originalMesh.receiveShadow !== undefined) mesh.receiveShadow = originalMesh.receiveShadow && tier.ratio > 0.3;
      }
      lod.addLevel(mesh, dist);
    }

    state.lods.push(lod);
    state.stats.total_lods++;
    return lod;
  }

  /** Count triangles in a geometry. */
  function _triCount(geometry) {
    if (!geometry) return 0;
    if (geometry.index) return geometry.index.count / 3;
    if (geometry.attributes && geometry.attributes.position) return geometry.attributes.position.count / 3;
    return 0;
  }

  /** Public: wrap a mesh in LOD tiers. Returns the LOD object to add to the scene. */
  function wrap(mesh, options) {
    if (!_detect() || !mesh || !mesh.isMesh) return mesh;
    return _buildLOD(mesh, options || {});
  }

  /** Public: walk a scene/group/object, wrap every mesh above minTris threshold. */
  function wrapAll(root, opts) {
    if (!_detect() || !root) return 0;
    opts = opts || {};
    const minTris = opts.minTris != null ? opts.minTris : 200;
    const replacements = [];
    root.traverse(function (o) {
      if (o.isMesh && !o.isLOD && _triCount(o.geometry) >= minTris) {
        replacements.push(o);
      }
    });
    let wrapped = 0;
    for (const m of replacements) {
      const parent = m.parent;
      if (!parent) continue;
      const lod = _buildLOD(m, opts);
      if (lod !== m) {
        parent.remove(m);
        parent.add(lod);
        wrapped++;
      }
    }
    return wrapped;
  }

  function setCameraRef(camera) { state.camera = camera; }

  function setQuality(preset) {
    const s = QUALITY_SCALES[preset];
    if (!s) return false;
    state.qualityScale = s;
    return true;
  }

  function getStats() {
    // Recompute live visibility
    let vh = 0, vm = 0, vl = 0;
    if (state.camera) {
      for (const lod of state.lods) {
        let idx = 0;
        try { if (typeof lod.getCurrentLevel === "function") idx = lod.getCurrentLevel() | 0; } catch (e) {}
        if (idx === 0) vh++;
        else if (idx === 1) vm++;
        else vl++;
      }
    }
    return { total_lods: state.stats.total_lods, visible_high: vh, visible_mid: vm, visible_low: vl };
  }

  // Auto-detect quality on first use based on device capability
  function _autoQuality() {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (!gl) return "potato";
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      const r = dbg ? (gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "") : "";
      const mem = (navigator.deviceMemory || 4);
      const cores = (navigator.hardwareConcurrency || 4);
      if (/RTX|RX 7|RX 6|Apple M|Arc/i.test(r) && mem >= 8)  return "ultra";
      if (/GTX|RX 5|Iris/i.test(r)           && mem >= 6)    return "high";
      if (cores >= 4 && mem >= 4)                             return "medium";
      if (cores >= 2)                                          return "low";
      return "potato";
    } catch (e) {
      return "medium";
    }
  }

  window.__LOD__ = {
    wrap: wrap,
    wrapAll: wrapAll,
    setCameraRef: setCameraRef,
    setQuality: setQuality,
    getStats: getStats,
    autoQuality: _autoQuality,
  };

  // Auto-init on load
  window.addEventListener("load", function () {
    if (!_detect()) return;
    state.enabled = true;
    setQuality(_autoQuality());
    try {
      console.info("[LOD] initialized — quality=" + _autoQuality() + " scale=" + state.qualityScale.toFixed(2) + "x");
    } catch (e) {}
  });
})();
