/**
 * portal_physics.js — Portal/Antichamber-style teleport + momentum conservation.
 * Two linked portals; entering one exits the other with relative orientation.
 *
 * API:
 *   const pp = new PortalPhysics();
 *   pp.setPortal("orange", {x, y, nx, ny});   // normal direction
 *   pp.setPortal("blue",   {x, y, nx, ny});
 *   pp.teleportIfCrossed(entity);  // checks + teleports, preserves velocity
 */
class PortalPhysics {
  constructor() { this.portals = {}; this._lastSides = new WeakMap(); }
  setPortal(name, cfg) {
    this.portals[name] = { x: cfg.x, y: cfg.y, nx: cfg.nx ?? 0, ny: cfg.ny ?? -1, size: cfg.size ?? 60 };
  }
  _otherName(name) { return name === "orange" ? "blue" : "orange"; }
  _sideOf(portal, ex, ey) {
    const dx = ex - portal.x, dy = ey - portal.y;
    return Math.sign(dx * portal.nx + dy * portal.ny);
  }
  _onPortalSurface(portal, ex, ey) {
    const dx = ex - portal.x, dy = ey - portal.y;
    const dot = dx * portal.nx + dy * portal.ny;
    const perpX = -portal.ny, perpY = portal.nx;
    const perpDist = Math.abs(dx * perpX + dy * perpY);
    return Math.abs(dot) < 30 && perpDist < portal.size / 2;
  }
  teleportIfCrossed(entity) {
    for (const name of Object.keys(this.portals)) {
      const p = this.portals[name];
      const other = this.portals[this._otherName(name)];
      if (!other) continue;
      if (!this._onPortalSurface(p, entity.x, entity.y)) continue;
      const prevSide = this._lastSides.get(entity)?.[name] ?? this._sideOf(p, entity.x, entity.y);
      const currSide = this._sideOf(p, entity.x, entity.y);
      if (prevSide > 0 && currSide <= 0) {
        // Crossed through from front to back — teleport
        // Rotate velocity by angle between portals
        const angIn  = Math.atan2(p.ny, p.nx);
        const angOut = Math.atan2(other.ny, other.nx);
        const deltaAng = angOut - angIn + Math.PI;  // exit out of other portal's front
        const cos = Math.cos(deltaAng), sin = Math.sin(deltaAng);
        const vx = entity.vx ?? 0, vy = entity.vy ?? 0;
        entity.vx = vx * cos - vy * sin; entity.vy = vx * sin + vy * cos;
        entity.x = other.x + other.nx * 2;
        entity.y = other.y + other.ny * 2;
        const sides = this._lastSides.get(entity) || {};
        sides[name] = -1; sides[this._otherName(name)] = 1;
        this._lastSides.set(entity, sides);
        return true;
      }
      const sides = this._lastSides.get(entity) || {};
      sides[name] = currSide;
      this._lastSides.set(entity, sides);
    }
    return false;
  }
}
if (typeof window !== "undefined") window.PortalPhysics = PortalPhysics;
