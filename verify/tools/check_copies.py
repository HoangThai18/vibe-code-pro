#!/usr/bin/env python3
"""Shared code kept as byte-identical copies across verify projects (tools/copies.json: original → copies).

python3 verify/tools/check_copies.py          # CI: fails if a copy differs from its original
python3 verify/tools/check_copies.py --write  # after editing an original: copy it over every copy
"""
import json
import shutil
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
write = '--write' in sys.argv
stale = []
groups = json.loads((root / 'tools' / 'copies.json').read_text(encoding='utf-8'))
for original, copies in groups.items():
    source = (root / original).read_bytes()
    for copy in copies:
        target = root / copy
        if target.exists() and target.read_bytes() == source:
            continue
        if write:
            shutil.copyfile(root / original, target)
            print(f'copied {original} -> {copy}')
        else:
            stale.append(f'{copy} differs from {original}')
print('\n'.join(stale) or f'checked {sum(map(len, groups.values()))} copies, all match')
sys.exit(1 if stale else 0)
