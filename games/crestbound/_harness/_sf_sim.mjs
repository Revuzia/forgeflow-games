import { TUNE, REACH_TABLE, simulateJump, launchVelocityForApex, bestGap } from '../runtime/core/tuning.js';
console.log('longjump rows', JSON.stringify(REACH_TABLE.longjump));
console.log('single rows', JSON.stringify(REACH_TABLE.single));
for (const dy of [0,-2,-5,-9]) console.log('LJ dy',dy, simulateJump({v0:TUNE.longJump.vy, fwd:TUNE.longJump.fwd, dy, drag:TUNE.airDrag}));
for (const dy of [0,1.0,1.2,1.4,1.5]) console.log('single@run dy',dy, simulateJump({v0:TUNE.jumpV[0], fwd:TUNE.speedRun, dy, drag:TUNE.airDrag}));
for (const a of [4,6.2,7.0,7.2,7.4,8.0,8.5]) console.log('apex',a,'v0',launchVelocityForApex(a).toFixed(2));
console.log('bestGap(3.0,20)',bestGap(3.0,20),'bestGap(1.4,20)',bestGap(1.4,20));
