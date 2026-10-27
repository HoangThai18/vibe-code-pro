#!/usr/bin/env bash
# main has the base app; the branch feat/vouchers adds gift vouchers (the change to review).
set -eu
src="$(dirname "$0")"
cp -R "$src/base/." .
git init -q -b main
git -c user.name=dev -c user.email=dev@example.vn add -A
git -c user.name=dev -c user.email=dev@example.vn commit -q -m "Appointments API"
git checkout -q -b feat/vouchers
cp -R "$src/branch/." .
git -c user.name=dev -c user.email=dev@example.vn add -A
git -c user.name=dev -c user.email=dev@example.vn commit -q -m "Gift vouchers: create and redeem"
