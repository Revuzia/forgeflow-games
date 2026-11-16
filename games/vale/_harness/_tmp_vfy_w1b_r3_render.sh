#!/bin/bash
# verify W1-B r3 (temp): render before (97cff3317^) / fix 2 (04784cd56) / HEAD GLBs with the head-framed three r186 sheet
set -e
cd "$(dirname "$0")/.."
D=_harness/_tmp_vfy_w1b_r3
export CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for f in odrum ulkro ardit dunsom hesmi; do for v in before f2 after; do
  node _harness/_tmp_vfy_w1b_faces.mjs $D/${v}_$f.glb $D/face_${v}_$f.png | tail -1
done; done
