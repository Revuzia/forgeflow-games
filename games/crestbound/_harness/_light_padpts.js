const A=CRESTBOUND,G=A.game,E=A.engine,T=A.THREE; const P=G.player, cam=E.camera; const W=E.size.w,H=E.size.h;
const proj=(x,y,z)=>{const v=new T.Vector3(x,y,z).project(cam); return [Math.round((v.x*0.5+0.5)*W), Math.round((1-(v.y*0.5+0.5))*H)];};
const hp=P.pos; const f=new T.Vector3(hp.x-cam.position.x,0,hp.z-cam.position.z).normalize();
const h=G.hero; const b=h&&h.shadowBlob; const gy=b?b.mesh.position.y:hp.y;
return JSON.stringify({behind:proj(hp.x-f.x*0.3,gy+0.01,hp.z-f.z*0.3), ahead:proj(hp.x+f.x*1.2,gy+0.01,hp.z+f.z*1.2), feet:proj(hp.x,gy,hp.z), head:proj(hp.x,hp.y+1.3,hp.z), blob:b?{vis:b.mesh.visible,op:+b._op.toFixed(2),y:+b.mesh.position.y.toFixed(3),padH:b._padH,padR:b._padR}:null, heroY:+hp.y.toFixed(2), rim:h&&h._rimU?{sky:h._rimU.uCbHeroSky.value.toArray().map(x=>+x.toFixed(2)),back:h._rimU.uCbHeroRim.value.toArray().map(x=>+x.toFixed(2))}:null, draws:E.stats&&E.stats.drawCalls, tris:E.stats&&E.stats.tris});
