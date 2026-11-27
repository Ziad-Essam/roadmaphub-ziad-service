#!/usr/bin/env bash
# Record Roadmap's routing in the team's local Floci instance.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
case "$AWS_ENDPOINT_URL" in http://localhost:4566|http://127.0.0.1:4566) ;; *) echo "Use the team's local Floci endpoint"; exit 1;; esac
alb=$(awsl elbv2 describe-load-balancers --names roadhub-alb --query 'LoadBalancers[0].LoadBalancerArn' --output text)
vpc=$(awsl elbv2 describe-load-balancers --names roadhub-alb --query 'LoadBalancers[0].VpcId' --output text)
listener=$(awsl elbv2 describe-listeners --load-balancer-arn "$alb" --query 'Listeners[?Port==`80`].ListenerArn | [0]' --output text)
[[ "$listener" == arn:* ]] || { echo "The shared port 80 listener is missing"; exit 1; }
name=roadhub-roadmap-tg
tg=$(awsl elbv2 describe-target-groups --query "TargetGroups[?TargetGroupName=='$name'].TargetGroupArn | [0]" --output text)
if [[ -z "$tg" || "$tg" == None ]]; then
  tg=$(awsl elbv2 create-target-group --name "$name" --vpc-id "$vpc" --protocol HTTP --port 3001 --target-type ip --health-check-path /health --query 'TargetGroups[0].TargetGroupArn' --output text)
fi
# Engagement uses 20/21. Roadmap uses 30 (features) and 31 (board/categories).
# Check both priorities before changing either rule: never overwrite a teammate's rule.
for priority in 30 31; do
  existing=$(awsl elbv2 describe-rules --listener-arn "$listener" --query "Rules[?Priority=='$priority'].RuleArn | [0]" --output text)
  if [[ "$existing" == arn:* ]]; then
    owner=$(awsl elbv2 describe-rules --listener-arn "$listener" --query "Rules[?Priority=='$priority'].Actions[0].TargetGroupArn | [0]" --output text)
    if [[ "$owner" != "$tg" ]]; then
      echo "Priority $priority belongs to a different target group. Coordinate with the team."; exit 1
    fi
  fi
done
roadmap_rule() {
  local priority="$1" paths="$2" existing current
  existing=$(awsl elbv2 describe-rules --listener-arn "$listener" --query "Rules[?Priority=='$priority'].RuleArn | [0]" --output text)
  if [[ "$existing" != arn:* ]]; then
    awsl elbv2 create-rule --listener-arn "$listener" --priority "$priority" \
      --conditions "Field=path-pattern,Values=$paths" --actions "Type=forward,TargetGroupArn=$tg" >/dev/null
  else
    # Also upgrade the old Roadmap rule 30 if it was created by the baseline.
    current=$(awsl elbv2 describe-rules --listener-arn "$listener" --query "Rules[?Priority=='$priority'].Conditions[0].Values | [0]" --output json)
    if ! node -e 'const a=JSON.parse(process.argv[1]); const b=process.argv[2].split(","); process.exit(JSON.stringify([...a].sort())===JSON.stringify(b.sort())?0:1)' "$current" "$paths"; then
      awsl elbv2 modify-rule --rule-arn "$existing" --conditions "Field=path-pattern,Values=$paths" >/dev/null
    fi
  fi
}
roadmap_rule 30 '/api/features,/api/features/*,/api/me/features'
roadmap_rule 31 '/api/roadmap,/api/categories'
# Local lab records; the gateway actually sends requests to these three ports.
for port in 3001 3011 3021; do
  awsl elbv2 register-targets --target-group-arn "$tg" --targets "Id=127.0.0.1,Port=$port"
done
awsl elbv2 describe-target-health --target-group-arn "$tg" --query 'TargetHealthDescriptions[].Target'
