
const express = require('express');
const cors = require('cors');
const { http } = require('./shared');
const publicRoutes = require('./routes/public');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(http.requestId);
app.use(http.requestLogger);
app.use(http.securityHeaders);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'roadmap',
    pid: process.pid,
    port: Number(process.env.PORT)
  });
});

// Public API configuration
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  'http://localhost:4566,http://localhost:8080'
).split(',').map((o) => o.trim()).filter(Boolean);

app.use('/api', cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Turnstile-Token',
    'X-Request-Id'
  ],
  exposedHeaders: ['X-Request-Id', 'X-Served-By']
}));

app.use(
  '/api',
  http.requireJson,
  express.json({ limit: '10kb' }),
  publicRoutes
);

app.use(http.notFound);
app.use(http.errorHandler);

module.exports = app;
