// DynamoDB applies its filter after reading a page. One matching card from the
// first read must leave room for only one more when the caller asked for two.
const test = require('node:test');
const assert = require('node:assert/strict');
const { dynamo } = require('../../shared');
const features = require('../repositories/dynamodb/featureRepository');

test('a filtered page preserves the first unread card for the next cursor', async (t) => {
  const rows = ['skip', 'A', 'B', 'C'];
  t.mock.method(dynamo.db, 'send', async (command) => {
    const input = command.input;
    const start = input.ExclusiveStartKey?.offset || 0;
    const end = Math.min(start + input.Limit, rows.length);
    return {
      Items: rows.slice(start, end).filter((title) => title !== 'skip'),
      LastEvaluatedKey: end < rows.length ? { offset: end } : undefined
    };
  });
  const options = { status: 'planned', categoryId: 'mobile', limit: 2 };
  const first = await features.listByStatus(options);
  const second = await features.listByStatus({ ...options, cursor: first.next });
  assert.deepEqual(first.items, ['A', 'B']);
  assert.deepEqual(second.items, ['C']);
});
