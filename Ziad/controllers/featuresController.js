// HTTP layer of the Roadmap Service: validate, call featureService, choose the status code.
const { validate, cursor } = require('../../shared');
const featureService = require('../services/featureService');
const { categories: categoryRepository } = require('../repositories');
const { STATUSES } = require('../services/statusRules');

function listOptions(query) {
  return {
    categoryId: query.category ? validate.text(query, 'category', { min: 1, max: 40 }) : undefined,
    q: query.q ? validate.text(query, 'q', { min: 2, max: 60 }) : undefined,
    sort: query.sort ? validate.oneOf(query.sort, ['votes', 'newest'], 'sort') : 'votes'
  };
}

async function categories(req, res) {
  const categories = await categoryRepository.list();
  res.status(200).json({ categories });
}

// The four-column board in one call.
async function board(req, res) {
  const limit = validate.int(req.query.limit, 'limit', { min: 1, max: 50, fallback: 25 });
  const options = listOptions(req.query);
  const columns = await featureService.board({ ...options, limit });
  res.status(200).json({ columns });
}

// One column, page by page (?status=planned&cursor=...).
async function list(req, res) {
  const status = validate.oneOf(req.query.status, STATUSES, 'status');
  const limit = validate.int(req.query.limit, 'limit', { min: 1, max: 50, fallback: 20 });
  const page = await featureService.listColumn({ status, ...listOptions(req.query), limit, cursor: cursor.decode(req.query.cursor) });
  res.status(200).json({ items: page.items, nextCursor: cursor.encode(page.next) });
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

async function create(req, res) {
  validate.onlyFields(req.body, ['title', 'description', 'categoryId']); // no status, author or counts from the client
  const feature = await featureService.create(req.user, {
    title: validate.text(req.body, 'title', { min: 5, max: 120 }),
    description: validate.text(req.body, 'description', { min: 10, max: 2000 }),
    categoryId: validate.text(req.body, 'categoryId', { min: 1, max: 40 })
  }, req.id);
  res.status(201).json({ feature });
}

async function update(req, res) {
  validate.onlyFields(req.body, ['title', 'description', 'categoryId']);
  const changes = {};
  if (req.body.title !== undefined) changes.title = validate.text(req.body, 'title', { min: 5, max: 120 });
  if (req.body.description !== undefined) changes.description = validate.text(req.body, 'description', { min: 10, max: 2000 });
  if (req.body.categoryId !== undefined) changes.categoryId = validate.text(req.body, 'categoryId', { min: 1, max: 40 });
  if (!Object.keys(changes).length) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Nothing to change.' } });
  const featureId = validate.uuid(req.params.id);
  const feature = await featureService.update(req.user, featureId, changes);
  res.status(200).json({ feature });
}

async function remove(req, res) {
  await featureService.remove(req.user, validate.uuid(req.params.id), req.id);
  res.status(204).end();
}

async function changeStatus(req, res) {
  const declining = req.body?.status === 'declined';
  validate.onlyFields(req.body, declining ? ['status', 'reason'] : ['status']);
  const reason = declining ? validate.text(req.body, 'reason', { min: 1, max: 500 }) : undefined;
  const status = validate.oneOf(req.body.status, [...STATUSES, 'declined'], 'status');
  const featureId = validate.uuid(req.params.id);
  const feature = await featureService.changeStatus(req.user, featureId, status, req.id, reason);
  res.status(200).json({ feature });
}

async function mine(req, res) {
  const limit = validate.int(req.query.limit, 'limit', { min: 1, max: 50, fallback: 50 });
  const page = await featureService.myFeatures(req.user, { limit, cursor: cursor.decode(req.query.cursor) });
  res.status(200).json({ items: page.items, nextCursor: cursor.encode(page.next) });
}

module.exports = { categories, board, list, getOne, create, update, remove, changeStatus, mine };
