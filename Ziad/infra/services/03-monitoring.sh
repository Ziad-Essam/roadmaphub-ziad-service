#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
group=/roadhub/roadmap
if ! awsl logs describe-log-groups --log-group-name-prefix "$group" \
    --query 'logGroups[].logGroupName' --output text | tr '\t' '\n' | grep -Fxq "$group"; then
  awsl logs create-log-group --log-group-name "$group"
fi
awsl logs put-retention-policy --log-group-name "$group" --retention-in-days 7
awsl logs put-metric-filter --log-group-name "$group" --filter-name RoadmapRejectedRequests \
  --filter-pattern '{ $.level = "SECURITY" }' \
  --metric-transformations metricName=RejectedRequests,metricNamespace=RoadmapHub/Roadmap,metricValue=1
ok "Roadmap security events feed the RejectedRequests metric"

# An alarm on rejected security requests, useful during the Lab 8 security demo.
if awsl cloudwatch put-metric-alarm --alarm-name roadhub-roadmap-rejected-requests \
  --namespace RoadmapHub/Roadmap --metric-name RejectedRequests --statistic Sum \
  --period 60 --evaluation-periods 1 --threshold 10 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching; then
  ok "Alarm: 10 or more rejected requests in one minute"
else
  info "CloudWatch alarm could not be configured; inspect the CLI error and emulator support"
fi
