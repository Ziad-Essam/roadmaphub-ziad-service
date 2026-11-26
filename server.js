// Starts the Roadmap Service (S1) on its own port (independent process).
require('dotenv').config({ quiet: true });
process.env.SERVICE_NAME = process.env.SERVICE_NAME || 'roadmap';
const { logger } = require('./shared');
const app = require('./app');

logger.setServiceName(process.env.SERVICE_NAME);
const port = Number(process.env.PORT) || 3001;
async function start() {
  if (process.env.CLOUDWATCH_LOG_GROUP) {
    const { startSecurityLog } = require('./services/cloudwatch');
    await startSecurityLog(process.env.CLOUDWATCH_LOG_GROUP);
  }
  const server = app.listen(port, () => logger.info('SERVICE_STARTED', { port, pid: process.pid }));
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

start().catch((error) => {
  logger.error('STARTUP_FAILED', { reason: error.name });
  process.exitCode = 1;
});
