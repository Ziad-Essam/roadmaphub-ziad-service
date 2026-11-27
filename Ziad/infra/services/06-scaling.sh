#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
resource=service/roadhub-cluster/roadhub-roadmap-service
args=(--service-namespace ecs --resource-id "$resource" --scalable-dimension ecs:service:DesiredCount)
# Keep zero possible in Floci. Real deployment starts at 3 and scales between 1 and 3.
awsl application-autoscaling register-scalable-target "${args[@]}" --min-capacity 0 --max-capacity 3
awsl application-autoscaling put-scaling-policy "${args[@]}" --policy-name roadmap-cpu --policy-type TargetTrackingScaling \
  --target-tracking-scaling-policy-configuration '{"TargetValue":50,"PredefinedMetricSpecification":{"PredefinedMetricType":"ECSServiceAverageCPUUtilization"}}'
