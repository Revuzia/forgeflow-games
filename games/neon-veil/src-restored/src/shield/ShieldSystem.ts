import { COMBAT } from '../core/config';

export class ShieldSystem {
  charge = COMBAT.maxShield;
  deployed = false;
  deployTimer = 0;
  private timeSinceDamage = 999;

  get fullyCharged() {
    return this.charge >= COMBAT.maxShield - 0.5 && !this.deployed;
  }

  update(dt: number, holdDeploy: boolean) {
    if (this.deployed) {
      this.deployTimer -= dt;
      if (this.deployTimer <= 0) {
        this.deployed = false;
        this.charge = 0;
        return 'down' as const;
      }
      return null;
    }

    if (holdDeploy && this.fullyCharged) {
      this.deployed = true;
      this.deployTimer = COMBAT.shieldDeployDuration;
      return 'up' as const;
    }

    this.timeSinceDamage += dt;
    if (this.timeSinceDamage >= COMBAT.shieldRegenDelay) {
      this.charge = Math.min(COMBAT.maxShield, this.charge + COMBAT.shieldRegenRate * dt);
    }
    return null;
  }

  /** Returns remaining damage after absorb. */
  absorb(amount: number): number {
    this.timeSinceDamage = 0;
    if (this.deployed) {
      return amount * (1 - COMBAT.shieldAbsorb * 0.85);
    }
    if (this.charge > 0) {
      const absorbed = Math.min(this.charge, amount);
      this.charge -= absorbed;
      return amount - absorbed;
    }
    return amount;
  }

  reset() {
    this.charge = COMBAT.maxShield;
    this.deployed = false;
    this.deployTimer = 0;
    this.timeSinceDamage = 999;
  }
}
