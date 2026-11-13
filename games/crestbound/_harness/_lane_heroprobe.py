import json,sys,time
from playwright.sync_api import sync_playwright
FLAGS=["--ignore-gpu-blocklist","--use-angle=d3d11","--disable-gpu-sandbox","--enable-gpu-rasterization",
       "--disable-features=CalculateNativeWinOcclusion","--autoplay-policy=no-user-gesture-required"]
JS=r"""() => {
 const g=globalThis.CRESTBOUND.game, h=g.hero, b=h._body;
 if(!b) return {merged:false, parts:h._meshes.map(m=>({n:m.name, mat:m.material.name, type:m.material.type,
   env:m.material.envMapIntensity, spec:m.material.specularIntensity, sheen:m.material.sheen,
   shr:m.material.sheenRoughness, cc:m.material.clearcoat, rough:m.material.roughness, metal:m.material.metalness,
   col:m.material.color.getHexString(), vcol:m.material.vertexColors, emi:m.material.emissiveIntensity,
   hasMap:!!m.material.map, hasN:!!m.material.normalMap, hasR:!!m.material.roughnessMap}))};
 const m=b.material, geo=b.geometry;
 const prog=(()=>{const r=globalThis.CRESTBOUND.engine.renderer;
   for(const p of r.info.programs||[]) if(p.cacheKey&&String(p.cacheKey).indexOf('cb-nim-body-matx')>=0) return {found:true, vsHasMatX:p.vertexShader?String(p.vertexShader).indexOf('vMatX')>=0:null};
   return {found:false};})();
 const ax=geo.attributes.aMatX;
 const uniq={};
 if(ax){for(let i=0;i<ax.count;i++){const k=ax.array[i*2].toFixed(2);uniq[k]=(uniq[k]||0)+1;}}
 return {merged:true, name:m.name, type:m.type, vertexColors:m.vertexColors,
   maps:{map:!!m.map,normalMap:!!m.normalMap,roughnessMap:!!m.roughnessMap,metalnessMap:!!m.metalnessMap,
         clearcoatMap:!!m.clearcoatMap,sheenColorMap:!!m.sheenColorMap},
   envMapIntensity:m.envMapIntensity, specularIntensity:m.specularIntensity,
   clearcoat:m.clearcoat, sheen:m.sheen, sheenRoughness:m.sheenRoughness,
   verts:geo.attributes.position.count, bones:b.skeleton?b.skeleton.bones.length:0,
   hasSkin:!!geo.attributes.skinIndex, envValues:uniq, prog,
   meshes:h._meshes.map(x=>x.name), eyeRange:h._eyeRange, scarfRange:h._scarfRange,
   deep:(()=>{const r=globalThis.CRESTBOUND.engine.renderer, gl=r.getContext();
     for(const pr of r.info.programs||[]){ if(String(pr.cacheKey||'').indexOf('cb-nim-body-matx')<0) continue;
       const src=gl.getShaderSource(pr.vertexShader)||'';
       const attrs=Object.keys(pr.getAttributes()||{});
       const fsrc=gl.getShaderSource(pr.fragmentShader)||'';
       return {vsAssign: src.indexOf('vMatX = aMatX')>=0, vsDecl: src.indexOf('attribute vec2 aMatX')>=0,
               attrHasMatX: attrs.indexOf('aMatX')>=0, attrLoc:(pr.getAttributes().aMatX||{}).location,
               fsEnv: fsrc.indexOf('envMapIntensity * vMatX.x')>=0, fsSpec: fsrc.indexOf('specularIntensity * vMatX.y')>=0,
               hasEnvMapDef: fsrc.indexOf('#define USE_ENVMAP')>=0 || fsrc.indexOf('USE_ENVMAP')>=0,
               attrs:attrs};
     } return null;})(),
   aMatXsample: (()=>{const a=geo.attributes.aMatX; return a?[a.array[0],a.array[1],a.array[2],a.array[3]]:null;})(),
   cs: (()=>{const o={}; for(const k of ['coat','skin','boot','leather','rope','metal','gold','trim','hair','scarf']){
        const m=h.M[k]; if(!m) continue; o[k]={map:m.map?m.map.colorSpace:null, nrm:m.normalMap?m.normalMap.colorSpace:null, orm:m.roughnessMap?m.roughnessMap.colorSpace:null};} return o;})(),
   skinMats: {skinEnv: h.M.skin.envMapIntensity, skinSpec: h.M.skin.specularIntensity, coatEnv: h.M.coat.envMapIntensity, coatSpec:h.M.coat.specularIntensity}};
}"""
CLICK=r"""() => {const w=['CONTINUE','KEEP MY PROGRESS','NEW GAME','NEW RUN','PLAY','START','BEGIN','ENTER'];
 for(const q of w) for(const b of Array.from(document.querySelectorAll('button'))){
  if((b.textContent||'').toUpperCase().indexOf(q)<0) continue; const r=b.getBoundingClientRect();
  if(b.disabled||r.width<4) continue; if(b.__activate)b.__activate(); else b.click(); return q;} return null;}"""
with sync_playwright() as p:
    br=p.chromium.launch(channel="chrome",headless=True,args=FLAGS)
    pg=br.new_page(viewport={"width":1280,"height":720})
    pg.goto("http://localhost:8788/games/crestbound/index.html?dev=1&quality=high",wait_until="load",timeout=60000)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("!!(globalThis.CRESTBOUND&&CRESTBOUND.game)"):break
        pg.wait_for_timeout(300)
    dl=time.time()+60
    while time.time()<dl:
        if pg.evaluate("CRESTBOUND.game.state") in ("keep","playing"):break
        pg.evaluate(CLICK); pg.wait_for_timeout(400)
    pg.evaluate("async()=>{await CRESTBOUND.game.__dev.goto('verdant-1');}")  # GOTO_V1
    pg.wait_for_timeout(6000)
    print(json.dumps(pg.evaluate(JS),indent=1))
    br.close()
