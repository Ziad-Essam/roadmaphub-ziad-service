#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
cd "$ROOT_DIR/infra/iam"
for component in api worker execution; do
  role="roadhub-roadmap-$component"
  if ! awsl iam get-role --role-name "$role" >/dev/null 2>&1; then
    awsl iam create-role --role-name "$role" --assume-role-policy-document file://trust.json >/dev/null
  fi
  awsl iam put-role-policy --role-name "$role" --policy-name roadmap-access --policy-document "file://$component.json"
done
