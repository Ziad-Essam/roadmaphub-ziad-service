#!/usr/bin/env bash
# Lab 8 sequence. Run after the team's roadhub-events bus has been created.
set -euo pipefail
cd "$(dirname "$0")"
source lib.sh
if ! awsl events describe-event-bus --name roadhub-events >/dev/null 2>&1; then awsl events create-event-bus --name roadhub-events; fi
bash scripts/create-tables.sh
bash services/02-counts.sh
bash services/03-monitoring.sh
bash services/03-iam.sh
bash services/04-roadmap-alb.sh
bash services/05-roadmap-ecs.sh
bash services/06-scaling.sh
