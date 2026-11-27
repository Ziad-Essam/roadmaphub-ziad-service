#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib.sh"
case "$AWS_ENDPOINT_URL" in http://localhost:4566|http://127.0.0.1:4566) ;; *) exit 1;; esac
VPC_ID=$(awsl ec2 describe-vpcs --filters Name=cidr,Values=10.22.0.0/16 --query 'Vpcs[0].VpcId' --output text 2>/dev/null || true)
if [ -z "$VPC_ID" ] || [ "$VPC_ID" = "None" ]; then
  VPC_ID=$(awsl ec2 create-vpc --cidr-block 10.22.0.0/16 --query 'Vpc.VpcId' --output text)
fi
subnet() { # subnet <cidr> <zone>
  local id
  id=$(awsl ec2 describe-subnets --filters Name=vpc-id,Values="$VPC_ID" Name=cidr-block,Values="$1" --query 'Subnets[0].SubnetId' --output text 2>/dev/null || true)
  if [ -z "$id" ] || [ "$id" = "None" ]; then
    id=$(awsl ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$1" --availability-zone "$2" --query 'Subnet.SubnetId' --output text)
  fi
  echo "$id"
}
SUBNET_A=$(subnet 10.22.1.0/24 us-east-1a)
SUBNET_B=$(subnet 10.22.2.0/24 us-east-1b)
SG_ID=$(awsl ec2 describe-security-groups --filters Name=group-name,Values=roadhub-sg Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || true)
if [ -z "$SG_ID" ] || [ "$SG_ID" = "None" ]; then
  SG_ID=$(awsl ec2 create-security-group --group-name roadhub-sg --description "RoadmapHub services" --vpc-id "$VPC_ID" --query GroupId --output text)
fi
# Local records only: HTTP to ALB; service task ports from the shared security group.
allow_ingress() {
  local result
  if ! result=$(awsl ec2 authorize-security-group-ingress --group-id "$SG_ID" "$@" 2>&1); then
    case "$result" in *InvalidPermission.Duplicate*) ;; *) echo "$result" >&2; return 1;; esac
  fi
}
# Some Floci releases only record the group, not ingress operations. Never hide that limitation.
if ! allow_ingress --protocol tcp --port 80 --cidr 0.0.0.0/0; then
  info "HTTP ingress could not be recorded; local gateway still runs on loopback"
fi
for port in 3001 3002 3003; do
  if ! allow_ingress --ip-permissions "[{\"IpProtocol\":\"tcp\",\"FromPort\":$port,\"ToPort\":$port,\"UserIdGroupPairs\":[{\"GroupId\":\"$SG_ID\"}]}]"; then
    info "Task ingress for port $port could not be recorded; inspect emulator support"
  fi
done
echo "  network: $VPC_ID, subnets $SUBNET_A $SUBNET_B, security group $SG_ID"

ALB_ARN=$(awsl elbv2 describe-load-balancers --names roadhub-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text 2>/dev/null || true)
if [ -z "$ALB_ARN" ] || [ "$ALB_ARN" = "None" ]; then
  ALB_ARN=$(awsl elbv2 create-load-balancer --name roadhub-alb --type application \
    --subnets "$SUBNET_A" "$SUBNET_B" --security-groups "$SG_ID" --query 'LoadBalancers[0].LoadBalancerArn' --output text)
fi


listener=$(awsl elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text)
if [[ "$listener" != arn:* ]]; then
  awsl elbv2 create-listener --load-balancer-arn "$ALB_ARN" --protocol HTTP --port 80 --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404}' >/dev/null
else
  default_type=$(awsl elbv2 describe-listeners --load-balancer-arn "$ALB_ARN" --query 'Listeners[?Port==`80`].DefaultActions[0].Type | [0]' --output text)
  if [[ "$default_type" != fixed-response ]]; then
    awsl elbv2 modify-listener --listener-arn "$listener" --default-actions 'Type=fixed-response,FixedResponseConfig={StatusCode=404}' >/dev/null
    ok "Shared listener now rejects unmatched paths with 404"
  fi
fi
awsl ecs create-cluster --cluster-name roadhub-cluster >/dev/null
