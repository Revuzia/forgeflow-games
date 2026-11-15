/**
 * spherical_gravity.js — Mario Galaxy-style planetary gravity for Three.js.
 *
 * Provides:
 *  - Multi-planet scene graph (each planet is a sphere with mass + radius)
 *  - Player walks on ANY planet's surface, gravity pulls toward its center
 *  - Launch stars (trigger transition from planet A to planet B)
 *  - Camera that orients up-vector to current planet normal
 *
 * API:
 *   const world = new SphericalGravityWorld(THREE);
 *   world.addPlanet({ position: new THREE.Vector3(0,0,0), radius: 10, mass: 1.0, mesh: planetMesh });
 *   world.addPlanet({ position: new THREE.Vector3(50,20,0), radius: 6, mass: 0.8, mesh: otherPlanet });
 *   world.setPlayer(playerMesh);
 *
 *   // Each frame:
 *   world.update(deltaSec);
 *
 *   // Launch from one planet to another:
 *   world.addLaunchStar({ position: new THREE.Vector3(5, 10, 0), targetPlanet: planet2, launchSpeed: 20 });
 */
class SphericalGravityWorld {
  constructor(THREE) {
    this.THREE = THREE;
    this.planets = [];
    this.launchStars = [];
    this.player = null;
    this.playerVelocity = new THREE.Vector3(0, 0, 0);
    this.playerCurrentPlanet = null;
    this.playerUp = new THREE.Vector3(0, 1, 0);
    this.gravityStrength = 30;  // tuned for Mario Galaxy-ish feel
  }

  addPlanet(config) {
    const planet = {
      position: config.position.clone(),
      radius: config.radius,
      mass: config.mass ?? 1.0,
      mesh: config.mesh,
      gravityRange: config.gravityRange ?? config.radius * 3,
    };
    this.planets.push(planet);
    return planet;
  }

  addLaunchStar(config) {
    this.launchStars.push({
      position: config.position.clone(),
      targetPlanet: config.targetPlanet,
      launchSpeed: config.launchSpeed ?? 20,
      radius: 1.0,
      triggered: false,
    });
  }

  setPlayer(playerMesh) {
    this.player = playerMesh;
    if (this.planets.length > 0) {
      this.playerCurrentPlanet = this.planets[0];
    }
  }

  _findDominantPlanet(worldPos) {
    let best = null;
    let bestPull = 0;
    for (const planet of this.planets) {
      const toCenter = planet.position.clone().sub(worldPos);
      const distance = toCenter.length();
      if (distance > planet.gravityRange) continue;
      const pull = planet.mass / (distance * distance + 0.1);
      if (pull > bestPull) {
        bestPull = pull;
        best = planet;
      }
    }
    return best;
  }

  update(delta) {
    if (!this.player) return;

    const playerPos = this.player.position;
    // Check launch stars first
    for (const star of this.launchStars) {
      if (star.triggered) continue;
      if (playerPos.distanceTo(star.position) < star.radius) {
        this._launchPlayer(star);
        star.triggered = true;
      }
    }

    // Find dominant planet (strongest gravity)
    const dominantPlanet = this._findDominantPlanet(playerPos);
    if (dominantPlanet) {
      this.playerCurrentPlanet = dominantPlanet;
      // Gravity pulls toward center of dominant planet
      const toCenter = dominantPlanet.position.clone().sub(playerPos).normalize();
      const gravityVec = toCenter.multiplyScalar(this.gravityStrength * delta);
      this.playerVelocity.add(gravityVec);

      // Update player's "up" to point away from planet center
      this.playerUp = playerPos.clone().sub(dominantPlanet.position).normalize();

      // Reorient player so feet point to planet
      const upMatrix = new this.THREE.Matrix4();
      upMatrix.lookAt(
        playerPos,
        playerPos.clone().add(this.playerUp.clone().negate()),
        new this.THREE.Vector3(0, 1, 0)
      );
      // Smooth rotation toward target
      const targetQuat = new this.THREE.Quaternion().setFromRotationMatrix(upMatrix);
      this.player.quaternion.slerp(targetQuat, 5 * delta);

      // Surface collision: if player dips below surface, clamp + zero inward velocity
      const dist = playerPos.distanceTo(dominantPlanet.position);
      const targetDist = dominantPlanet.radius + 0.5;
      if (dist < targetDist) {
        const pushOut = this.playerUp.clone().multiplyScalar(targetDist - dist);
        playerPos.add(pushOut);
        // Remove inward velocity component
        const inwardVel = this.playerVelocity.dot(toCenter);
        if (inwardVel > 0) {
          this.playerVelocity.addScaledVector(toCenter, -inwardVel);
        }
      }
    }

    // Apply velocity
    this.player.position.add(this.playerVelocity.clone().multiplyScalar(delta));
    // Drag
    this.playerVelocity.multiplyScalar(0.98);
  }

  _launchPlayer(star) {
    if (!this.player || !star.targetPlanet) return;
    const direction = star.targetPlanet.position.clone().sub(this.player.position).normalize();
    this.playerVelocity = direction.multiplyScalar(star.launchSpeed);
    // Emit launch event
    if (this.onLaunch) this.onLaunch(star);
  }

  jump(strength = 10) {
    if (!this.player || !this.playerCurrentPlanet) return;
    // Jump direction = current up-vector
    this.playerVelocity.addScaledVector(this.playerUp, strength);
  }

  // Move player tangentially along the planet surface
  applyMove(forward, right, speed) {
    if (!this.player || !this.playerCurrentPlanet) return;
    // Forward = player's local forward projected onto planet tangent
    const worldForward = new this.THREE.Vector3(0, 0, -1).applyQuaternion(this.player.quaternion);
    const worldRight = new this.THREE.Vector3(1, 0, 0).applyQuaternion(this.player.quaternion);

    const tangentMove = worldForward.multiplyScalar(forward * speed)
      .add(worldRight.multiplyScalar(right * speed));

    // Project out the up component
    tangentMove.addScaledVector(this.playerUp, -tangentMove.dot(this.playerUp));
    this.playerVelocity.add(tangentMove);
  }
}

if (typeof window !== "undefined") {
  window.SphericalGravityWorld = SphericalGravityWorld;
}
