#!/usr/bin/env python3
"""Generate Aetherbound dual-realm card art (xAI) → assets/art/{id}.jpg.
Reads tools/aetherbound_cards.json (id + artPrompt). Portrait-ish framing to match
the aspect-aware top-anchor crop in cardtex.js. The 10 legendary marquee arts are
authored full-body so they double as Meshy 3D-mini source.
Usage: python tools/gen_card_art.py [--force] [id1 id2 ...]"""
import base64, io, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(HERE, 'assets', 'art')
SPEC = os.path.join(HERE, 'tools', 'aetherbound_cards.json')
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\xai_image.jsonl'
_c = json.load(open(CFG, encoding='utf-8'))
KEY = (_c.get('xai') or _c.get('providers', {}).get('xai'))['api_key']

cards = json.load(open(SPEC, encoding='utf-8'))
args = sys.argv[1:]
force = '--force' in args
only = [a for a in args if not a.startswith('--')]


def gen(card):
    prompt = card['artPrompt'] + ', portrait vertical composition'
    payload = json.dumps({'model': 'grok-imagine-image', 'prompt': prompt,
                          'n': 1, 'response_format': 'b64_json'}).encode()
    req = urllib.request.Request('https://api.x.ai/v1/images/generations', method='POST',
                                 data=payload, headers={'Authorization': 'Bearer ' + KEY,
                                                        'Content-Type': 'application/json'})
    for attempt in range(1, 4):
        try:
            body = json.loads(urllib.request.urlopen(req, timeout=240).read().decode())
            raw = base64.b64decode(body['data'][0]['b64_json'])
            from PIL import Image
            im = Image.open(io.BytesIO(raw)).convert('RGB')
            w, h = im.size
            t = 896
            if max(w, h) > t:
                im = im.resize((round(w * t / h), t) if h >= w else (t, round(h * t / w)), Image.LANCZOS)
            dest = os.path.join(ART, card['id'] + '.jpg')
            im.save(dest, 'JPEG', quality=88, optimize=True)
            return {'id': card['id'], 'ok': True, 'size': im.size}
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:160]
            if e.code in (400, 401, 403):
                return {'id': card['id'], 'ok': False, 'fatal': e.code, 'err': msg}
            time.sleep(2 * attempt)
        except Exception:
            time.sleep(2 * attempt)
    return {'id': card['id'], 'ok': False, 'err': 'retries exhausted'}


def main():
    os.makedirs(ART, exist_ok=True)
    todo = [c for c in cards if (not only or c['id'] in only)]
    if not force:
        todo = [c for c in todo if not os.path.exists(os.path.join(ART, c['id'] + '.jpg'))]
    print(f'generating {len(todo)} card arts', flush=True)
    done = 0
    for c in todo:
        res = gen(c)
        print(json.dumps(res), flush=True)
        if res.get('ok'):
            done += 1
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'date': time.strftime('%Y-%m-%d'),
                            'api': 'xai_image', 'n': done, 'cost': round(0.02 * done, 4),
                            'note': 'aetherbound expansion card art'}) + '\n')
    print(f'DONE {done}/{len(todo)}', flush=True)


if __name__ == '__main__':
    main()
