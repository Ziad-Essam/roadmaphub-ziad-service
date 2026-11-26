// One stream per API process. Use the existing shared logger's addSink hook.
const { randomUUID } = require('node:crypto');
const { CloudWatchLogsClient, CreateLogStreamCommand, PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
const { logger } = require('../shared');

async function startSecurityLog(group) {
  const client = new CloudWatchLogsClient({});
  const stream = 'api-' + randomUUID();
  await client.send(new CreateLogStreamCommand({ logGroupName: group, logStreamName: stream }));
  logger.addSink((message, entry) => {
    if (entry.level !== 'SECURITY' && entry.level !== 'ERROR') return;
    const batch = { logGroupName: group, logStreamName: stream, logEvents: [{ timestamp: Date.now(), message }] };
    client.send(new PutLogEventsCommand(batch)).catch((error) => {
      console.error('CloudWatch delivery failed:', error.name);
    });
  });
}

module.exports = { startSecurityLog };
