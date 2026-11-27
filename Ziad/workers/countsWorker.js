// Start separately from the API: node workers/countsWorker.js
require('dotenv').config({ quiet: true });
const {
  SQSClient, GetQueueUrlCommand, ReceiveMessageCommand, DeleteMessageCommand
} = require('@aws-sdk/client-sqs');
const { features } = require('../repositories');
const { logger, validate } = require('../../shared');
const { countsQueueName } = require('../config');

logger.setServiceName('roadmap-counts');
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
let stopping = false;
process.on('SIGINT', () => { stopping = true; });
process.on('SIGTERM', () => { stopping = true; });

async function applyMessage(message) {
  const event = JSON.parse(message.Body);
  if (event.source !== 'roadhub.engagement' || event['detail-type'] !== 'EngagementCountsChanged') {
    throw new Error('Unexpected event');
  }
  const counts = event.detail;
  const featureId = validate.uuid(counts.featureId, 'featureId');
  for (const field of ['voteCount', 'commentCount', 'version']) {
    if (!Number.isSafeInteger(counts[field]) || counts[field] < 0) {
      throw new Error('Invalid count or version');
    }
  }
  // S2 sends totals. DynamoDB applies only a newer version for an existing feature.
  const updated = await features.setCounts(featureId, counts);
  logger.info(updated ? 'COUNTS_APPLIED' : 'COUNTS_SKIPPED', { featureId, version: counts.version });
}

async function run() {
  const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: countsQueueName }));
  logger.info('WORKER_STARTED', { queue: countsQueueName });
  while (!stopping) {
    const batch = await sqs.send(new ReceiveMessageCommand({
      QueueUrl, MaxNumberOfMessages: 10, WaitTimeSeconds: 5
    }));
    for (const message of batch.Messages || []) {
      try {
        await applyMessage(message);
        await sqs.send(new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.ReceiptHandle }));
      } catch (error) {
        // Leave the message in SQS. Its redrive policy moves repeated failures to the DLQ.
        logger.error('COUNTS_RETRY', { messageId: message.MessageId, reason: error.name });
      }
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    logger.error('WORKER_STOPPED', { reason: error.name });
    process.exitCode = 1;
  });
}
