/**
 * fps_core.js — First-person shooter core (DOOM / Quake / Halo).
 * Pointer lock mouselook + WASD + weapon system + bullet raycasts.
 *
 * API:
 *   const fps = new FPSCore(THREE, renderer.domElement, {camera, scene});
 *   fps.addWeapon(weaponConfig);
 *   fps.update(dt);
 *   fps.fire();  // raycast damage
 */
class FPSCore {
  constructor(THREE, canvas, cfg) {
    this.THREE = THREE;
    this.camera = cfg.camera;
    this.scene = cfg.scene;
    this.canvas = canvas;
    this.moveSpeed = cfg.moveSpeed ?? 5;
    this.runMult = cfg.runMult ?? 1.6;
    this.jumpForce = cfg.jumpForce ?? 6;
    this.gravity = cfg.gravity ?? 18;
    this.health = cfg.health ?? 100;
    this.armor = 0;
    this.position = this.camera.position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.keys = {};
    this.weapons = [];
    this.currentWeapon = 0;
    this.canJump = true;
    this.enemies = cfg.enemies || [];  // array of {mesh, hp}
    this._setupInput();
  }
  _setupInput() {
    this.canvas.addEventListener("click", () => this.canvas.requestPointerLock?.());
    document.addEventListener("pointerlockchange", () => {
      this._locked = document.pointerLockElement === this.canvas;
    });
    document.addEventListener("mousemove", (e) => {
      if (!this._locked) return;
      this.yaw   -= e.movementX * 0.002;
      this.pitch -= e.movementY * 0.002;
      this.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.pitch));
    });
    document.addEventListener("mousedown", (e) => { if (this._locked && e.button === 0) this.fire(); });
    window.addEventListener("keydown", (e) => { this.keys[e.code] = true; });
    window.addEventListener("keyup",   (e) => { this.keys[e.code] = false; });
  }
  addWeapon(cfg) {
    this.weapons.push({
      name: cfg.name, damage: cfg.damage ?? 20, range: cfg.range ?? 100,
      fireRate: cfg.fireRate ?? 3, ammo: cfg.ammo ?? 30, maxAmmo: cfg.maxAmmo ?? 120,
      cooldown: 0, spread: cfg.spread ?? 0.02, pellets: cfg.pellets ?? 1,
    });
  }
  fire() {
    const w = this.weapons[this.currentWeapon]; if (!w || w.ammo <= 0 || w.cooldown > 0) return;
    w.ammo--; w.cooldown = 1.0 / w.fireRate;
    const dir = new this.THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const results = [];
    for (let p = 0; p < (w.pellets || 1); p++) {
      const spread = new this.THREE.Vector3((Math.random()-.5)*w.spread,(Math.random()-.5)*w.spread,(Math.random()-.5)*w.spread);
      const ray = new this.THREE.Raycaster(this.camera.position, dir.clone().add(spread).normalize(), 0, w.range);
      const meshes = this.enemies.filter(e => e.hp > 0 && e.mesh).map(e => e.mesh);
      const hits = ray.intersectObjects(meshes, true);
      if (hits[0]) {
        // Find the enemy owning this mesh
        const enemy = this.enemies.find(e => {
          let o = hits[0].object;
          while (o) { if (o === e.mesh) return true; o = o.parent; }
          return false;
        });
        if (enemy) { enemy.hp -= w.damage; results.push({enemy, point: hits[0].point}); }
      }
    }
    return results;
  }
  update(dt) {
    // Cooldowns
    for (const w of this.weapons) w.cooldown = Math.max(0, w.cooldown - dt);
    // Orient camera
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    // Input direction
    const forward = new this.THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right   = new this.THREE.Vector3(Math.cos(this.yaw),  0, -Math.sin(this.yaw));
    const speed = this.keys.ShiftLeft ? this.moveSpeed * this.runMult : this.moveSpeed;
    const inputV = new this.THREE.Vector3();
    if (this.keys.KeyW) inputV.add(forward);
    if (this.keys.KeyS) inputV.sub(forward);
    if (this.keys.KeyD) inputV.add(right);
    if (this.keys.KeyA) inputV.sub(right);
    if (inputV.lengthSq() > 0) inputV.normalize().multiplyScalar(speed);
    this.velocity.x = inputV.x; this.velocity.z = inputV.z;
    // Gravity + jump
    this.velocity.y -= this.gravity * dt;
    if (this.keys.Space && this.canJump) { this.velocity.y = this.jumpForce; this.canJump = false; }
    // Integrate
    this.position.addScaledVector(this.velocity, dt);
    // Ground
    if (this.position.y < 1.6) { this.position.y = 1.6; this.velocity.y = 0; this.canJump = true; }
    this.camera.position.copy(this.position);
    // Weapon switch
    if (this.keys.Digit1) this.currentWeapon = 0;
    if (this.keys.Digit2 && this.weapons[1]) this.currentWeapon = 1;
    if (this.keys.Digit3 && this.weapons[2]) this.currentWeapon = 2;
  }
  takeDamage(amt) {
    const absorbed = Math.min(this.armor, amt * 0.6);
    this.armor -= absorbed; this.health -= (amt - absorbed);
    return this.health <= 0;
  }
}
if (typeof window !== "undefined") window.FPSCore = FPSCore;
