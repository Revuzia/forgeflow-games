#!/usr/bin/env python3
"""Generate the Arcane Pack opening backdrop (xAI) -> assets/ui/pack_bg.jpg.
An atmospheric arcane vault so the 3D pack + card fan have a stage to sit on
instead of a flat gradient. Center is kept calm/dark so the cards stay legible."""
import base64, io, json, os, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'assets', 'ui')
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\xai_image.jsonl'
_c = json.load(open(CFG, encoding='utf-8'))
KEY = (_c.get('xai') or _c.get('providers', {}).get('xai'))['api_key']

PROMPT = ("Interior of an ornate arcane treasure vault chamber, a carved stone altar pedestal at "
          "center beneath a radiant vertical beam of golden light pouring from above, floating "
          "glowing magical runes and drifting embers, tall carved stone arches and pillars, deep "
          "purple and gold color palette, volumetric god-rays, atmospheric haze, dark heavily "
          "vignetted edges with a calm dim center stage, symmetrical centered composition, fantasy "
          "video-game concept art, cinematic, highly detailed, no characters, no people, no text, no border")


def gen():
    payload = json.dumps({'model': 'grok-imagine-image', 'prompt': PROMPT,
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
            t = 1600  # long side — plenty for a full-screen backdrop
            if max(w, h) > t:
                im = im.resize((t, round(h * t / w)) if w >= h else (round(w * t / h), t), Image.LANCZOS)
            os.makedirs(OUT, exist_ok=True)
            dest = os.path.join(OUT, 'pack_bg.jpg')
            im.save(dest, 'JPEG', quality=88, optimize=True)
            return {'ok': True, 'size': im.size, 'bytes': os.path.getsize(dest)}
        except urllib.error.HTTPError as e:
            msg = e.read().decode('utf-8', 'replace')[:200]
            if e.code in (400, 401, 403):
                return {'ok': False, 'fatal': e.code, 'err': msg}
            time.sleep(2 * attempt)
        except Exception as e:
            time.sleep(2 * attempt)
    return {'ok': False, 'err': 'retries exhausted'}


res = gen()
print(json.dumps(res), flush=True)
if res.get('ok'):
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'date': time.strftime('%Y-%m-%d'),
                            'api': 'xai_image', 'n': 1, 'cost': 0.02,
                            'note': 'arcane-realms pack-opening backdrop'}) + '\n')
