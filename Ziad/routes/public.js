// Public API: categories only until Stage 6.
const express = require('express');
const { rateLimit } = require('../../shared');
const featureController = require('../controllers/featuresController');

const router = express.Router();
const readLimiter = rateLimit.createRateLimiter({ name: 'roadmap-read', ...rateLimit.policies.read });

router.get('/categories', readLimiter, featureController.categories);

module.exports = router;
