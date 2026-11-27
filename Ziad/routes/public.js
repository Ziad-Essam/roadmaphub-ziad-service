// Public routes of the Roadmap Service (mounted at /api). Visitors may read; changes need a login.
const express = require('express');
const { rateLimit, turnstile } = require('../../shared');
const auth = require('../middleware/auth');
const featureController = require('../controllers/featuresController');

const router = express.Router();
const submitLimiter = rateLimit.createRateLimiter({ name: 'submit-feature', ...rateLimit.policies.submit });
const readLimiter = rateLimit.createRateLimiter({ name: 'roadmap-read', ...rateLimit.policies.read });

const writeLimiter = rateLimit.createRateLimiter({ name: 'roadmap-write', ...rateLimit.policies.write });
const adminLimiter = rateLimit.createRateLimiter({ name: 'roadmap-admin', ...rateLimit.policies.admin });

// Visitors (no login)
router.get('/categories', readLimiter, featureController.categories);
router.get('/roadmap', readLimiter, featureController.board);
router.get('/features', readLimiter, featureController.list);
router.get('/features/:id', readLimiter, featureController.getOne);

// Registered users
router.get('/me/features', readLimiter, auth.requireUser, featureController.mine);
router.post('/features', auth.requireUser, auth.requireRole('user'), submitLimiter, turnstile.requireTurnstile, featureController.create);
router.patch('/features/:id', auth.requireUser, writeLimiter, featureController.update);
router.delete('/features/:id', auth.requireUser, writeLimiter, featureController.remove);

// Administrators
router.patch('/features/:id/status', auth.requireUser, auth.requireRole('admin'), adminLimiter, featureController.changeStatus);

module.exports = router;
