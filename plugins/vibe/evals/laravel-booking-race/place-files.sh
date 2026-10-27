#!/usr/bin/env bash
# A Laravel booking service that double books under concurrency (source files only, no vendor/)
set -eu
cp -R "$(dirname "$0")/files/." .
git init -q -b main
git -c user.name=dev -c user.email=dev@example.vn add -A
git -c user.name=dev -c user.email=dev@example.vn commit -q -m "Appointments booking"
