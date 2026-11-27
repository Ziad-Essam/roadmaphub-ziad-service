#!/usr/bin/env bash
# Record Roadmap's task and service in Floci. Run 04-roadmap-alb.sh first.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
case "$AWS_ENDPOINT_URL" in http://localhost:4566|http://127.0.0.1:4566) ;; *) echo "Use the team's local Floci endpoint"; exit 1;; esac
cluster=roadhub-cluster
service=roadhub-roadmap-service
family=roadhub-roadmap-task
state=$(awsl ecs describe-clusters --clusters "$cluster" --query 'clusters[0].status' --output text)
[[ "$state" == ACTIVE ]] || { echo "Start with the team's shared ECS cluster."; exit 1; }
tg=$(awsl elbv2 describe-target-groups --names roadhub-roadmap-tg --query 'TargetGroups[0].TargetGroupArn' --output text)
network=$(awsl elbv2 describe-load-balancers --names roadhub-alb --query 'LoadBalancers[0]' --output json)
config=$(node -e '
const alb = JSON.parse(require("fs").readFileSync(0, "utf8"));
const subnets = alb.AvailabilityZones.map(zone => zone.SubnetId);
if (!subnets.length || !alb.SecurityGroups.length) throw Error("Missing shared network");
console.log(JSON.stringify({ awsvpcConfiguration: { subnets, securityGroups: alb.SecurityGroups, assignPublicIp: "DISABLED" } }));
' <<< "$network")
task=$(awsl ecs list-task-definitions --family-prefix "$family" --sort DESC --query 'taskDefinitionArns[0]' --output text)
role="arn:aws:iam::${ACCOUNT_ID}:role/roadhub-roadmap-api"
execution_role="arn:aws:iam::${ACCOUNT_ID}:role/roadhub-roadmap-execution"
containers='[{"name":"roadmap","image":"roadhub-roadmap:local","essential":true,"portMappings":[{"containerPort":3001,"protocol":"tcp"}],"environment":[{"name":"PORT","value":"3001"},{"name":"HOST","value":"0.0.0.0"},{"name":"AWS_REGION","value":"us-east-1"},{"name":"NODE_ENV","value":"production"},{"name":"CLOUDWATCH_LOG_GROUP","value":"/roadhub/roadmap"}],"logConfiguration":{"logDriver":"awslogs","options":{"awslogs-group":"/roadhub/roadmap","awslogs-region":"us-east-1","awslogs-stream-prefix":"ecs"}}}]'
# Reuse a current revision if the important settings already match.
current_role=""; current_execution=""; current_log=""; current_image=""
if [[ "$task" == arn:* ]]; then
  current_role=$(awsl ecs describe-task-definition --task-definition "$task" --query taskDefinition.taskRoleArn --output text)
  current_execution=$(awsl ecs describe-task-definition --task-definition "$task" --query taskDefinition.executionRoleArn --output text)
  current_log=$(awsl ecs describe-task-definition --task-definition "$task" --query 'taskDefinition.containerDefinitions[0].logConfiguration.logDriver' --output text)
  current_image=$(awsl ecs describe-task-definition --task-definition "$task" --query 'taskDefinition.containerDefinitions[0].image' --output text)
fi
if [[ "$current_role" != "$role" || "$current_execution" != "$execution_role" || "$current_log" != awslogs || "$current_image" != roadhub-roadmap:local ]]; then
  task=$(awsl ecs register-task-definition --family "$family" --requires-compatibilities FARGATE --network-mode awsvpc --cpu 256 --memory 512 \
    --task-role-arn "$role" --execution-role-arn "$execution_role" --container-definitions "$containers" \
    --query 'taskDefinition.taskDefinitionArn' --output text)
fi
state=$(awsl ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0].status' --output text)
if [[ "$state" != ACTIVE ]]; then
  awsl ecs create-service --cluster "$cluster" --service-name "$service" --task-definition "$task" --desired-count 0 --launch-type FARGATE \
    --network-configuration "$config" --load-balancers "targetGroupArn=$tg,containerName=roadmap,containerPort=3001" >/dev/null
else
  current_task=$(awsl ecs describe-services --cluster "$cluster" --services "$service" --query "services[0].taskDefinition" --output text)
  current_count=$(awsl ecs describe-services --cluster "$cluster" --services "$service" --query "services[0].desiredCount" --output text)
  if [[ "$current_task" != "$task" || "$current_count" != 0 ]]; then awsl ecs update-service --cluster "$cluster" --service "$service" --task-definition "$task" --desired-count 0 >/dev/null; fi
fi
awsl ecs describe-services --cluster "$cluster" --services "$service" --query 'services[0].{name:serviceName,desired:desiredCount,running:runningCount,group:loadBalancers[0].targetGroupArn}'
