import * as THREE from 'three';
import { WEAPONS } from '../core/config';
import type { WeaponDef, WeaponId } from '../core/types';

export interface HomingTarget {
  id: string;
  position: THREE.Vector3;
  alive: boolean;
}

export interface Projectile {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  weapon: WeaponId;
  ownerId: string;
  life: number;
  damage: number;
  splash: number;
  mesh: THREE.Mesh;
  selfDamageScale: number;
  /** Heat-seek lock — rockets / soft torpedoes. */
  targetId: string | null;
  homing: number;
  maxSpeed: number;
}

export interface HitscanResult {
  weapon: WeaponId;
  ownerId: string;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  damage: number;
  end: THREE.Vector3;
}

const ALL_ORDER: WeaponId[] = ['plasma', 'rocket', 'rail', 'laser', 'torpedo', 'scatter'];

export class WeaponSystem {
  current: WeaponId = 'plasma';
  /** Unlocked weapons (plasma always). */
  unlocked: Set<WeaponId> = new Set(['plasma']);
  ammo: Record<WeaponId, number> = {
    plasma: -1,
    rocket: WEAPONS.rocket.ammo,
    rail: WEAPONS.rail.ammo,
    laser: 0,
    torpedo: 0,
    scatter: 0,
  };
  private cooldown = 0;
  private order: WeaponId[] = ['plasma', 'rocket', 'rail', 'laser', 'torpedo', 'scatter'];
  pool: Projectile[] = [];
  private scene: THREE.Scene;
  private trailGroup: THREE.Group;
  private railBeams: Array<{ line: THREE.Line; life: number }> = [];

  readonly muzzleFlash = new THREE.PointLight(0x00f0ff, 0, 12);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.trailGroup = new THREE.Group();
    scene.add(this.trailGroup);
    scene.add(this.muzzleFlash);

    for (let i = 0; i < 64; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.95 });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 6), mat);
      mesh.visible = false;
      this.trailGroup.add(mesh);
      this.pool.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        weapon: 'plasma',
        ownerId: '',
        life: 0,
        damage: 0,
        splash: 0,
        mesh,
        selfDamageScale: 0,
        targetId: null,
        homing: 0,
        maxSpeed: 220,
      });
    }
  }

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }

  select(id: WeaponId) {
    if (id !== 'plasma' && !this.unlocked.has(id) && this.ammo[id] <= 0) return;
    this.current = id;
  }

  unlock(id: WeaponId) {
    this.unlocked.add(id);
  }

  grantWeapon(id: WeaponId, ammoBonus: number) {
    this.unlock(id);
    if (this.ammo[id] < 0) return;
    const cap = Math.max(WEAPONS[id].ammo * 2, ammoBonus);
    this.ammo[id] = Math.min(cap, Math.max(0, this.ammo[id]) + ammoBonus);
    this.current = id;
  }

  grantAmmoAll(scale = 0.5) {
    for (const id of ALL_ORDER) {
      if (id === 'plasma') continue;
      if (!this.unlocked.has(id) && this.ammo[id] <= 0) continue;
      const base = WEAPONS[id].ammo;
      if (base < 0) continue;
      this.ammo[id] = Math.min(base * 2, this.ammo[id] + Math.ceil(base * scale));
    }
  }

  cycle(dir: number) {
    const usable = this.order.filter((id) => id === 'plasma' || this.unlocked.has(id) || this.ammo[id] > 0);
    if (usable.length === 0) return;
    const i = usable.indexOf(this.current);
    const n = (Math.max(0, i) + dir + usable.length) % usable.length;
    this.current = usable[n];
  }

  trySelectSlot(slot: number) {
    // 1-6 map to order
    if (slot >= 1 && slot <= this.order.length) {
      const id = this.order[slot - 1];
      if (id === 'plasma' || this.unlocked.has(id) || this.ammo[id] > 0) this.current = id;
    }
  }

  /**
   * @param targets living pilots for heat-seek lock (exclude self via ownerId).
   */
  update(dt: number, targets: HomingTarget[] = []) {
    if (this.cooldown > 0) this.cooldown -= dt;
    this.muzzleFlash.intensity = Math.max(0, this.muzzleFlash.intensity - dt * 40);

    const desired = new THREE.Vector3();

    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;

      if (p.homing > 0 && p.targetId) {
        // Only track the latch target from fire — no free re-acquire mid-flight
        const lock = targets.find((t) => t.id === p.targetId && t.alive);
        if (lock) {
          desired.copy(lock.position).sub(p.position).normalize();
          const speed = Math.max(p.maxSpeed * 0.55, p.velocity.length());
          const steer = p.homing * dt;
          p.velocity.lerp(desired.multiplyScalar(speed), Math.min(1, steer));
          const sp = p.velocity.length();
          if (sp > p.maxSpeed) p.velocity.multiplyScalar(p.maxSpeed / sp);
          else if (sp < p.maxSpeed * 0.7) p.velocity.multiplyScalar((p.maxSpeed * 0.85) / Math.max(sp, 1e-3));
        } else {
          // Target dead / gone — go dumb
          p.homing = 0;
          p.targetId = null;
        }
      }

      if (p.weapon === 'torpedo' && p.homing <= 0) {
        p.velocity.y -= 4 * dt;
      }

      p.position.addScaledVector(p.velocity, dt);
      p.mesh.position.copy(p.position);
      // Point rocket mesh along velocity
      if (p.homing > 0 && p.velocity.lengthSq() > 1) {
        p.mesh.lookAt(p.position.x + p.velocity.x, p.position.y + p.velocity.y, p.position.z + p.velocity.z);
      }
      if (p.life <= 0) this.deactivate(p);
    }

    for (let i = this.railBeams.length - 1; i >= 0; i--) {
      const b = this.railBeams[i];
      b.life -= dt;
      const mat = b.line.material as THREE.LineBasicMaterial;
      mat.opacity = Math.max(0, b.life * 5);
      if (b.life <= 0) {
        this.scene.remove(b.line);
        b.line.geometry.dispose();
        mat.dispose();
        this.railBeams.splice(i, 1);
      }
    }
  }

  canFire(): boolean {
    if (this.cooldown > 0) return false;
    const a = this.ammo[this.current];
    return a === -1 || a > 0;
  }

  fire(
    ownerId: string,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    opts?: { lockTargetId?: string | null; requireLock?: boolean }
  ): { projectiles?: Projectile[]; hitscan?: HitscanResult[] } | null {
    if (!this.canFire()) return null;
    const def = this.def;

    // Rockets need a completed heat latch — no free homing spam
    if (def.id === 'rocket' && opts?.requireLock !== false) {
      if (!opts?.lockTargetId) return null;
    }

    this.cooldown = 1 / def.fireRate;
    if (this.ammo[this.current] > 0) this.ammo[this.current]--;

    this.muzzleFlash.color.setHex(def.color);
    this.muzzleFlash.intensity = def.id === 'laser' ? 5 : 8;
    this.muzzleFlash.position.copy(origin);

    // Hitscan: rail + laser
    if (def.projectileSpeed <= 0) {
      const range = def.id === 'laser' ? 280 : 400;
      const end = origin.clone().addScaledVector(direction, range);
      this.spawnRailBeam(origin, end, def.trailColor, def.id === 'laser' ? 0.08 : 0.25);
      return {
        hitscan: [
          {
            weapon: def.id,
            ownerId,
            origin: origin.clone(),
            direction: direction.clone(),
            damage: def.damage,
            end,
          },
        ],
      };
    }

    // Scatter: multi pellet
    if (def.id === 'scatter') {
      const pellets: Projectile[] = [];
      for (let i = 0; i < 5; i++) {
        const spread = direction.clone();
        spread.x += (Math.random() - 0.5) * 0.18;
        spread.y += (Math.random() - 0.5) * 0.14;
        spread.z += (Math.random() - 0.5) * 0.18;
        spread.normalize();
        const p = this.spawnProjectile(ownerId, origin, spread, def, null);
        if (p) pellets.push(p);
      }
      return pellets.length ? { projectiles: pellets } : null;
    }

    const lockId = opts?.lockTargetId ?? null;
    const p = this.spawnProjectile(ownerId, origin, direction, def, lockId);
    return p ? { projectiles: [p] } : null;
  }

  private spawnProjectile(
    ownerId: string,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    def: WeaponDef,
    lockTargetId: string | null
  ): Projectile | null {
    const p = this.pool.find((x) => !x.active);
    if (!p) return null;
    p.active = true;
    p.position.copy(origin);
    p.velocity.copy(direction).multiplyScalar(def.projectileSpeed);
    p.weapon = def.id;
    p.ownerId = ownerId;
    p.life = def.id === 'torpedo' ? 7 : def.id === 'rocket' ? 5.5 : def.id === 'scatter' ? 1.5 : 2.4;
    p.damage = def.damage;
    p.splash = def.splashRadius;
    p.selfDamageScale = def.selfDamageScale;
    p.targetId = lockTargetId;
    p.maxSpeed = def.projectileSpeed * (def.id === 'rocket' ? 1.15 : 1);
    // Homing ONLY if latched at fire (rockets require lock; torpedoes optional soft)
    if (def.id === 'rocket' && lockTargetId) p.homing = 3.6;
    else if (def.id === 'torpedo' && lockTargetId) p.homing = 1.35;
    else p.homing = 0;
    p.mesh.visible = true;
    const scale = def.id === 'torpedo' ? 1.9 : def.id === 'rocket' ? 1.55 : def.id === 'scatter' ? 0.6 : 0.9;
    p.mesh.scale.setScalar(scale);
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(def.color);
    p.mesh.position.copy(p.position);
    return p;
  }

  deactivate(p: Projectile) {
    p.active = false;
    p.mesh.visible = false;
    p.targetId = null;
    p.homing = 0;
  }

  private spawnRailBeam(from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.25) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      linewidth: 2,
    });
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.railBeams.push({ line, life });
  }

  refill() {
    this.ammo.plasma = -1;
    this.ammo.rocket = WEAPONS.rocket.ammo;
    this.ammo.rail = WEAPONS.rail.ammo;
    // Keep special weapons if unlocked, else 0
    this.ammo.laser = this.unlocked.has('laser') ? WEAPONS.laser.ammo : 0;
    this.ammo.torpedo = this.unlocked.has('torpedo') ? WEAPONS.torpedo.ammo : 0;
    this.ammo.scatter = this.unlocked.has('scatter') ? WEAPONS.scatter.ammo : 0;
    this.cooldown = 0;
  }

  dispose() {
    for (const p of this.pool) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.scene.remove(this.trailGroup);
    this.scene.remove(this.muzzleFlash);
  }
}
