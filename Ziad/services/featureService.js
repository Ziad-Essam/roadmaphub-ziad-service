// Roadmap business rules (no HTTP, no SDK calls here: only repositories and events).
const { randomUUID } = require('crypto');
const { http, events } = require('../../shared');
const repos = require('../repositories');
const { STATUSES, LABELS, canMove } = require('./statusRules');

const { errors } = http;

function publicFeature(f) {
  return {
    featureId: f.featureId, title: f.title, description: f.description,
    categoryId: f.categoryId, categoryName: f.categoryName,
    status: f.status, statusLabel: LABELS[f.status], declineReason: f.declineReason,
    authorId: f.authorId, authorName: f.authorName,
    voteCount: f.voteCount || 0, commentCount: f.commentCount || 0,
    merged: Boolean(f.mergedInto), mergedInto: f.mergedInto,
    createdAt: f.createdAt, updatedAt: f.updatedAt, statusChangedAt: f.statusChangedAt
  };
}

// Follows merge links to the request that is shown publicly (at most 5 steps, no loops).
async function resolve(featureId) {
  let feature = await repos.features.get(featureId);
  if (!feature) return null;
  for (let hops = 0; feature.mergedInto && hops < 5; hops += 1) {
    const next = await repos.features.get(feature.mergedInto);
    if (!next) break;
    feature = next;
  }
  return feature;
}

async function board({ categoryId, q, sort, limit }) {
  // Start one query per column. DynamoDB can answer the four reads concurrently.
  async function readColumn(status) {
    const page = await repos.features.listByStatus({ status, sort, categoryId, q, limit });
    return {
      label: LABELS[status],
      items: page.items.map(publicFeature),
      hasMore: Boolean(page.next)
    };
  }

  const pages = await Promise.all(STATUSES.map(readColumn));
  const columns = {};
  for (const [index, status] of STATUSES.entries()) {
    columns[status] = pages[index];
  }
  return columns;
}

async function listColumn({ status, categoryId, q, sort, limit, cursor }) {
  const page = await repos.features.listByStatus({ status, sort, categoryId, q, limit, cursor });
  return { items: page.items.map(publicFeature), next: page.next };
}

// Returns { feature } or { redirectTo } when the request was merged into another one.
async function getFeature(featureId) {
  const feature = await repos.features.get(featureId);
  if (!feature) throw errors.notFound('FEATURE_NOT_FOUND', 'This feature request does not exist.');
  if (feature.mergedInto) {
    const canonical = await resolve(featureId);
    return { redirectTo: canonical.featureId, feature: publicFeature(feature) };
  }
  return { feature: publicFeature(feature) };
}

async function create(user, { title, description, categoryId }, requestId) {
  const category = await repos.categories.get(categoryId);
  if (!category) throw errors.badRequest('categoryId is not a known category.', { field: 'categoryId' });
  const now = new Date().toISOString();
  const feature = await repos.features.create({
    featureId: randomUUID(), title, description, searchText: `${title} ${description}`.toLowerCase(),
    categoryId, categoryName: category.name,
    status: 'under_review', boardStatus: 'under_review', // every new request starts Under Review
    authorId: user.id, authorName: user.name, voteCount: 0, commentCount: 0,
    createdAt: now, updatedAt: now, statusChangedAt: now
  });
  await events.publish('roadmap', 'FeatureCreated', { featureId: feature.featureId, title, categoryId, authorId: user.id }, { requestId });
  return publicFeature(feature);
}

// Explains why an owner-only change was refused.
async function whyRefused(featureId, userId, action) {
  const f = await repos.features.get(featureId);
  if (!f) return errors.notFound('FEATURE_NOT_FOUND', 'This feature request does not exist.');
  if (f.authorId !== userId) return errors.forbidden('NOT_OWNER', `You can only ${action} your own requests.`);
  if (f.mergedInto || f.mergeLock) return errors.conflict('FEATURE_MERGED', 'This request is being merged or was merged.');
  if (f.status !== 'under_review') return errors.conflict('NOT_EDITABLE', `Only requests that are Under Review can be ${action === 'edit' ? 'edited' : 'deleted'}.`);
  if (f.mergedChildCount > 0) return errors.conflict('HAS_DUPLICATES', 'Requests with linked duplicates cannot be deleted.');
  return errors.conflict('HAS_ENGAGEMENT', 'This request already has votes or comments, so it can no longer be deleted.');
}

async function update(user, featureId, changes) {
  const updates = { ...changes };
  if (changes.categoryId) {
    const category = await repos.categories.get(changes.categoryId);
    if (!category) throw errors.badRequest('categoryId is not a known category.', { field: 'categoryId' });
    updates.categoryName = category.name;
  }
  if (changes.title || changes.description) {
    const current = await repos.features.get(featureId);
    if (current) updates.searchText = `${changes.title || current.title} ${changes.description || current.description}`.toLowerCase();
  }
  const updated = await repos.features.updateOwn(featureId, user.id, updates);
  if (!updated) throw await whyRefused(featureId, user.id, 'edit');
  return publicFeature(updated);
}

async function remove(user, featureId, requestId) {
  if (!(await repos.features.deleteOwn(featureId, user.id))) throw await whyRefused(featureId, user.id, 'delete');
  await events.publish('roadmap', 'FeatureDeleted', { featureId, authorId: user.id }, { requestId });
}

async function changeStatus(admin, featureId, newStatus, requestId, reason) {
  const f = await repos.features.get(featureId);
  if (!f) throw errors.notFound('FEATURE_NOT_FOUND', 'This feature request does not exist.');
  if (f.mergedInto || f.mergeLock) throw errors.conflict('FEATURE_MERGED', 'A merged request cannot change status.');
  if (!canMove(f.status, newStatus)) {
    throw errors.conflict('INVALID_TRANSITION', `A request cannot move from ${LABELS[f.status]} to ${LABELS[newStatus]}.`);
  }
  const updated = await repos.features.changeStatus(featureId, f.status, newStatus, reason);
  if (!updated) throw errors.conflict('STATUS_CONFLICT', 'The status was changed by someone else. Reload and try again.');
  await events.publish('roadmap', 'FeatureStatusChanged', {
    featureId, title: f.title, oldStatus: f.status, newStatus, authorId: f.authorId, actorId: admin.id
  }, { requestId });
  return publicFeature(updated);
}

async function myFeatures(user, { limit, cursor }) {
  const page = await repos.features.listByAuthor(user.id, { limit, cursor });
  return { items: page.items.map(publicFeature), next: page.next };
}

module.exports = { publicFeature, resolve, board, listColumn, getFeature, create, update, remove, changeStatus, myFeatures };
