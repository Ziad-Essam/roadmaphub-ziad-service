// Internal endpoints of the Roadmap Service (other services only, see ../docs/internal-api-contract.md).
const { validate, http } = require('../../shared');
const featureService = require('../services/featureService');
const mergeSteps = require('../services/mergeSteps');
const repos = require('../repositories');

async function resolve(req, res) {
  const id = validate.uuid(req.params.id);
  const f = await repos.features.get(id);
  if (!f) return http.sendError(res, 404, 'FEATURE_NOT_FOUND', 'This feature request does not exist.');
  const canonical = await featureService.resolve(id);
  res.status(200).json({
    featureId: id, canonicalId: canonical.featureId, exists: true, status: canonical.status,
    title: canonical.title, authorId: canonical.authorId, merged: Boolean(f.mergedInto),
    locked: Boolean(canonical.mergeLock)
  });
}

async function resolveBatch(req, res) {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.slice(0, 100).map((id) => validate.uuid(id, 'ids')) : [];
  const found = await repos.features.getMany(ids);
  const items = await Promise.all(found.map(async (f) => {
    const canonical = f.mergedInto ? await featureService.resolve(f.featureId) : f;
    return {
      featureId: f.featureId, canonicalId: canonical.featureId, title: canonical.title, status: canonical.status,
      categoryName: canonical.categoryName, statusChangedAt: canonical.statusChangedAt, merged: Boolean(f.mergedInto)
    };
  }));
  res.status(200).json({ items });
}

async function candidates(req, res) {
  res.status(200).json({ items: await repos.features.listCandidates() });
}

function mergeBody(req) {
  validate.onlyFields(req.body, ['mergeId', 'sourceId', 'targetId']);
  return { mergeId: validate.uuid(req.body.mergeId, 'mergeId'), sourceId: validate.uuid(req.body.sourceId, 'sourceId'), targetId: validate.uuid(req.body.targetId, 'targetId') };
}

async function prepare(req, res) {
  const merge = mergeBody(req);
  const result = await mergeSteps.prepare(merge);
  res.status(200).json(result);
}
async function complete(req, res) {
  const merge = mergeBody(req);
  const result = await mergeSteps.complete(merge);
  res.status(200).json(result);
}
async function abort(req, res) {
  const merge = mergeBody(req);
  const result = await mergeSteps.abort(merge);
  res.status(200).json(result);
}
async function undo(req, res) {
  const merge = mergeBody(req);
  const result = await mergeSteps.undo(merge);
  res.status(200).json(result);
}

module.exports = { resolve, resolveBatch, candidates, prepare, complete, abort, undo };
