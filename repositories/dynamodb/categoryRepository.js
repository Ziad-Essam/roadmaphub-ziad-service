// Fixed category list (table roadhub-categories, seeded by infra/scripts/create-tables.sh).
// It almost never changes, so it is cached for 60 s instead of read on every request.
const { ScanCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { dynamo } = require('../../shared');
const config = require('../../config');

let cached = null;
let cachedAt = 0;

async function list() {
  if (!cached || Date.now() - cachedAt > 60000) {
    const out = await dynamo.db.send(new ScanCommand({ TableName: config.tables.categories }));
    cached = (out.Items || []).sort((a, b) => a.sortOrder - b.sortOrder).map(({ categoryId, name }) => ({ categoryId, name }));
    cachedAt = Date.now();
  }
  return cached;
}

async function get(categoryId) {
  const out = await dynamo.db.send(new GetCommand({ TableName: config.tables.categories, Key: { categoryId } }));
  return out.Item ? { categoryId: out.Item.categoryId, name: out.Item.name } : null;
}

module.exports = { list, get };
