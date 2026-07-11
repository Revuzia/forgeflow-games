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
  const stepMat = new THREE.MeshStandardMaterial({ color: 0x2a3550, roughness: 0.85, metalness: 0.1 });
  const pit = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.78, 0.24, CELL * 0.78), new THREE.MeshStandardMaterial({ color: 0x12161f, roughness: 1 }));
  pit.position.y = 0.12; grp.add(pit);
  for (let i = 0; i < 3; i++) {                          // three receding steps (into +z = toward origin)
    const s = new THREE.Mesh(new THREE.BoxGeometry(CELL * 0.66, 0.16, CELL * 0.2), stepMat);
    s.position.set(0, 0.30 - i * 0.12, -CELL * 0.2 + i * CELL * 0.2);
    grp.add(s);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.09, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0x59ff9c, transparent: true, opacity: 0.85 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.55; grp.add(ring);
  const chev = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.4, 4),
    new THREE.MeshBasicMaterial({ color: 0x59ff9c, transparent: true, opacity: 0.9 }));
  chev.rotation.x = Math.PI; chev.position.y = 0.55; grp.add(chev);
  grp.userData.ring = ring;
  return grp;
}
