const path=require('path'); require(path.resolve(__dirname,'..','pipeline/engine/runtime/sim/battleship.js'));
const { Battleship }=globalThis.FFG.sim;
function lay(seed){ const s=new Battleship({size:10,seed}); return s.enemy.ships.map(x=>x.id+':'+x.cells[0].x+','+x.cells[0].y).join('  '); }
const s1=Math.floor(Math.random()*2e9), s2=Math.floor(Math.random()*2e9);
console.log('seed1',s1,'->',lay(s1));
console.log('seed2',s2,'->',lay(s2));
console.log('default fleet size:', new Battleship({size:10,seed:1}).enemy.ships.length);
console.log('fixed 4242 a:', lay(4242)); console.log('fixed 4242 b:', lay(4242));
