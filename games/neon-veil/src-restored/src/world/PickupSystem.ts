import * as THREE from 'three';
import { PICKUPS } from '../core/config';
import type { WeaponId } from '../core/types';

export type PickupKind = 'weapon' | 'health' | 'shield' | 'ammo';

export interface PickupDef {
  kind: PickupKind;
  weapon?: WeaponId;
  amount: number;
  label: string;
  color: number;
}

export interface Pickup {
  id: number;
  def: PickupDef;
  mesh: THREE.Group;
  position: THREE.Vector3;
  alive: boolean;
  respawnAt: number;
  bob: number;
}

const WEAPON_PICKUPS: PickupDef[] = [
  { kind: 'weapon', weapon: 'laser', amount: 1, label: 'LASER', color: 0x39ff88 },
  { kind: 'weapon', weapon: 'torpedo', amount: 4, label: 'TORPEDO', color: 0xff6622 },
  { kind: 'weapon', weapon: 'rail', amount: 6, label: 'RAIL', color: 0xff2bd6 },
  { kind: 'weapon', weapon: 'rocket', amount: 2, label: 'ROCKET ×2', color: 0xffaa44 },
  { kind: 'weapon', weapon: 'scatter', amount: 12, label: 'SCATTER', color: 0xffe566 },
];

const UTILITY: PickupDef[] = [
  { kind: 'health', amount: 40, label: 'HULL+', color: 0xff4466 },
  { kind: 'shield', amount: 50, label: 'SHIELD+', color: 0x00f0ff },
  { kind: 'ammo', amount: 1, label: 'RELOAD', color: 0xaaccff },
];

/** Floating neon crates — fly through to grab weapons / repairs. */
export class PickupSystem {
  group = new THREE.Group();
  pickups: Pickup[] = [];
  private nextId = 1;
  private time = 0;

  spawnForMap(bounds: number, count = 22) {
    this.clear();
    const defs = [...WEAPON_PICKUPS, ...WEAPON_PICKUPS, ...UTILITY];
    for (let i = 0; i < count; i++) {
      const def = defs[i % defs.length];
      const a = (i / count) * Math.PI * 2 + hash(i) * 0.8;
      const r = 50 + hash(i + 3) * bounds * 0.55;
      const y = 18 + hash(i + 7) * 90;
      const pos = new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
      this.spawnOne(def, pos);
    }
  }

  private spawnOne(def: PickupDef, pos: THREE.Vector3) {
    // Cargo crate look — box + beacon (not ship-like rings/chevrons)
    const root = new THREE.Group();
    root.position.copy(pos);

    const crateMat = new THREE.MeshStandardMaterial({
      color: 0x1a1428,
      metalness: 0.45,
      roughness: 0.55,
      emissive: def.color,
      emissiveIntensity: 0.35,
    });
    const edgeMat = new THREE.MeshBasicMaterial({
      color: def.color,
      toneMapped: false,
      transparent: true,
      opacity: 0.95,
    });

    // Main crate
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.0, 2.4), crateMat);
    root.add(body);
    // Lid stripe
    const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.2, 2.5), edgeMat);
    lid.position.y = 1.05;
    root.add(lid);
    // Corner posts
    for (const [x, z] of [
      [-1.1, -1.1],
      [1.1, -1.1],
      [-1.1, 1.1],
      [1.1, 1.1],
    ] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.1, 0.18), edgeMat);
      post.position.set(x, 0, z);
      root.add(post);
    }

    // Vertical beacon (reads as loot, not a pilot)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.35, 10, 6),
      new THREE.MeshBasicMaterial({
        color: def.color,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        toneMapped: false,
      })
    );
    beam.position.y = 6;
    root.add(beam);

    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 8, 8),
      new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false })
    );
    cap.position.y = 11.2;
    root.add(cap);

    const label = makeSprite(`▣ ${def.label}`, def.color);
    label.position.y = 3.6;
    root.add(label);

    this.group.add(root);
    this.pickups.push({
      id: this.nextId++,
      def,
      mesh: root,
      position: pos.clone(),
      alive: true,
      respawnAt: 0,
      bob: hash(this.nextId) * Math.PI * 2,
    });
  }

  update(dt: number) {
    this.time += dt;
    for (const p of this.pickups) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) {
          p.alive = true;
          p.mesh.visible = true;
        }
        continue;
      }
      p.mesh.rotation.y += dt * 0.7;
      p.mesh.position.y = p.position.y + Math.sin(this.time * 2.2 + p.bob) * 0.55;
      // Pulse beacon
      const beam = p.mesh.children[6];
      if (beam) {
        const s = 0.9 + Math.sin(this.time * 3 + p.bob) * 0.12;
        beam.scale.set(s, 1, s);
      }
    }
  }

  /**
   * Collect if close. Crate disappears for everyone and respawns after
   * `PICKUPS.respawnSec` (default 20s) — no permanent monopoly.
   */
  tryCollect(pos: THREE.Vector3, radius = PICKUPS.collectRadius): PickupDef | null {
    for (const p of this.pickups) {
      if (!p.alive) continue;
      if (pos.distanceTo(p.mesh.position) < radius) {
        p.alive = false;
        p.mesh.visible = false;
        p.respawnAt = this.time + PICKUPS.respawnSec;
        return p.def;
      }
    }
    return null;
  }

  /** Seconds remaining until next respawn (for HUD debug). */
  respawnDelaySec() {
    return PICKUPS.respawnSec;
  }

  blips(): Array<{ x: number; z: number }> {
    return this.pickups.filter((p) => p.alive).map((p) => ({ x: p.position.x, z: p.position.z }));
  }

  /** Persist crate state when leaving a biome instance. */
  exportState(): { time: number; items: Array<{ alive: boolean; respawnAt: number }> } {
    return {
      time: this.time,
      items: this.pickups.map((p) => ({ alive: p.alive, respawnAt: p.respawnAt })),
    };
  }

  /** Restore crate state when re-entering a biome instance. */
  importState(state: { time: number; items: Array<{ alive: boolean; respawnAt: number }> } | null) {
    if (!state || state.items.length !== this.pickups.length) return;
    this.time = state.time;
    for (let i = 0; i < this.pickups.length; i++) {
      const p = this.pickups[i];
      const s = state.items[i];
      p.alive = s.alive;
      p.respawnAt = s.respawnAt;
      p.mesh.visible = p.alive;
    }
  }

  clear() {
    while (this.group.children.length) {
      const o = this.group.children.pop()!;
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mat = m.material as THREE.Material | THREE.Material[];
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat.dispose();
        }
      });
    }
    this.pickups = [];
  }
}

function hash(n: number) {
  let x = (n * 374761393) | 0;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967295;
}

function makeSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 40;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(4, 6, 120, 28);
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
  ctx.fillText(text, 64, 20);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(8, 2.5, 1);
  return s;
}
