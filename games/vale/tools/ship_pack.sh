#!/bin/zsh
# Package and upload a gated VALE release from the ship worktree (~/Developer/forgeflow-games-ship).
#   zsh tools/ship_pack.sh <new catalog version> <live catalog version>
# Card rule: every fighter and skin card keeps the image that is live today (cards change only by a
# deliberate, verified card lane). Uploads to both CDN slugs, mirrors to games/vale/deploy, pushes the branch.
set -e
NEW=$1; LIVEV=$2
MAIN=/Users/sitskovich/Developer/forgeflow-games
cd /Users/sitskovich/Developer/forgeflow-games-ship/games/vale
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH VALE_PYTHON=$MAIN/.venv/bin/python
npm run content 2>&1 | tail -1
rm -rf dist-catalog-ship deploy_ship && cp -R dist-catalog dist-catalog-ship
NEW=$NEW LIVEV=$LIVEV MAIN=$MAIN python3 - <<'E'
import json,os,shutil,hashlib
NEWV=os.environ['NEW']; LIVEV=os.environ['LIVEV']; MAIN=os.environ['MAIN']
live=f'{MAIN}/games/vale/deploy/catalog'; new='dist-catalog-ship'
L=json.load(open(f'{live}/schema-1/{LIVEV}/catalog.json'))
p=f'{new}/schema-1/{NEWV}/catalog.json'
raw=open(p).read(); N=json.loads(raw)
Lf={x['id']:x for x in L['fighters']}; Ls={x['id']:x for x in L['skins']}
kept=0
def keep(obj,liveobj,key):
    global kept
    if liveobj is None or key not in liveobj or key not in obj or obj[key]==liveobj[key]: return
    src=f'{live}/{liveobj[key]}'; dst=f'{new}/{liveobj[key]}'
    assert os.path.exists(src), src
    if not os.path.exists(dst): shutil.copyfile(src,dst)
    obj[key]=liveobj[key]; kept+=1
for f in N['fighters']:
    lf=Lf.get(f['id'],{}).get('art')
    for k in ('portrait','splash','icon'): keep(f['art'],lf,k)
for s in N['skins']:
    for k in ('portrait','splash'): keep(s,Ls.get(s['id']),k)
print('cards kept on their live image:',kept)
out=json.dumps(N,indent=2,ensure_ascii=False) if raw.startswith('{\n') else json.dumps(N,ensure_ascii=False,separators=(',',':'))
open(p,'w').write(out)
mp=f'{new}/manifest.json'; mraw=open(mp).read(); m=json.loads(mraw)
m['schemas']['1']['sha256']=hashlib.sha256(out.encode()).hexdigest()
open(mp,'w').write(json.dumps(m,indent=2 if mraw.startswith('{\n') else None))
E
node tools/package_deploy.ts --catalog dist-catalog-ship --out deploy_ship 2>&1 | tail -1
grep -q "vale-net" deploy_ship/config.js || { echo "config.js lost the vale-net server line"; exit 1; }
SEC=$MAIN/state/.secrets
export CLOUDFLARE_API_TOKEN="$(cat $SEC/cf_api_token.txt)" CLOUDFLARE_ACCOUNT_ID="$(cat $SEC/cf_account_id.txt)"
for s in vale-playtest vale; do SINCE=$MAIN/games/vale/deploy zsh tools/r2_upload.sh deploy_ship $s 8 2>&1 | grep -v -i token | tail -2; done
rsync -a --delete deploy_ship/ $MAIN/games/vale/deploy/
git push -q origin vale-ship-$NEW 2>&1 | tail -1
for s in vale-playtest vale; do curl -s https://forgeflow-games-cdn.isimcha85.workers.dev/$s/catalog/manifest.json | python3 -c "import json,sys;print('$s',json.load(sys.stdin)['schemas']['1']['version'])"; done
