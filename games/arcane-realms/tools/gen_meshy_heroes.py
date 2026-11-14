#!/usr/bin/env python3
"""Generate 3D hero characters from the hero portraits via Meshy Image-to-3D.
Source: assets/ui/hero_{realm}.jpg  →  assets/heroes/hero_{realm}.glb (raw).
Optimize separately with gltf-transform. Reports exact credit spend."""
import base64, json, os, sys, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, 'assets', 'ui')
OUT = os.path.join(HERE, 'assets', 'heroes')
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\meshy_3d.jsonl'
API = 'https://api.meshy.ai/openapi/v1'
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
KEY = json.load(open(CFG, encoding='utf-8'))['meshy']['api_key']
HDR = {'Authorization': 'Bearer ' + KEY}


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(HDR)
    if data: h['Content-Type'] = 'application/json'
    r = urllib.request.Request(url, data=data, headers=h, method=method)
    with urllib.request.urlopen(r, timeout=60) as resp:
        return json.load(resp)


def main():
    realms = sys.argv[1:] or ['ember', 'tide', 'grove', 'dawn', 'grave', 'neutral']
    os.makedirs(OUT, exist_ok=True)
    bal0 = req('GET', f'{API}/balance')['balance']
    print(f'[balance] before = {bal0}', flush=True)
    results = {}
    for realm in realms:
        p = os.path.join(SRC, f'hero_{realm}.jpg')
        b64 = base64.b64encode(open(p, 'rb').read()).decode()
        body = {'image_url': f'data:image/jpeg;base64,{b64}', 'ai_model': 'meshy-6',
                'should_texture': True, 'enable_pbr': False, 'topology': 'triangle',
                'target_polycount': 24000}
        for attempt in range(1, 4):
            tid = req('POST', f'{API}/image-to-3d', body)['result']
            print(f'[{realm}] attempt {attempt} -> {tid}', flush=True)
            t0 = time.time()
            task = None
            while time.time() - t0 < 600:
                task = req('GET', f'{API}/image-to-3d/{tid}')
                if task['status'] in ('SUCCEEDED', 'FAILED', 'CANCELED'): break
                time.sleep(8)
            if task and task['status'] == 'SUCCEEDED':
                url = task.get('model_urls', {}).get('glb')
                dest = os.path.join(OUT, f'hero_{realm}.glb')
                r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(r, timeout=120) as resp, open(dest, 'wb') as f:
                    f.write(resp.read())
                sz = os.path.getsize(dest)
                results[realm] = {'status': 'SUCCEEDED', 'bytes': sz}
                print(f'[{realm}] downloaded {sz} bytes', flush=True)
                break
            print(f'[{realm}] {task and task["status"]}, retrying (free)...', flush=True)
        else:
            results[realm] = {'status': 'GAVE_UP'}
    bal1 = req('GET', f'{API}/balance')['balance']
    ok = [r for r, v in results.items() if v['status'] == 'SUCCEEDED']
    print(f'\n===== SUMMARY =====\nsucceeded {len(ok)}/{len(realms)}: {", ".join(ok)}', flush=True)
    print(f'[balance] after = {bal1}  SPENT = {bal0 - bal1}', flush=True)
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'game': 'arcane-realms',
                            'batch': 'heroes', 'realms': realms, 'results': results,
                            'balance_before': bal0, 'balance_after': bal1,
                            'credits_spent': bal0 - bal1}) + '\n')


if __name__ == '__main__':
    main()
