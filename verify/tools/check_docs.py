"""Fail if a reference doc no longer matches its template + the tested code it includes.

python3 verify/tools/check_docs.py          # check
python3 verify/tools/check_docs.py --write  # re-render the docs from the templates
"""
import difflib
import json
import pathlib
import sys

from render import render

VERIFY = pathlib.Path(__file__).resolve().parent.parent
REPO = VERIFY.parent
write = "--write" in sys.argv
bad = 0
for tpl, doc in json.loads((VERIFY / "tools/docs.json").read_text()).items():
    expected, path = render(VERIFY / tpl), REPO / doc
    if write:
        path.write_text(expected, encoding="utf-8")
        continue
    actual = path.read_text(encoding="utf-8")
    if actual != expected:
        bad += 1
        print(f"✖ {doc} differs from verify/{tpl}")
        sys.stdout.writelines(list(difflib.unified_diff(actual.splitlines(True), expected.splitlines(True), doc, tpl))[:40])
print(f"{'wrote' if write else 'checked'} {len(json.loads((VERIFY / 'tools/docs.json').read_text()))} docs, {bad} out of date")
sys.exit(1 if bad else 0)
