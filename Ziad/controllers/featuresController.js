// HTTP layer of the Roadmap Service: validate, call featureService, choose the status code.
const { validate } = require('../../shared');
const featureService = require('../services/featureService');
const { categories: categoryRepository } = require('../repositories');

async function categories(req, res) {
  const categories = await categoryRepository.list();
  res.status(200).json({ categories });
}

// The four-column board in one call.
async function board(req, res) {
  const limit = validate.int(req.query.limit, 'limit', { min: 1, max: 50, fallback: 25 });
  const columns = await featureService.board({ sort: 'votes', limit });
  res.status(200).json({ columns });
}

async function getOne(req, res) {
  const result = await featureService.getFeature(validate.uuid(req.params.id));
  if (result.redirectTo) {
    // Temporary redirect (a merge can be undone): the browser follows it to the main request.
    res.set('Location', `/api/features/${result.redirectTo}`);
    return res.status(307).json({ redirectTo: result.redirectTo, mergedFeature: result.feature });
  }
  res.status(200).json({ feature: result.feature });
}

module.exports = { categories, board, getOne };
