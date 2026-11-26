
const express = require('express');
const { rateLimit } = require('../shared');
const featureController = require('../controllers/featuresController');

const router = express.Router();

const readLimiter = rateLimit.createRateLimiter({
  name: 'roadmap-read',
  windowMs: 60000,
  max: 600
});

router.get('/categories', readLimiter, featureController.categories);

module.exports = router;
