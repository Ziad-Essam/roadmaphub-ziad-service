#!/usr/bin/env bash
# Creates the Roadmap Service's own DynamoDB tables (owner: Ziad). Safe to run again.
# Only this service reads or writes these tables; the others ask over HTTP (/internal/features/*).
set -euo pipefail
source "$(dirname "$0")/../lib.sh"
step "DynamoDB tables: roadmap-service"

# boardStatus is set only on public (not merged) requests -> a "sparse" index that holds exactly the board cards.
make_table "$PREFIX-features" \
  --attribute-definitions AttributeName=featureId,AttributeType=S AttributeName=boardStatus,AttributeType=S \
    AttributeName=createdAt,AttributeType=S AttributeName=voteCount,AttributeType=N AttributeName=authorId,AttributeType=S \
  --key-schema AttributeName=featureId,KeyType=HASH \
  --global-secondary-indexes "[$(gsi status-created-index boardStatus createdAt),$(gsi status-votes-index boardStatus voteCount),$(gsi author-index authorId createdAt)]"
make_table "$PREFIX-categories" \
  --attribute-definitions AttributeName=categoryId,AttributeType=S \
  --key-schema AttributeName=categoryId,KeyType=HASH

step "Extra settings"
point_in_time_recovery "$PREFIX-features"

step "Seed the fixed category list"
while IFS='|' read -r id name order; do
  awsl dynamodb put-item --table-name "$PREFIX-categories" --item \
    "{\"categoryId\":{\"S\":\"$id\"},\"name\":{\"S\":\"$name\"},\"sortOrder\":{\"N\":\"$order\"}}" >/dev/null
  ok "category $id"
done <<'CATS'
ui-ux|User interface and design|1
performance|Performance and speed|2
integrations|Integrations|3
mobile|Mobile experience|4
security|Security and privacy|5
reporting|Reports and analytics|6
other|Other|7
CATS
