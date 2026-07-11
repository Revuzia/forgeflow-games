/**
 * Dungeon Forge — runtime/3d/stair_marker.js
 * A descending-stairwell marker for the OTHER end of a staircase (the landing
 * cell on the connected floor). Recessed steps heading toward the origin cell +
 * a green glow ring + a down chevron, so the spot reads as "stairs — step here
 * to go down" on both floors. Shared by the escape and builder renderers.
 */
import * as THREE from "three";

export function landingMarker(L, CELL) {
  const grp = new THREE.Group();
  // orient so the steps descend toward the origin cell (one floor away)
  const ddx = Math.sign((L.from.x || 0) - (L.to.x || 0)), ddz = Math.sign((L.from.z || 0) - (L.to.z || 0));
  const rot = ddz > 0 ? 0 : ddx > 0 ? 1 : ddz < 0 ? 2 : 3;
  grp.rotation.y = -rot * Math.PI / 2;
  // A recessed stairwell descending into the floor — reads as "stairs down" on
  // its own, no glowing ring/light (owner: "we can see the tile that it's stairs
  // down"). Just a dark pit + three descending steps.
  const pit = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.82, 0.5, CELL * 0.82), new THREE.MeshStandardMaterial({ color: 0x0c0f16, roughness: 1 }));
  pit.position.y = -0.24; grp.add(pit);                  // sunk into the floor
  for (let i = 0; i < 3; i++) {                          // three descending steps (into +z = toward origin)
    const s = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.7, 0.14, CELL * 0.22),
      new THREE.MeshStandardMaterial({ color: 0x3a4560, roughness: 0.8, metalness: 0.12 }));
    s.position.set(0, 0.02 - i * 0.16, -CELL * 0.24 + i * CELL * 0.24);
    grp.add(s);
  }
  return grp;
}
