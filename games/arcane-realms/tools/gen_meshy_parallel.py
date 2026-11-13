#!/usr/bin/env python3
"""Parallel 3D minis via Meshy Image-to-3D — submits ALL ids up front, then polls
them together so they generate concurrently (total time ≈ the slowest one, not the
sum). Downloads each as it finishes; re-rolls FAILED tasks for free. Same output +
ledger as gen_meshy_minis.py.  Usage: python tools/gen_meshy_parallel.py id1 id2 ...
Run ONE batch at a time on the shared key so the credit-diff stays accurate."""
import base64, json, os, sys, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(HERE, 'assets', 'art')
OUT = os.path.join(HERE, 'assets', 'minis')
LEDGER = r'C:\Users\TestRun\Claude Claw\state\usage\meshy_3d.jsonl'
API = 'https://api.meshy.ai/openapi/v1'
CFG = r'C:\Users\TestRun\AppData\Roaming\Nomi\api_config.json'
RETRY_MAX = 3
POLL_EVERY = 8
POLL_TIMEOUT = 900
KEY = json.load(open(CFG, encoding='utf-8'))['meshy']['api_key']
HDR = {'Authorization': 'Bearer ' + KEY}


def req(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    h = dict(HDR)
    if data:
        h['Content-Type'] = 'application/json'
    last = None
    for attempt in range(6):
        try:
            r = urllib.request.Request(url, data=data, headers=h, method=method)
            with urllib.request.urlopen(r, timeout=90) as resp:
                return json.load(resp)
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def balance():
    return req('GET', f'{API}/balance')['balance']


def submit(cid):
    p = os.path.join(ART, f'{cid}.jpg')
    b64 = base64.b64encode(open(p, 'rb').read()).decode()
    body = {'image_url': f'data:image/jpeg;base64,{b64}', 'ai_model': 'meshy-6',
            'should_texture': True, 'enable_pbr': False, 'topology': 'triangle',
            'target_polycount': 24000}
    return req('POST', f'{API}/image-to-3d', body)['result']


def download(url, dest):
    last = None
    for attempt in range(6):
        try:
            r = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(r, timeout=180) as resp, open(dest, 'wb') as f:
                f.write(resp.read())
            return os.path.getsize(dest)
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise last


def main():
    ids = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not ids:
        print('usage: gen_meshy_parallel.py id1 id2 ...'); sys.exit(1)
    os.makedirs(OUT, exist_ok=True)
    bal_before = balance()
    print(f'[balance] before = {bal_before} credits', flush=True)

    tasks, attempts, results = {}, {}, {}
    for cid in ids:
        tasks[cid] = submit(cid); attempts[cid] = 1
        print(f'[{cid}] submitted attempt 1 -> {tasks[cid]}', flush=True)

    t0 = time.time()
    while len(results) < len(ids) and time.time() - t0 < POLL_TIMEOUT:
        for cid in ids:
            if cid in results:
                continue
            try:
                task = req('GET', f'{API}/image-to-3d/{tasks[cid]}')
            except Exception:
                continue
            st = task.get('status')
            if st == 'SUCCEEDED':
                glb = task.get('model_urls', {}).get('glb')
                dest = os.path.join(OUT, f'mini_{cid}.glb')
                size = download(glb, dest) if glb else 0
                results[cid] = {'status': 'SUCCEEDED', 'task_id': tasks[cid],
                                'glb_bytes': size, 'attempts': attempts[cid]}
                print(f'[{cid}] SUCCEEDED -> downloaded {size} bytes -> mini_{cid}.glb', flush=True)
            elif st in ('FAILED', 'CANCELED'):
                if attempts[cid] < RETRY_MAX:
                    attempts[cid] += 1
                    tasks[cid] = submit(cid)
                    print(f'[{cid}] {st} — re-rolled (free) attempt {attempts[cid]} -> {tasks[cid]}', flush=True)
                else:
                    results[cid] = {'status': 'GAVE_UP', 'attempts': attempts[cid]}
                    print(f'[{cid}] GAVE_UP after {attempts[cid]}', flush=True)
        if len(results) < len(ids):
            time.sleep(POLL_EVERY)

    for cid in ids:
        if cid not in results:
            results[cid] = {'status': 'TIMEOUT', 'attempts': attempts.get(cid, 0)}

    bal_after = balance(); spent = bal_before - bal_after
    ok = [c for c, r in results.items() if r['status'] == 'SUCCEEDED']
    print('\n===== SUMMARY =====', flush=True)
    print(f'succeeded: {len(ok)}/{len(ids)}  ->  {", ".join(ok)}', flush=True)
    print(f'[balance] after = {bal_after}  |  TOTAL CREDITS SPENT = {spent}  (avg {spent/max(len(ok),1):.1f}/model)', flush=True)
    os.makedirs(os.path.dirname(LEDGER), exist_ok=True)
    with open(LEDGER, 'a', encoding='utf-8') as f:
        f.write(json.dumps({'ts': time.strftime('%Y-%m-%dT%H:%M:%S'), 'game': 'arcane-realms',
                            'batch': ids, 'results': results, 'balance_before': bal_before,
                            'balance_after': bal_after, 'credits_spent': spent, 'mode': 'parallel'}) + '\n')
    print('DONE', flush=True)


if __name__ == '__main__':
    main()
