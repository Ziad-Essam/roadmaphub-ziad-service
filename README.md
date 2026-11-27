# RoadmapHub — Roadmap Service (S1)

Cloud Computing and Cloud Security (26CSCN29H), Team 22, Lab Group A-3.

Roadmap service owner: Ziad Essameldin Abdelwahed (239680).

## Service functionality

- Public four-column roadmap, categories, feature details, search, sorting, filtering and cursor pagination.
- Authenticated feature submission, owner editing and deletion, and administrator status transitions.
- Scoped internal feature resolution, merge preparation, completion, abort and undo operations.
- Version-aware engagement count synchronization through EventBridge, SQS and a separate worker.

## Repository structure

`Ziad/` holds the independent Express API, data repositories, services, security middleware, worker, tests and AWS provisioning scripts. `shared/` holds common security and AWS helpers. `docs/` contains the team API contracts for interoperability. Dependencies are installed at the repository root. The full team project separately contains the frontend, gateway, Engagement and Administration backends, and integrated tests.

## Local setup

Requirements: Node.js 20+, npm, Docker Desktop, Git Bash (on Windows), AWS CLI, local Floci.

```bash
npm ci
cp -n Ziad/.env.example Ziad/.env
docker compose -f Ziad/infra/floci/docker-compose.yml up -d
bash Ziad/infra/shared-local.sh
bash Ziad/infra/init-aws.sh
bash Ziad/infra/check-aws.sh
```

Use an isolated Floci environment for independent testing; do not start another container on port 4566 if that port is already occupied. The normal authenticated and cross-service operations require the team's shared secrets and running Administration and Engagement services. Start the full team environment for end-to-end workflows. The Roadmap API can serve public reads on its own after provisioning.

```bash
npm start
# In a separate terminal, start the counts worker:
npm run worker
```

Health: `http://localhost:3001/health`; board: `http://localhost:3001/api/roadmap`.

## Individual tests

Stop the normal Roadmap process. Keep Floci running. The individual suite creates isolated test tables and test-only secrets and runs a separate Roadmap process with a simulated Administration dependency. To avoid requiring a CloudWatch log group during the test:

```bash
CLOUDWATCH_LOG_GROUP= npm test
```

The suite tests data pagination, public reads, authenticated feature operations, ownership, status restrictions, internal service-token checks, merge operations, invalid inputs, headers and rate limits. Test-only resources may remain in Floci. Full team integration, frontend and k6 tests belong to the combined project, not this isolated repository.

## AWS services

Roadmap provisions DynamoDB, EventBridge, SQS (including a dead-letter queue), IAM, CloudWatch Logs and alarms, ALB target group and routes, ECS task/service records and Application Auto Scaling. Shared VPC, subnets, security group, ALB and ECS cluster are created by `shared-local.sh`. Authentication secrets are provisioned by the Administration service and read through Secrets Manager. The team frontend is hosted in S3.

Floci records ECS/ALB/scaling configuration; the actual local replica processes and routing are managed by the full team's Node.js launcher and gateway. This is not proof of real AWS deployment, IAM enforcement or production autoscaling.

Optional local image build from the repository root: `docker build -f Ziad/Dockerfile -t roadhub-roadmap:local .`.

Never commit `.env`, private keys or emulator data.
