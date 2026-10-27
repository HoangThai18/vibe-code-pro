import json, sys
d = json.load(open(sys.argv[1]))
def walk(s):
    for sp in s.get('specs', []):
        for t in sp['tests']:
            r = t['results'][-1] if t['results'] else {}
            err = (r.get('error') or {}).get('message', '') if r else ''
            err = err.replace('\x1b', '').split('\n')[0][:110]
            print(f"   {r.get('status','?'):8} {sp['title'][:60]:60} {err}")
    for c in s.get('suites', []): walk(c)
for s in d['suites']: walk(s)
