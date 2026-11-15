/**
 * voxel_engine.js — Minecraft / Terraria / Rust voxel core (Three.js).
 * Chunked cube-world with BlockAPI. Greedy-meshing optional.
 *
 * API:
 *   const world = new VoxelWorld(THREE, {chunkSize, blockTypes});
 *   world.setBlock(x, y, z, type);
 *   world.getBlock(x, y, z);
 *   world.generateTerrain(seed);  // Simplex-like heightmap
 *   world.attach(scene);
 */
class VoxelWorld {
  constructor(THREE, cfg = {}) {
    this.THREE = THREE;
    this.chunkSize = cfg.chunkSize ?? 16;
    this.worldHeight = cfg.worldHeight ?? 64;
    this.blockTypes = cfg.blockTypes || [
      { id: 0, name: "air", transparent: true, color: 0 },
      { id: 1, name: "grass", color: 0x2d8a2d },
      { id: 2, name: "dirt", color: 0x8b6f47 },
      { id: 3, name: "stone", color: 0x7e7e7e },
      { id: 4, name: "water", color: 0x3377cc, transparent: true },
      { id: 5, name: "wood", color: 0x8b5a2b },
      { id: 6, name: "leaves", color: 0x3d7a3d, transparent: true },
      { id: 7, name: "sand", color: 0xe6d17b },
      { id: 8, name: "lava", color: 0xff4400, emissive: true },
    ];
    this.chunks = new Map();
    this.scene = null;
  }
  _chunkKey(cx, cz) { return `${cx},${cz}`; }
  _coordToChunk(x, z) { return [Math.floor(x / this.chunkSize), Math.floor(z / this.chunkSize)]; }
  _hashNoise(x, y, z) {
    let h = x * 73856093 ^ y * 19349663 ^ z * 83492791;
    h = ((h << 13) ^ h);
    return ((h * (h * h * 15731 + 789221) + 1376312589) & 0x7fffffff) / 0x7fffffff;
  }
  getBlock(x, y, z) {
    const [cx, cz] = this._coordToChunk(x, z);
    const c = this.chunks.get(this._chunkKey(cx, cz));
    if (!c) return 0;
    const lx = ((x % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const lz = ((z % this.chunkSize) + this.chunkSize) % this.chunkSize;
    if (y < 0 || y >= this.worldHeight) return 0;
    return c.blocks[y * this.chunkSize * this.chunkSize + lz * this.chunkSize + lx] || 0;
  }
  setBlock(x, y, z, type) {
    const [cx, cz] = this._coordToChunk(x, z);
    const key = this._chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c) {
      c = { cx, cz, blocks: new Uint8Array(this.chunkSize * this.chunkSize * this.worldHeight), mesh: null, dirty: true };
      this.chunks.set(key, c);
    }
    const lx = ((x % this.chunkSize) + this.chunkSize) % this.chunkSize;
    const lz = ((z % this.chunkSize) + this.chunkSize) % this.chunkSize;
    if (y < 0 || y >= this.worldHeight) return;
    c.blocks[y * this.chunkSize * this.chunkSize + lz * this.chunkSize + lx] = type;
    c.dirty = true;
  }
  generateTerrain(seed = 42, radius = 3) {
    for (let cx = -radius; cx <= radius; cx++) {
      for (let cz = -radius; cz <= radius; cz++) {
        for (let lx = 0; lx < this.chunkSize; lx++) {
          for (let lz = 0; lz < this.chunkSize; lz++) {
            const wx = cx * this.chunkSize + lx;
            const wz = cz * this.chunkSize + lz;
            const h = Math.floor(16 + this._hashNoise(wx, seed, wz) * 12 + this._hashNoise(wx*3, seed, wz*3) * 8);
            for (let y = 0; y < h; y++) {
              const t = y === h - 1 ? 1 : y > h - 4 ? 2 : 3;
              this.setBlock(wx, y, wz, t);
            }
          }
        }
      }
    }
  }
  rebuildMesh(chunk) {
    const T = this.THREE;
    if (chunk.mesh && this.scene) this.scene.remove(chunk.mesh);
    const geo = new T.BufferGeometry();
    const positions = [], colors = [], indices = []; let vi = 0;
    for (let y = 0; y < this.worldHeight; y++) {
      for (let lz = 0; lz < this.chunkSize; lz++) {
        for (let lx = 0; lx < this.chunkSize; lx++) {
          const wx = chunk.cx * this.chunkSize + lx, wz = chunk.cz * this.chunkSize + lz;
          const b = this.getBlock(wx, y, wz);
          if (b === 0) continue;
          const type = this.blockTypes[b] || this.blockTypes[0];
          const col = new T.Color(type.color);
          // Emit cube faces only when neighbor is air/transparent (basic culling)
          const faces = [
            {dx:0,dy:1,dz:0, v:[[0,1,0],[1,1,0],[1,1,1],[0,1,1]]},    // top
            {dx:0,dy:-1,dz:0, v:[[0,0,0],[0,0,1],[1,0,1],[1,0,0]]},   // bottom
            {dx:1,dy:0,dz:0, v:[[1,0,0],[1,0,1],[1,1,1],[1,1,0]]},    // right
            {dx:-1,dy:0,dz:0, v:[[0,0,0],[0,1,0],[0,1,1],[0,0,1]]},   // left
            {dx:0,dy:0,dz:1, v:[[0,0,1],[0,1,1],[1,1,1],[1,0,1]]},    // front
            {dx:0,dy:0,dz:-1, v:[[0,0,0],[1,0,0],[1,1,0],[0,1,0]]},   // back
          ];
          for (const f of faces) {
            const n = this.getBlock(wx + f.dx, y + f.dy, wz + f.dz);
            if (n && !this.blockTypes[n]?.transparent) continue;
            for (const [vx, vy, vz] of f.v) { positions.push(wx + vx, y + vy, wz + vz); colors.push(col.r, col.g, col.b); }
            indices.push(vi, vi+1, vi+2, vi, vi+2, vi+3); vi += 4;
          }
        }
      }
    }
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color",    new T.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices); geo.computeVertexNormals();
    const mat = new T.MeshLambertMaterial({ vertexColors: true });
    chunk.mesh = new T.Mesh(geo, mat); chunk.dirty = false;
    if (this.scene) this.scene.add(chunk.mesh);
  }
  update() { for (const c of this.chunks.values()) { if (c.dirty) this.rebuildMesh(c); } }
  attach(scene) { this.scene = scene; this.update(); }
}
if (typeof window !== "undefined") window.VoxelWorld = VoxelWorld;
