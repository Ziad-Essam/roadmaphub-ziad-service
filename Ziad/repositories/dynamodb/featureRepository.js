// Feature requests in DynamoDB (table roadhub-features). Every access uses a key or an index:
//   status-created-index (boardStatus, createdAt)  board column, newest first
//   status-votes-index   (boardStatus, voteCount)  board column, most votes first
//   author-index         (authorId, createdAt)     "My requests"
// boardStatus exists only on public requests, so a merged request is automatically off the board.
const {
  GetCommand, PutCommand, UpdateCommand, DeleteCommand, QueryCommand, BatchGetCommand, TransactWriteCommand
} = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('../../../shared');
const config = require('../../config');

const { db, isConditionFailure } = dynamo;
const TABLE = config.tables.features;
const OPEN = 'attribute_not_exists(mergedInto) AND attribute_not_exists(mergeLock)';

async function create(feature) {
  await db.send(new PutCommand({ TableName: TABLE, Item: feature, ConditionExpression: 'attribute_not_exists(featureId)' }));
  return feature;
}

async function get(featureId) {
  const out = await db.send(new GetCommand({ TableName: TABLE, Key: { featureId }, ConsistentRead: true }));
  return out.Item || null;
}

async function getMany(ids) {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return [];
  const out = await db.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: unique.map((featureId) => ({ featureId })) } } }));
  return out.Responses[TABLE] || [];
}

// One board column, filtered by category and/or keyword. A filter is applied after DynamoDB reads
// a page, so we read up to 5 pages to fill the requested number of cards.
async function listByStatus({ status, sort = 'votes', categoryId, q, limit = 20, cursor }) {
  const values = { ':s': status };
  const filters = [];
  if (categoryId) { filters.push('categoryId = :c'); values[':c'] = categoryId; }
  if (q) { filters.push('contains(searchText, :q)'); values[':q'] = q.toLowerCase(); }
  const items = [];
  let startKey = cursor;
  for (let page = 0; page < 5 && items.length < limit; page += 1) {
    const out = await db.send(new QueryCommand({
      TableName: TABLE,
      IndexName: sort === 'newest' ? 'status-created-index' : 'status-votes-index',
      KeyConditionExpression: 'boardStatus = :s',
      FilterExpression: filters.length ? filters.join(' AND ') : undefined,
      ExpressionAttributeValues: values,
      ScanIndexForward: false,
      // Never read past the last card we will return to the caller.
      Limit: limit - items.length,
      ExclusiveStartKey: startKey
    }));
    items.push(...(out.Items || []));
    startKey = out.LastEvaluatedKey;
    if (!startKey) break;
  }
  return { items: items.slice(0, limit), next: startKey };
}

async function listByAuthor(authorId, { limit = 50, cursor } = {}) {
  const out = await db.send(new QueryCommand({
    TableName: TABLE, IndexName: 'author-index', KeyConditionExpression: 'authorId = :a',
    ExpressionAttributeValues: { ':a': authorId }, ScanIndexForward: false, Limit: limit, ExclusiveStartKey: cursor
  }));
  return { items: out.Items || [], next: out.LastEvaluatedKey };
}

// Owner edit: only the author, only while Under Review, never during or after a merge.
async function updateOwn(featureId, authorId, changes) {
  const names = { '#s': 'status' };
  const values = { ':me': authorId, ':review': 'under_review', ':now': new Date().toISOString() };
  const sets = ['updatedAt = :now'];
  for (const [field, value] of Object.entries(changes)) {
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }
  try {
    const out = await db.send(new UpdateCommand({
      TableName: TABLE, Key: { featureId }, UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: `authorId = :me AND #s = :review AND ${OPEN}`,
      ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW'
    }));
    return out.Attributes;
  } catch (e) {
    if (isConditionFailure(e)) return null;
    throw e;
  }
}

// Owner delete: also refused once other people voted or commented (their contribution is kept).
async function deleteOwn(featureId, authorId) {
  try {
    await db.send(new DeleteCommand({
      TableName: TABLE, Key: { featureId },
      ConditionExpression: `authorId = :me AND #s = :review AND ${OPEN} AND voteCount = :zero AND commentCount = :zero AND (attribute_not_exists(mergedChildCount) OR mergedChildCount = :zero)`,
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':me': authorId, ':review': 'under_review', ':zero': 0 }
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false;
    throw e;
  }
}

// Admin status change, only if nobody changed it in the meantime (status still = from).
async function changeStatus(featureId, from, to, reason) {
  const now = new Date().toISOString();
  try {
    const out = await db.send(new UpdateCommand({
      TableName: TABLE, Key: { featureId },
      UpdateExpression: to === 'declined'
        ? 'SET #s = :to, declineReason = :reason, updatedAt = :now, statusChangedAt = :now REMOVE boardStatus'
        : 'SET #s = :to, boardStatus = :to, updatedAt = :now, statusChangedAt = :now',
      ConditionExpression: `#s = :from AND ${OPEN}`,
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':to': to, ':from': from, ':now': now, ...(to === 'declined' ? { ':reason': reason } : {}) },
      ReturnValues: 'ALL_NEW'
    }));
    return out.Attributes;
  } catch (e) {
    if (isConditionFailure(e)) return null;
    throw e;
  }
}

// Vote/comment numbers sent by the Engagement Service (through EventBridge + SQS).
// The version makes the update safe when messages arrive twice or out of order.
async function setCounts(featureId, { voteCount, commentCount, version }) {
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { featureId },
      UpdateExpression: 'SET voteCount = :v, commentCount = :c, countsVersion = :ver',
      ConditionExpression: 'attribute_exists(featureId) AND (attribute_not_exists(countsVersion) OR countsVersion < :ver)',
      ExpressionAttributeValues: { ':v': voteCount, ':c': commentCount, ':ver': version }
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false; // older message or deleted request: nothing to do
    throw e;
  }
}

// Public, not merged requests for duplicate detection (newest first, at most 500).
async function listCandidates() {
  const items = [];
  for (const status of ['under_review', 'planned', 'in_progress', 'shipped']) {
    let startKey;
    do {
      const out = await db.send(new QueryCommand({
        TableName: TABLE, IndexName: 'status-created-index', KeyConditionExpression: 'boardStatus = :s',
        ExpressionAttributeValues: { ':s': status }, ScanIndexForward: false, ExclusiveStartKey: startKey,
        ProjectionExpression: 'featureId, title, #s, voteCount, createdAt', ExpressionAttributeNames: { '#s': 'status' }
      }));
      items.push(...(out.Items || []));
      startKey = out.LastEvaluatedKey;
    } while (startKey && items.length < 500);
  }
  return items.slice(0, 500);
}

// ---------- merge steps (called by the Administration Service) ----------
// Each step is idempotent: repeating it with the same mergeId changes nothing twice.

async function lockForMerge(mergeId, sourceId, targetId) {
  const lockable = 'attribute_exists(boardStatus) AND attribute_not_exists(mergedInto) AND (attribute_not_exists(mergeLock) OR mergeLock = :m)';
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: { TableName: TABLE, Key: { featureId: sourceId }, UpdateExpression: 'SET mergeLock = :m',
          ConditionExpression: `${lockable} AND (attribute_not_exists(mergedChildCount) OR mergedChildCount = :zero)`,
          ExpressionAttributeValues: { ':m': mergeId, ':zero': 0 } } },
        { Update: { TableName: TABLE, Key: { featureId: targetId }, UpdateExpression: 'SET mergeLock = :m',
          ConditionExpression: lockable, ExpressionAttributeValues: { ':m': mergeId } } }
      ]
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) return false;
    throw e;
  }
}

async function completeMerge(mergeId, sourceId, targetId) {
  const now = new Date().toISOString();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: { TableName: TABLE, Key: { featureId: sourceId },
          UpdateExpression: 'SET mergedInto = :t, mergeId = :m, previousStatus = #s, mergedAt = :now, updatedAt = :now REMOVE boardStatus, mergeLock',
          ConditionExpression: 'mergeLock = :m', ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':t': targetId, ':m': mergeId, ':now': now } } },
        { Update: { TableName: TABLE, Key: { featureId: targetId },
          UpdateExpression: 'ADD mergedChildCount :one REMOVE mergeLock', ConditionExpression: 'mergeLock = :m',
          ExpressionAttributeValues: { ':one': 1, ':m': mergeId } } }
      ]
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) {
      const source = await get(sourceId);
      return Boolean(source && source.mergeId === mergeId && source.mergedInto === targetId); // already done
    }
    throw e;
  }
}

async function releaseLock(featureId, mergeId) {
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE, Key: { featureId }, UpdateExpression: 'REMOVE mergeLock',
      ConditionExpression: 'mergeLock = :m', ExpressionAttributeValues: { ':m': mergeId }
    }));
  } catch (e) {
    if (!isConditionFailure(e)) throw e;
  }
}

async function undoMerge(mergeId, sourceId, targetId) {
  const now = new Date().toISOString();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [
        { Update: { TableName: TABLE, Key: { featureId: sourceId },
          UpdateExpression: 'SET boardStatus = previousStatus, lastUndoneMergeId = :m, updatedAt = :now REMOVE mergedInto, mergeId, previousStatus, mergedAt',
          ConditionExpression: 'mergeId = :m AND mergedInto = :t',
          ExpressionAttributeValues: { ':m': mergeId, ':t': targetId, ':now': now } } },
        { Update: { TableName: TABLE, Key: { featureId: targetId },
          UpdateExpression: 'ADD mergedChildCount :minusOne', ConditionExpression: 'mergedChildCount > :zero',
          ExpressionAttributeValues: { ':minusOne': -1, ':zero': 0 } } }
      ]
    }));
    return true;
  } catch (e) {
    if (isConditionFailure(e)) {
      const source = await get(sourceId);
      return Boolean(source && !source.mergedInto && source.lastUndoneMergeId === mergeId); // already undone
    }
    throw e;
  }
}

module.exports = {
  create, get, getMany, listByStatus, listByAuthor, updateOwn, deleteOwn, changeStatus, setCounts,
  listCandidates, lockForMerge, completeMerge, releaseLock, undoMerge
};
