// Internal routes of the Roadmap Service, mounted at /internal/features (service token + scope).
const express = require('express');
const { internalAuth } = require('../../shared');
const internalController = require('../controllers/internalController');

const router = express.Router();
const need = (scope) => internalAuth.requireService('roadmap', scope);

router.get('/_ping', need('features:read'), (req, res) => res.status(200).json({ service: 'roadmap', caller: req.caller.service }));
router.get('/candidates', need('features:read'), internalController.candidates);
router.post('/resolve-batch', need('features:read'), internalController.resolveBatch);
router.get('/:id/resolve', need('features:read'), internalController.resolve);
router.use('/merges', need('features:merge'), (req, res, next) => {
  if (req.caller.service === 'admin') return next();
  return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Administration performs merge steps.' } });
});
router.post('/merges/prepare', internalController.prepare);
router.post('/merges/complete', internalController.complete);
router.post('/merges/abort', internalController.abort);
router.post('/merges/undo', internalController.undo);

module.exports = router;
