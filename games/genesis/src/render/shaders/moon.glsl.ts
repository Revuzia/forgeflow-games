// GENESIS — moonlight for every lit surface (fix pass): the brightest moon in the sky as a second directional light
// (renderer.ts sets uMoonE / uMoonDirBody / uMoonDirView on the planet's shared uniforms; zero when no moon is up).
// The terrain and the forest floor had it; buildings, roads, trees, people, animals and boats only saw the moon through
// the night ambient, so on moonlit ground a village stood as black silhouettes and its roads as black bars.

export const MOON_PARS = /* glsl */ `
uniform vec3 uMoonE;
uniform vec3 uMoonDirBody;
uniform vec3 uMoonDirView;
`;

/**
 * GLSL statements adding the moon's direct light (inside a three.js lights block: needs geometryPosition,
 * geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight). `bodyPos` is a body-frame
 * position expression; `k` a scale expression (occlusion, crown shading).
 */
export function moonDirect(bodyPos: string, k = '1.0'): string {
  return /* glsl */ `
  if (dot(uMoonE, uMoonE) > 0.0) {
    IncidentLight moonL;
    moonL.direction = uMoonDirView;
    moonL.color = uMoonE * smoothstep(-0.03, 0.06, dot(normalize(${bodyPos}), uMoonDirBody)) * (${k});
    moonL.visible = true;
    RE_Direct(moonL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  }`;
}
