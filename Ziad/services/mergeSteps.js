// The Roadmap Service's part of a merge. The Administration Service runs the whole merge
// and calls these steps over HTTP. Every step is idempotent (same mergeId -> same result).
const { http } = require('../../shared');
const repos = require('../repositories');
const { publicFeature } = require('./featureService');

const { errors } = http;

async function prepare({ mergeId, sourceId, targetId }) {
  if (sourceId === targetId) throw errors.badRequest('A request cannot be merged into itself.');
  const [source, target] = await Promise.all([repos.features.get(sourceId), repos.features.get(targetId)]);
  if (!source) throw errors.notFound('SOURCE_NOT_FOUND', 'The duplicate request does not exist.');
  if (!target) throw errors.notFound('TARGET_NOT_FOUND', 'The main request does not exist.');
  if (!(await repos.features.lockForMerge(mergeId, sourceId, targetId))) {
    const s = await repos.features.get(sourceId);
    if (s && s.mergedChildCount > 0) throw errors.conflict('SOURCE_HAS_DUPLICATES', 'This request already has merged duplicates; merge the other way round.');
    throw errors.conflict('MERGE_CONFLICT', 'One of the requests is already merged or is being merged.');
  }
  return { source: publicFeature(source), target: publicFeature(target) };
}

async function complete({ mergeId, sourceId, targetId }) {
  if (!(await repos.features.completeMerge(mergeId, sourceId, targetId))) {
    throw errors.conflict('MERGE_NOT_PREPARED', 'This merge was not prepared or was cancelled.');
  }
  return { merged: true };
}

async function abort({ mergeId, sourceId, targetId }) {
  await Promise.all([repos.features.releaseLock(sourceId, mergeId), repos.features.releaseLock(targetId, mergeId)]);
  return { aborted: true };
}

async function undo({ mergeId, sourceId, targetId }) {
  if (!(await repos.features.undoMerge(mergeId, sourceId, targetId))) {
    throw errors.conflict('UNDO_NOT_POSSIBLE', 'This merge cannot be undone in the roadmap (state changed).');
  }
  const source = await repos.features.get(sourceId);
  return { restored: publicFeature(source) };
}

module.exports = { prepare, complete, abort, undo };
