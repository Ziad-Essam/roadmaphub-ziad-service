#!/usr/bin/env bash
# Joseph or Youssef provisions the shared bus. Add only the Roadmap queue and rule.
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
bus=roadhub-events
rule=roadhub-roadmap-counts-rule
queue=roadhub-roadmap-counts-queue
dlq=roadhub-roadmap-counts-dlq
awsl events describe-event-bus --name "$bus" >/dev/null
dlq_url=$(awsl sqs create-queue --queue-name "$dlq" --query QueueUrl --output text)
queue_url=$(awsl sqs create-queue --queue-name "$queue" --query QueueUrl --output text)
queue_arn() {
  awsl sqs get-queue-attributes --queue-url "$1" --attribute-names QueueArn --query Attributes.QueueArn --output text
}
dlq_arn=$(queue_arn "$dlq_url")
arn=$(queue_arn "$queue_url")
rule_arn=$(awsl events put-rule --name "$rule" --event-bus-name "$bus" \
  --event-pattern '{"source":["roadhub.engagement"],"detail-type":["EngagementCountsChanged"]}' \
  --query RuleArn --output text)
# AWS expects policy documents as strings inside the attributes object.
attributes=$(node - "$dlq_arn" "$arn" "$rule_arn" <<'JS'
const [dlq, queue, rule] = process.argv.slice(2);
const policy = {
  Version: '2012-10-17',
  Statement: [{
    Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' },
    Action: 'sqs:SendMessage', Resource: queue,
    Condition: { ArnEquals: { 'aws:SourceArn': rule } }
  }]
};
console.log(JSON.stringify({
  RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlq, maxReceiveCount: '3' }),
  Policy: JSON.stringify(policy)
}));
JS
)
awsl sqs set-queue-attributes --queue-url "$queue_url" --attributes "$attributes"
failed=$(awsl events put-targets --event-bus-name "$bus" --rule "$rule" \
  --targets "Id=roadmap-counts,Arn=$arn" --query FailedEntryCount --output text)
[[ "$failed" == 0 ]]
ok "$rule forwards EngagementCountsChanged to $queue"
