const path = require('path');
require(path.resolve(__dirname, '..', 'pipeline/engine/runtime/sim/tactical_grid.js'));
const { TacticalBattle } = globalThis.FFG.sim;
const grid = [
 [0,0,0,0,0],[0,0,0,0,0],[0,0,3,0,0],[0,0,0,0,0],[0,0,0,0,0],
];
function mk(){ return new TacticalBattle({ grid,
  player_units:[{id:'p1',x:2,y:1,hp:100,atk:40,def:0,aim:0.9,range:10,movement:6}],
  enemy_units:[{id:'e1',x:2,y:3,hp:100,atk:30,def:0,aim:0.8,range:10,movement:6}], seed:7 }); }
let b=mk();
console.log('flank from NORTH (cover shields):', b.isFlanked(b.getUnit('p1'), b.getUnit('e1')), '(expect false)');
b.getUnit('p1').x=4; b.getUnit('p1').y=3; // east of target, around the north cover
console.log('flank from EAST (around cover):', b.isFlanked(b.getUnit('p1'), b.getUnit('e1')), '(expect true)');
const bd=b.hitBreakdown(b.getUnit('p1'), b.getUnit('e1'));
console.log('breakdown:', JSON.stringify({chance:+bd.chance.toFixed(2),flanked:bd.flanked,crit:bd.critChance}));
b=mk(); b.attackUnit('p1','e1');
console.log('shoot ends turn -> attacker AP:', b.getUnit('p1').actionPoints, '(expect 0)');
// overwatch
b=mk(); const ev=[]; b.onEvent=(t,p)=>{ if(t==='attack'||t==='overwatch') ev.push(t+(p&&p.reaction?':reaction':'')); };
b.overwatchUnit('p1'); const before=b.getUnit('e1').hp; b.endTurn();
console.log('overwatch events:', ev.join(',') || '(none)');
console.log('enemy hp before/after (reaction dmg):', before, '/', b.getUnit('e1').hp);
