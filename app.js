
const express = require('express');
const { http } = require('./shared');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(http.requestId);
app.use(http.requestLogger);
app.use(http.securityHeaders);

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'roadmap',
    pid: process.pid,
    port: Number(process.env.PORT)
  });
});

app.use(http.notFound);
app.use(http.errorHandler);

module.exports = app;
