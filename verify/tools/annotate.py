#!/usr/bin/env python3
"""Print a failed run's failing lines as GitHub annotations, readable on the PR without the raw log.

some-command 2>&1 | tee verify.log; s=${PIPESTATUS[0]}; [ "$s" = 0 ] || python3 verify/tools/annotate.py verify.log TITLE; exit "$s"
"""
import re
import sys

log, title = sys.argv[1], sys.argv[2]
lines = open(log, encoding='utf-8', errors='replace').read().splitlines()
marker = re.compile(r'^\s*(not ok|✖|✘|FAIL|●)|Error:|error:|ERROR', re.I)
keep = set()
for i, line in enumerate(lines):
    if marker.search(line):
        keep.update(range(max(0, i - 2), min(len(lines), i + 15)))
text = '\n'.join(lines[i] for i in sorted(keep)) or '\n'.join(lines[-60:])
for n, start in enumerate(range(0, min(len(text), 10500), 3500)):
    chunk = text[start:start + 3500].replace('%', '%25').replace('\r', '').replace('\n', '%0A')
    print(f'::error title={title} ({n + 1})::{chunk}')
