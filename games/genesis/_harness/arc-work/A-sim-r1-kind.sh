#!/bin/bash
# runs A-sim-r1-kind.ts over seeds; prints seed answered gifts opened devotedDay and every 6th day's means
cd "$(dirname "$0")/../.."
for s in "${@:-1 2 3 4 5 6 7 8}"; do node _harness/arc-work/A-sim-r1-kind.ts $s | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const l=d.split("\n").find(x=>x.startsWith("RESULT"));const o=JSON.parse(l.slice(7));console.log(o.seed,o.answered,o.gifts,o.opened,"devoted",o.devoted,o.traj.filter((_,i)=>i%2==1).join(" "))})'; done
