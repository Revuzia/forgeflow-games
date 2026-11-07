# A-ui-r1 ledger (UI engineer, stage A r1: findings 8 and 11)

## Stint 1 (2026-11-07)
- #8 warn never disabled: CODE DONE in live src/ui/decision.ts towerChoice: `disabled = !can.has(id) ? why||'Not now'
  : (id==='warn' && t.warnBlocked) ? t.warnBlocked : undefined`; the says line no longer promises "<prophet> will go"
  while blocked (the card shows the reason in place of the says line, as before). Test: tests/ui-arc-decision.test.ts
  "warn stays disabled with the sim's reason when canAnswer lists it..." (3 sim reasons + open case). Sim untouched.
- #11 Look at it: CODE DONE. DecisionCard.look(): DecisionState.peek() (card -> pill, eased speed KEPT; step() restores
  it if the choice goes while pilled), then deps.lookAt(planet, pos, lookDist(h)=3h+150, lift=h/2). Host.lookAt gained
  optional `lift` (src/ui/host.ts, src/app.ts): focus slid away from the eye by lift*tan(tilt) so the line of sight
  passes the tower's middle. Wired in src/ui/shell.ts. Test: "Look at it steps the card down to its pill...".
- tsc clean; tests/ui-arc-decision.test.ts 7/7.
- Shots: _harness/arc-work/specs/ui-r1.json on port 5311, log _harness/scratch/arc/ui-r1/shots.log, PNGs _shots/ur1-*.png.
  launched PID 2817 (slot.sh) 18:37Z. Verdict: PENDING
- Gate: npm run check via slot.sh PID 3484 (18:5xZ), log _harness/scratch/arc/ui-r1/check.log: PENDING
