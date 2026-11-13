# audit_verify30.py — live verification of the 30-enemy roster (commit d57ae0fe claims).
# Spawns every spawnable UNITS identity at ~8 m, checks registry body, bound mesh,
# animation (bone deltas over 1 s), and world height from bone span.
import json, time, sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:8799/games/driftwake/index.html"
ARGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11",
        "--disable-gpu-sandbox", "--enable-gpu-rasterization"]

STATIC_JS = """() => {
  const sf = SNOWFLOW, E = sf.combat.enemies;
  const units = E.units.map(u => ({i:u.index, key:u.key, slug:u.slug, realm:u.realm,
    role:u.roleName, reuse:u.reuse, engineScale:u.engineScale, meshScale:u.meshScale}));
  const roles = [...new Set(units.map(u=>u.role))];
  const added = {};
  for (const k of ["rimeSkierRaider","sandMummy","boneKnight"]) {
    const r = sf.combat.data.ENEMIES.find(r=>r.key===k);
    added[k] = r ? {hp:r.hp, speed:r.speed, perceptionM:r.perceptionM,
      attackRangeM:r.attackRangeM, poiseMax:r.poiseMax, tier:r.tier, cost:r.cost,
      nDmg:r.damages.length, nTele:r.telegraphMs.length, special:!!r.special} : null;
  }
  return {nUnits:units.length, nRoles:roles.length, roles, units,
    nRows:sf.combat.data.ENEMIES.length,
    visTypesAtBoot:[...E.vis._types.keys()],
    typeofSpawnUnit: typeof E.vis.spawnUnit,
    streamingAtBoot: !!E.vis.streaming, added};
}"""

STREAM_JS = """async (realm) => {
  const sf = SNOWFLOW, V = sf.combat.enemies.vis;
  let entered = null, streamErr = null;
  if (V.realm !== realm) { try { entered = await sf.enterRealm(realm); } catch(e){ return {err:"enterRealm: "+e}; } }
  V.streaming = null;              // stream() caches the previous realm's promise
  try { await V.stream(); } catch(e) { streamErr = String(e); }
  const types = {};
  for (const [slug,t] of V._types) types[slug] = t.state;
  return {entered, streamErr, visRealm: V.realm, types};
}"""

GUARD_JS = """() => {
  // FINDING WORKAROUND: enemies.js BOLT_MAX=32 but meshEnemies pools 16 bolt
  // meshes; clear() calls driveBolt(16..31) and crashes. Guard so the audit can
  // proceed past the defect.
  const V = SNOWFLOW.combat.enemies.vis;
  if (!V._auditBoltGuard) {
    const orig = V.driveBolt.bind(V);
    V.driveBolt = (b, x, y, z, on) => { if (V._boltMeshes[b]) orig(b, x, y, z, on); };
    V._auditBoltGuard = true;
  }
}"""

SPAWN_JS = """(key) => {
  const sf = SNOWFLOW, E = sf.combat.enemies, V = E.vis;
  sf.S.freezeTime = false;
  E.clear();
  const ready = V.ready(key);
  const c = sf.character.position;
  const x = c.x + 8, z = c.z + 2;
  const id = E.spawn(key, x, z, 10);
  if (id < 0) return {key, id, ready, slot:-1};
  let slot = -1;
  for (let i = 0; i < 24; i++) if (E.alive[i] && E.id[i] === id) { slot = i; break; }
  const s = sf.combat.registry.slot(id);
  const hp = s >= 0 ? sf.combat.registry.hp[s] : -1;
  return {key, id, ready, slot, regSlot:s, hp, slotKey: V._slotKey[slot]};
}"""

SAMPLE_JS = """(slot) => {
  const V = SNOWFLOW.combat.enemies.vis;
  const inst = V._slotInst[slot];
  if (!inst) return null;
  inst.root.updateMatrixWorld(true);
  const bones = inst.skeleton.bones, q = [];
  let minY = 1e9, maxY = -1e9;
  for (const b of bones) {
    q.push(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w,
           b.position.x, b.position.y, b.position.z);
    const wy = b.matrixWorld.elements[13];
    if (wy < minY) minY = wy; if (wy > maxY) maxY = wy;
  }
  let node = inst.root, inScene = false;
  while (node) { if (node === SNOWFLOW.scene) { inScene = true; break; } node = node.parent; }
  return {slug: inst.type.slug, meshVis: inst.mesh.visible, rootVis: inst.root.visible,
    inScene, q, boneSpanY: maxY - minY, scale: inst.root.scale.x,
    typeHeightM: inst.type.heightM, hasMixer: !!inst.mixer,
    mixerTime: inst.mixer ? inst.mixer.time : -1, nBones: bones.length};
}"""

def main():
    results = {"perKey": []}
    with sync_playwright() as p:
        b = p.chromium.launch(channel="chrome", headless=False, args=ARGS)
        pg = b.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, timeout=120000)
        pg.wait_for_function("globalThis.SNOWFLOW && SNOWFLOW.combat", timeout=120000)
        time.sleep(3)

        pg.evaluate(GUARD_JS)
        static = pg.evaluate(STATIC_JS)
        results["static"] = static
        units = static["units"]

        for realm in ["cold", "sand", "ash"]:
            st = pg.evaluate(STREAM_JS, realm)
            results.setdefault("stream", {})[realm] = st
            time.sleep(0.5)
            for u in [u for u in units if u["realm"] == realm]:
                r = pg.evaluate(SPAWN_JS, u["key"])
                r["expectSlug"] = u["slug"]
                r["realm"] = realm
                if r["slot"] >= 0:
                    time.sleep(1.0)
                    s1 = pg.evaluate(SAMPLE_JS, r["slot"])
                    time.sleep(1.0)
                    s2 = pg.evaluate(SAMPLE_JS, r["slot"])
                    if s1 and s2:
                        d = max(abs(a - b2) for a, b2 in zip(s1["q"], s2["q"]))
                        r["bound"] = True
                        r["boundSlug"] = s2["slug"]
                        r["slugMatch"] = s2["slug"] == u["slug"]
                        r["meshVis"] = s2["meshVis"]; r["inScene"] = s2["inScene"]
                        r["boneDelta"] = round(d, 5)
                        r["animates"] = d > 1e-3
                        r["mixerT1"] = round(s1["mixerTime"], 3)
                        r["mixerT2"] = round(s2["mixerTime"], 3)
                        r["heightBoneSpan"] = round(s2["boneSpanY"], 3)
                        r["typeHeightM"] = round(s2["typeHeightM"], 3)
                        r["scale"] = round(s2["scale"], 3)
                        r["nBones"] = s2["nBones"]
                    else:
                        r["bound"] = False
                        r["note"] = "no instance bound after 1-2 s (pending body)"
                else:
                    r["bound"] = False
                results["perKey"].append(r)
            pg.evaluate("() => SNOWFLOW.combat.enemies.clear()")

        b.close()
    with open(__file__.replace(".py", "_out.json"), "w") as f:
        json.dump(results, f, indent=1)
    # compact console dump
    print(json.dumps(results["static"]["added"]))
    print("nUnits", results["static"]["nUnits"], "nRoles", results["static"]["nRoles"],
          "typeofSpawnUnit", results["static"]["typeofSpawnUnit"])
    for r in results["perKey"]:
        print(r.get("realm"), r["key"], "id", r["id"], "ready", r["ready"],
              "bound", r.get("bound"), "slug", r.get("boundSlug"), "match", r.get("slugMatch"),
              "vis", r.get("meshVis"), "anim", r.get("animates"), "d", r.get("boneDelta"),
              "h", r.get("heightBoneSpan"), "hType", r.get("typeHeightM"))

if __name__ == "__main__":
    main()
