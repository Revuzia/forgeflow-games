#!/bin/zsh
# Upload a packaged VALE build (tools/package_deploy.ts output) to the ForgeFlow game CDN:
# R2 bucket forgeflow-games/<slug>/, served by workers/games-cdn at
#   https://forgeflow-games-cdn.isimcha85.workers.dev/<slug>/index.html
# Unlisted: no Supabase row and no portal rebuild, so the build is reachable only by its link.
#
#   zsh tools/r2_upload.sh [dir=deploy] [slug=vale-playtest] [jobs=8]
#
# Credentials (never printed): CLOUDFLARE_API_TOKEN, or ../../state/.secrets/cf_api_token.txt
# (a token with Account → Workers R2 Storage: Edit); CLOUDFLARE_ACCOUNT_ID, or
# ../../state/.secrets/cf_account_id.txt. Both files are git-ignored.
# Order: every asset first, index.html last, so a half-finished upload never serves a page whose
# files are missing. Exit 0 = uploaded and the CDN serves index.html and catalog/manifest.json.

DIR=${1:-deploy}
SLUG=${2:-vale-playtest}
JOBS=${3:-8}
VALE=${0:A:h:h}
SECRETS=${VALE:h:h}/state/.secrets
BUCKET=forgeflow-games
CDN=https://forgeflow-games-cdn.isimcha85.workers.dev
WRANGLER_VER=4.155.0
export PATH=/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH

cd "$VALE" || exit 2
[[ -f $DIR/index.html && -f $DIR/catalog/manifest.json ]] || { print -u2 "no packaged build in $DIR (run npm run build && npm run content && npm run package)"; exit 2; }
if [[ -z $CLOUDFLARE_API_TOKEN && -s $SECRETS/cf_api_token.txt ]]; then export CLOUDFLARE_API_TOKEN=$(tr -d ' \n\r' < $SECRETS/cf_api_token.txt); fi
if [[ -z $CLOUDFLARE_ACCOUNT_ID && -s $SECRETS/cf_account_id.txt ]]; then export CLOUDFLARE_ACCOUNT_ID=$(tr -d ' \n\r' < $SECRETS/cf_account_id.txt); fi
[[ -n $CLOUDFLARE_API_TOKEN ]] || { print -u2 "no Cloudflare API token: put an R2-Edit token in $SECRETS/cf_api_token.txt"; exit 2; }
[[ -n $CLOUDFLARE_ACCOUNT_ID ]] || { print -u2 "no Cloudflare account id: put it in $SECRETS/cf_account_id.txt"; exit 2; }

WR=(npx --yes wrangler@$WRANGLER_VER)
mime() {
  case ${1:e:l} in
    html) print text/html ;; js) print application/javascript ;; css) print text/css ;; json) print application/json ;;
    png) print image/png ;; webp) print image/webp ;; svg) print image/svg+xml ;; jpg|jpeg) print image/jpeg ;;
    glb) print model/gltf-binary ;; ogg) print audio/ogg ;; m4a) print audio/mp4 ;; woff2) print font/woff2 ;; woff) print font/woff ;;
    txt|cube) print 'text/plain; charset=utf-8' ;; *) print application/octet-stream ;;
  esac
}
put() {   # $1 = path relative to $DIR
  local f=$1 tries=0
  while (( tries < 3 )); do
    "${WR[@]}" r2 object put "$BUCKET/$SLUG/$f" --file="$DIR/$f" --content-type="$(mime $f)" --remote > /dev/null 2>&1 && return 0
    (( tries++ )); sleep 2
  done
  print -r -- "$f" >> $FAILLOG; print -u2 "FAILED $f"; return 1
}

files=(${(f)"$(cd $DIR && find . -type f ! -name index.html | sed 's#^\./##' | sort)"})
FAILLOG=$(mktemp -t vale_r2_fail)
print "uploading ${#files} files + index.html to $BUCKET/$SLUG/ with $JOBS jobs"
n=0
for f in $files; do
  put "$f" &
  (( ++n % JOBS == 0 )) && wait
  (( n % 200 == 0 )) && print "  $n / ${#files}"
done
wait
[[ -s $FAILLOG ]] && { print -u2 "$(wc -l < $FAILLOG | tr -d ' ') uploads failed (list: $FAILLOG): index.html NOT uploaded; re-run to retry"; exit 1; }
put index.html || exit 1

url="$CDN/$SLUG/index.html"
code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
mcode=$(curl -s -o /dev/null -w '%{http_code}' "$CDN/$SLUG/catalog/manifest.json")
print "index.html $code · manifest $mcode"
[[ $code == 200 && $mcode == 200 ]] || exit 1
print "PLAY: $url"
