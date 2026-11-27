// Publishes business events to the EventBridge bus "roadhub-events".
// Rules on the bus send them to SQS queues (e-mails, vote counts) and to CloudWatch Logs.
// Retry transient entry failures with the same event ID. Publishing remains best-effort;
// an outbox would be needed for guaranteed delivery.
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { randomUUID } = require('crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const logger = require('./logger');

const client = new EventBridgeClient({});
const BUS = process.env.EVENT_BUS_NAME || 'roadhub-events';

async function publish(source, detailType, detail, { requestId } = {}) {
  if (process.env.EVENTS === 'off') return false;
  const eventId = randomUUID();
  try {
    const entry = {
      EventBusName: BUS,
      Source: `roadhub.${source}`,
      DetailType: detailType,
      Detail: JSON.stringify({ eventId, occurredAt: new Date().toISOString(), requestId, ...detail })
    };
    // The AWS SDK retries transient request errors. PutEvents can also return a
    // successful HTTP response with a failed entry, which needs its own retry.
    for (let attempt = 1; attempt <= 3; attempt++) {
      const out = await client.send(new PutEventsCommand({ Entries: [entry] }));
      if (!out.FailedEntryCount) break;
      const code = out.Entries?.[0]?.ErrorCode;
      if (attempt === 3 || !['InternalFailure', 'ThrottlingException'].includes(code)) {
        const error = new Error('EventBridge entry failed');
        error.name = code || 'EventEntryFailed';
        throw error;
      }
      await sleep(attempt * 100);
    }
    logger.info('EVENT_PUBLISHED', { requestId, eventType: detailType, eventId });
    return true;
  } catch (e) {
    logger.error('EVENT_PUBLISH_FAILED', { requestId, eventType: detailType, eventId, reason: e.name });
    return false;
  }
}

module.exports = { publish, BUS };
