// Roadmap business rules (no HTTP, no SDK calls here: only repositories and events).
const { http } = require('../../shared');
const repos = require('../repositories');
const { STATUSES, LABELS } = require('./statusRules');

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

module.exports = { publicFeature, resolve, board, getFeature };
