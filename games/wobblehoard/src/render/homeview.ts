// PLAYGROUND (Home, D-67, D-87, RD-16): the table area visible inside the frame and outside the HUD safe insets at a camera framing, by
// projection, as ONE ground box [xMin, zMin, xMax, zMax]: its z range runs from the ground row under the top inset line to the ground row
// under the bottom inset line, its x range is the near row's (the narrowest: the visible ground narrows toward the camera), each clipped to
// +-3.4 m (PLAYGROUND_BUILD.md 9). Pure (no three, no DOM), so node checks it against three's own projection (pg_render's probe). The stage
// calls it with its rest framing of the mat slots in use (yaw 0, zoom 1, no ceremony push: stage.ts visibleTable).
//
// The camera (stage.ts updateCamera at yaw 0): it sits at aim + dist x (0, sin p, cos p) and looks at the aim, so its forward is
// (0, -sin p, -cos p), its right (1, 0, 0) and its up (0, cos p, -sin p); a screen point at NDC (nx, ny) casts the ray
// forward + nx tan(fov / 2) aspect right + ny tan(fov / 2) up. A ray that never reaches the ground (above the horizon) counts as the far clip.

/** The felt's reach and the clip of every edge of the box (PLAYGROUND_BUILD.md 9: +-3.4 m). */
export const TABLE_CLIP = 5.5;   // (round 14, R14_ROOMS, D-104: the felt's reach is Home's room now, r 5.5 m; it was 3.4)

/**
 * Writes [xMin, zMin, xMax, zMax] into out[0..3]. aim (ax, ay, az): the camera's look-at point; dist: its distance; pitch in radians;
 * fovDeg: the vertical field of view; cssW / cssH: the frame; insets in CSS px. Returns false when the frame or the numbers are unusable.
 */
export function visibleTableAt(
  ax: number, ay: number, az: number, dist: number, pitch: number, fovDeg: number, cssW: number, cssH: number,
  top: number, right: number, bottom: number, left: number, out: Float32Array | number[],
): boolean {
  if (!(cssW > 1 && cssH > 1 && dist > 0) || !Number.isFinite(ax + ay + az + dist + pitch + fovDeg)) return false;
  const s = Math.sin(pitch), c = Math.cos(pitch), ty = Math.tan((fovDeg * Math.PI) / 360), tx = ty * (cssW / cssH);
  const py = ay + dist * s, pz = az + dist * c;
  const nyTop = 1 - (2 * Math.max(0, top)) / cssH, nyBot = -1 + (2 * Math.max(0, bottom)) / cssH;
  const nxL = -1 + (2 * Math.max(0, left)) / cssW, nxR = 1 - (2 * Math.max(0, right)) / cssW;
  if (!(nyTop > nyBot && nxR > nxL)) return false;
  const C = TABLE_CLIP;
  // the ground z under a screen row (the row's centre ray; at yaw 0 a row of the screen is a line of constant z on the ground)
  const rowZ = (ny: number): number => {
    const dy = -s + ny * ty * c, dz = -c - ny * ty * s;
    if (dy >= -1e-9) return -Infinity;            // at or above the horizon: as far as it goes
    const t = -py / dy;
    return pz + t * dz;
  };
  // the ground x at the near row's edge (nx at the bottom inset line)
  const rowX = (nx: number, ny: number): number => {
    const dy = -s + ny * ty * c;
    if (dy >= -1e-9) return nx < 0 ? -Infinity : Infinity;
    const t = -py / dy;
    return ax + t * nx * tx;
  };
  const zFar = rowZ(nyTop), zNear = rowZ(nyBot);
  const cl = (v: number): number => Math.max(-C, Math.min(C, v));
  out[0] = cl(rowX(nxL, nyBot)); out[1] = cl(zFar); out[2] = cl(rowX(nxR, nyBot)); out[3] = cl(zNear);
  return out[0] < out[2] && out[1] < out[3];
}
