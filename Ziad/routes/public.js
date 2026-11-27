// Public routes of the Roadmap Service (mounted at /api). Visitors may read.
const express = require('express');
const { rateLimit } = require('../../shared');
const featureController = require('../controllers/featuresController');

const router = express.Router();
const readLimiter = rateLimit.createRateLimiter({ name: 'roadmap-read', ...rateLimit.policies.read });

router.get('/categories', readLimiter, featureController.categories);
router.get('/roadmap', readLimiter, featureController.board);
router.get('/features/:id', readLimiter, featureController.getOne);

module.exports = router;
