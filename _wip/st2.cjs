const path=require('path'); require(path.resolve(__dirname,'..','pipeline/engine/runtime/sim/tactical_grid.js'));
const { TacticalBattle }=globalThis.FFG.sim;
const grid=[[0,0,0,0,0],[0,0,0,0,0],[0,0,0,0,0]];
const b=new TacticalBattle({grid,player_units:[{id:'p1',x:0,y:1,hp:100,atk:40,aim:0.95,range:10,movement:6}],enemy_units:[{id:'e1',x:4,y:1,hp:100,atk:30,aim:0.8,range:10,movement:6}],seed:3});
const los=b.hasLineOfSight(0,1,4,1); const r=b.attackUnit('p1','e1');
console.log('clear LOS:',los,'attack result:',JSON.stringify({hit:r.hit,success:r.success}),'attacker AP after:',b.getUnit('p1').actionPoints,'(expect 0)');
