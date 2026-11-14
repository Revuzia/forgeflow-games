#!/usr/bin/env python3
"""Re-roll specific minis with Meshy's SERVER-SIDE remesh to a low poly target —
for models whose raw topology resists client-side simplification (gltf-transform).
Downloads to assets/minis/mini_{id}.glb (raw; still needs gltf-transform optimize).
Usage: python tools/gen_meshy_remesh.py id1 id2 ..."""
import base64, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(HERE, 'assets', 'art')
OUT = os.path.join(HERE, 'assets', 'minis')
API = 'https://api.meshy.ai/openapi/v1'
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
KEY = json.load(open(CFG, encoding='utf-8'))['meshy']['api_key']
HDR = {'Authorization': 'Bearer ' + KEY}


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(HDR)
    if data:
        h['Content-Type'] = 'application/json'
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=h, method=method), timeout=90) as r:
                return json.load(r)
        except Exception as e:
            last = e; time.sleep(2 * (attempt + 1))
    raise last


def submit(cid):
    b64 = base64.b64encode(open(os.path.join(ART, f'{cid}.jpg'), 'rb').read()).decode()
    body = {'image_url': f'data:image/jpeg;base64,{b64}', 'ai_model': 'meshy-6',
            'should_texture': True, 'enable_pbr': False, 'topology': 'triangle',
            'should_remesh': True, 'target_polycount': 15000}
    return req('POST', f'{API}/image-to-3d', body)['result']


def download(url, dest):
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=180) as resp, open(dest, 'wb') as f:
                f.write(resp.read())
            return os.path.getsize(dest)
        except Exception:
            time.sleep(2 * (attempt + 1))
    return 0


def main():
    ids = sys.argv[1:]
    tasks = {cid: submit(cid) for cid in ids}
    for cid, t in tasks.items():
        print(f'[{cid}] remesh submitted -> {t}', flush=True)
    done = {}
    t0 = time.time()
    while len(done) < len(ids) and time.time() - t0 < 900:
        for cid in ids:
            if cid in done:
                continue
            task = req('GET', f'{API}/image-to-3d/{tasks[cid]}')
            st = task.get('status')
            if st == 'SUCCEEDED':
                glb = task.get('model_urls', {}).get('glb')
                size = download(glb, os.path.join(OUT, f'mini_{cid}.glb')) if glb else 0
                done[cid] = size
                print(f'[{cid}] SUCCEEDED -> {size} bytes', flush=True)
            elif st in ('FAILED', 'CANCELED'):
                tasks[cid] = submit(cid)
                print(f'[{cid}] {st} — re-rolled', flush=True)
        if len(done) < len(ids):
            time.sleep(8)
    print('DONE ' + ', '.join(done), flush=True)


if __name__ == '__main__':
    main()
