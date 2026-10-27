#!/usr/bin/env bash
# History: main (P0) → phase/P1 (P1-T01 done) → task/P1-T02, handed over for review with every test passing.
set -eu
src="$(dirname "$0")/files"
g() { git -c user.name=dev -c user.email=dev@example.vn "$@"; }
git init -q -b main
cp -R "$src/base/." . && g add -A && g commit -q -m "P0: project skeleton, task cards for P1"
git switch -q -c phase/P1
cp -R "$src/p1-t01/." . && g add -A && g commit -q -m "P1-T01: customer data"
git switch -q -c task/P1-T02
cp -R "$src/t02-start/." . && g add -A && g commit -q -m "P1-T02: start"
cp -R "$src/t02-final/." . && g add -A && g commit -q -m "P1-T02: create and update, ready for review"
