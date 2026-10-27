#!/usr/bin/env bash
# A Spring Boot API that sets the tenant with a session-level set_config in a servlet filter
set -eu
cp -R "$(dirname "$0")/files/." .
git init -q -b main
git -c user.name=dev -c user.email=dev@example.vn add -A
git -c user.name=dev -c user.email=dev@example.vn commit -q -m "Spa CRM API: customers, appointments"
