#!/usr/bin/env bash
# Read-only lab-style verification. Run after shared-local.sh and init-aws.sh.
set -euo pipefail
source "$(dirname "$0")/lib.sh"
step "DynamoDB tables and indexes"
awsl dynamodb describe-table --table-name roadhub-features --query 'Table.{Table:TableName,Status:TableStatus,Indexes:GlobalSecondaryIndexes[].IndexName}'
awsl dynamodb scan --table-name roadhub-categories --select COUNT
step "EventBridge and Roadmap queues"
awsl events list-targets-by-rule --event-bus-name roadhub-events --rule roadhub-roadmap-counts-rule
awsl sqs list-queues --queue-name-prefix roadhub-roadmap-counts
step "Monitoring and roles"
awsl logs describe-metric-filters --log-group-name /roadhub/roadmap
awsl cloudwatch describe-alarms --alarm-names roadhub-roadmap-rejected-requests || info "Alarm query unsupported"
for role in api worker execution; do
  awsl iam list-role-policies --role-name "roadhub-roadmap-$role"
done
step "Shared ALB and Roadmap targets"
alb=$(awsl elbv2 describe-load-balancers --names roadhub-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)
listener=$(awsl elbv2 describe-listeners --load-balancer-arn "$alb" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text)
tg=$(awsl elbv2 describe-target-groups --names roadhub-roadmap-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
awsl elbv2 describe-rules --listener-arn "$listener" --query 'Rules[].{Priority:Priority,Paths:Conditions[0].Values,Target:Actions[0].TargetGroupArn}'
awsl elbv2 describe-target-health --target-group-arn "$tg" --query 'TargetHealthDescriptions[].{Target:Target,State:TargetHealth.State}'
step "Recorded ECS service and scaling policy (not actual running tasks)"
awsl ecs describe-services --cluster roadhub-cluster --services roadhub-roadmap-service --query 'services[0].{Service:serviceName,Desired:desiredCount,Running:runningCount,Task:taskDefinition,Targets:loadBalancers}'
awsl application-autoscaling describe-scalable-targets --service-namespace ecs --resource-ids service/roadhub-cluster/roadhub-roadmap-service
awsl application-autoscaling describe-scaling-policies --service-namespace ecs --resource-id service/roadhub-cluster/roadhub-roadmap-service
