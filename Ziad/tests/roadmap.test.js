// Roadmap Service (S1) tested ON ITS OWN: the real service process with its real DynamoDB tables (Floci),
// and a FAKE Administration Service that answers "is this account still active?".
// Run: npm test   (needs Floci on localhost:4566 and "npm run setup:tables" once)
const test = require('node:test');
const assert = require('node:assert');
const { randomUUID } = require('crypto');
const jwt = require('jsonwebtoken');
const { requireTables } = require('./helpers/aws');
const { loadKeys, userToken, serviceToken } = require('./helpers/keys');
const { startFake } = require('./helpers/fake-service');
const { startService } = require('./helpers/service');
const { api } = require('./helpers/api');

const STATUSES = ['under_review', 'planned', 'in_progress', 'shipped'];
const accounts = new Map();   // what the fake admin service says about each account
const BROKEN = randomUUID();  // an account id for which the fake admin service fails (HTTP 500)
let keys; let admin; let svc; let call;
const u = {};

function person(name, role = 'user') {
  const id = randomUUID();
  accounts.set(id, { userId: id, role, accountStatus: 'active', tokenVersion: 0 });
  return { id, name, token: userToken(keys, { id, name }) };
}
const submit = (who, title, extra = {}) => call('POST', '/api/features', {
  token: who.token, body: { title, description: 'A detailed description of the request.', categoryId: 'ui-ux', ...extra }
});
// An internal call as another service would make it (service token with a scope).
const internal = (method, path, { scope = 'features:read', from = 'admin', body } = {}) =>
  call(method, path, { body, headers: { 'X-Service-Token': serviceToken(keys, { from, to: 'roadmap', scope }) } });

test.before(async () => {
  require('node:child_process').execFileSync('bash', ['infra/scripts/create-tables.sh'], { env: process.env });
  await requireTables([process.env.FEATURES_TABLE, process.env.CATEGORIES_TABLE]);
  keys = await loadKeys();
  admin = await startFake('admin', keys.internalKey, [{
    method: 'GET',
    path: /^\/internal\/identity\/users\/([^/]+)\/status$/,
    reply: ({ params: [id] }) => {
      if (id === BROKEN) return { status: 500, body: { error: { code: 'BOOM', message: 'admin service is broken' } } };
      const account = accounts.get(id);
      return account ? { body: account } : { status: 404, body: { error: { code: 'USER_NOT_FOUND', message: 'Account not found.' } } };
    }
  }]);
  svc = await startService({
    port: 4510,
    env: { ADMIN_URL: admin.url, ENGAGEMENT_URL: 'http://127.0.0.1:9', TURNSTILE_ENABLED: 'false', RATE_LIMITS: 'off', EVENTS: 'off' }
  });
  call = api(svc.url);
  u.alice = person('Alice');
  u.bob = person('Bob');
  u.admin = person('Product Admin', 'admin');
});
test.after(async () => {
  if (svc) await svc.stop();
  if (admin) await admin.stop();
});

test('runs as its own process and answers /health', async () => {
  const r = await call('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.service, 'roadmap');
});

test('visitors read the board (exactly 4 columns) and the categories', async () => {
  const board = await call('GET', '/api/roadmap');
  assert.equal(board.status, 200);
  assert.deepEqual(Object.keys(board.data.columns).sort(), [...STATUSES].sort());
  const cats = await call('GET', '/api/categories');
  assert.equal(cats.status, 200);
  assert.ok(cats.data.categories.some((c) => c.categoryId === 'ui-ux'), 'categories are seeded by create-tables.sh');
  assert.equal((await call('GET', '/api/features?status=declined')).status, 400, 'no fifth status');
});

test('submit: login required, users only, no extra fields, known category only', async () => {
  admin.clear();
  assert.equal((await submit({}, 'Dark mode for the dashboard')).status, 401);
  assert.equal((await submit(u.admin, 'Dark mode for the dashboard')).status, 403, 'admins do not submit requests');
  assert.equal((await submit(u.alice, 'Dark mode for the dashboard', { status: 'shipped' })).status, 400, 'mass assignment blocked');
  assert.equal((await submit(u.alice, 'Dark mode for the dashboard', { categoryId: 'not-a-category' })).status, 400);
  assert.equal((await submit(u.alice, 'abc')).status, 400, 'title too short');
  const ok = await submit(u.alice, 'Dark mode for the dashboard');
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.feature.status, 'under_review');
  assert.equal(ok.data.feature.authorId, u.alice.id);
  u.alice.featureId = ok.data.feature.featureId;
  // The account check went to the Administration Service over HTTP with the right token.
  const check = admin.callsTo(/\/status$/).find((c) => c.path.includes(u.alice.id));
  assert.ok(check, 'roadmap asked the admin service about Alice');
  assert.equal(check.token.iss, 'roadmap');
  assert.deepEqual(check.token.scope, ['identity:read']);
  assert.ok(check.requestId, 'the request id is forwarded');
});

test('only the owner edits, and only while Under Review', async () => {
  const id = u.alice.featureId;
  const bob = await call('PATCH', `/api/features/${id}`, { token: u.bob.token, body: { title: 'Bob changes it' } });
  assert.equal(bob.status, 403);
  assert.equal(bob.data.error.code, 'NOT_OWNER');
  assert.equal((await call('PATCH', `/api/features/${id}`, { token: u.alice.token, body: { title: 'Dark mode for every page' } })).status, 200);
  assert.equal((await call('PATCH', `/api/features/${id}/status`, { token: u.admin.token, body: { status: 'planned' } })).status, 200);
  const late = await call('PATCH', `/api/features/${id}`, { token: u.alice.token, body: { title: 'Too late to edit' } });
  assert.equal(late.status, 409);
  assert.equal(late.data.error.code, 'NOT_EDITABLE');
  assert.equal((await call('DELETE', `/api/features/${id}`, { token: u.alice.token })).status, 409);
});

test('status workflow: admin only, and only the allowed moves', async () => {
  const id = u.alice.featureId; // now Planned
  assert.equal((await call('PATCH', `/api/features/${id}/status`, { token: u.alice.token, body: { status: 'in_progress' } })).status, 403);
  assert.equal((await call('PATCH', `/api/features/${id}/status`, { token: u.admin.token, body: { status: 'declined' } })).status, 400);
  const jump = await call('PATCH', `/api/features/${id}/status`, { token: u.admin.token, body: { status: 'shipped' } });
  assert.equal(jump.status, 409);
  assert.equal(jump.data.error.code, 'INVALID_TRANSITION');
  for (const status of ['in_progress', 'shipped']) {
    const r = await call('PATCH', `/api/features/${id}/status`, { token: u.admin.token, body: { status } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.feature.status, status);
  }
  assert.equal((await call('PATCH', `/api/features/${id}/status`, { token: u.admin.token, body: { status: 'planned' } })).status, 409, 'Shipped is final');
});

test('owner deletes their own request while Under Review', async () => {
  const r = await submit(u.bob, 'Export the board to CSV');
  const id = r.data.feature.featureId;
  assert.equal((await call('DELETE', `/api/features/${id}`, { token: u.alice.token })).status, 403);
  assert.equal((await call('DELETE', `/api/features/${id}`, { token: u.bob.token })).status, 204);
  assert.equal((await call('GET', `/api/features/${id}`)).status, 404);
});

test('account state is checked on every change: suspended reads only, banned and old tokens refused', async () => {
  const erin = person('Erin');
  const account = accounts.get(erin.id);
  account.accountStatus = 'suspended';
  account.suspendedUntil = new Date(Date.now() + 86400000).toISOString();
  const write = await submit(erin, 'Keyboard shortcuts everywhere');
  assert.equal(write.status, 403);
  assert.equal(write.data.error.code, 'ACCOUNT_SUSPENDED');
  assert.equal((await call('GET', '/api/me/features', { token: erin.token })).status, 200, 'a suspended user can still read');
  account.accountStatus = 'banned';
  const banned = await call('GET', '/api/me/features', { token: erin.token });
  assert.equal(banned.status, 403);
  assert.equal(banned.data.error.code, 'ACCOUNT_BANNED');
  account.accountStatus = 'active';
  account.tokenVersion = 1; // logout or ban increases the version: old tokens stop working
  assert.equal((await call('GET', '/api/me/features', { token: erin.token })).status, 401);
  const forged = jwt.sign({ typ: 'user', name: 'Mallory', tv: 0 }, 'a-made-up-key-a-made-up-key-123456', { algorithm: 'HS256', subject: u.alice.id, issuer: 'roadhub-admin', audience: 'roadhub-api' });
  assert.equal((await call('GET', '/api/me/features', { token: forged })).status, 401, 'a token not signed by the admin service');
});

test('fails closed: if the Administration Service cannot answer, changes are refused (503)', async () => {
  const ghost = { token: userToken(keys, { id: BROKEN, name: 'Ghost' }) };
  const r = await submit(ghost, 'Should never be stored');
  assert.equal(r.status, 503);
  // Reading the public board does not need the admin service at all.
  assert.equal((await call('GET', '/api/roadmap')).status, 200);
});

test('internal routes need a valid service token with the right scope', async () => {
  assert.equal((await call('GET', '/internal/features/_ping')).status, 401);
  const forged = jwt.sign({ typ: 'service', scope: ['features:read'] }, 'not-the-real-key-not-the-real-key!!', { algorithm: 'HS256', issuer: 'engagement', audience: 'roadmap', expiresIn: 60 });
  assert.equal((await call('GET', '/internal/features/_ping', { headers: { 'X-Service-Token': forged } })).status, 401);
  assert.equal((await call('GET', '/internal/features/_ping', { headers: { 'X-Service-Token': u.alice.token } })).status, 401, 'a user login is not a service token');
  const wrongAudience = serviceToken(keys, { from: 'engagement', to: 'admin', scope: 'features:read' });
  assert.equal((await call('GET', '/internal/features/_ping', { headers: { 'X-Service-Token': wrongAudience } })).status, 401);
  assert.equal((await internal('GET', '/internal/features/_ping', { scope: 'identity:read' })).status, 403);
  const ok = await internal('GET', '/internal/features/_ping', { from: 'engagement' });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.caller, 'engagement');
});

test('internal resolve and resolve-batch answer the other services', async () => {
  const id = u.alice.featureId;
  const r = await internal('GET', `/internal/features/${id}/resolve`, { from: 'engagement' });
  assert.equal(r.status, 200);
  assert.equal(r.data.canonicalId, id);
  assert.equal(r.data.merged, false);
  assert.equal((await internal('GET', `/internal/features/${randomUUID()}/resolve`)).status, 404);
  const batch = await internal('POST', '/internal/features/resolve-batch', { from: 'engagement', body: { ids: [id, randomUUID()] } });
  assert.equal(batch.status, 200);
  assert.deepEqual(batch.data.items.map((i) => i.featureId), [id]);
});

test('merge steps called by the admin service: prepare, complete (307 redirect), undo', async () => {
  const a = (await submit(u.alice, 'Show the roadmap in dark colours')).data.feature.featureId;
  const b = (await submit(u.bob, 'Dark colours for the roadmap page')).data.feature.featureId;
  const mergeId = randomUUID();
  const body = { mergeId, sourceId: b, targetId: a };
  assert.equal((await internal('POST', '/internal/features/merges/prepare', { body })).status, 403, 'features:read is not enough');
  const prep = await internal('POST', '/internal/features/merges/prepare', { scope: 'features:merge', body });
  assert.equal(prep.status, 200, JSON.stringify(prep.data));
  assert.equal(prep.data.source.featureId, b);
  const other = await internal('POST', '/internal/features/merges/prepare', { scope: 'features:merge', body: { ...body, mergeId: randomUUID() } });
  assert.equal(other.status, 409, 'a request that is being merged is locked');
  assert.equal((await internal('POST', '/internal/features/merges/complete', { scope: 'features:merge', body })).status, 200);

  const res = await fetch(`${svc.url}/api/features/${b}`, { redirect: 'manual' });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get('location'), `/api/features/${a}`);
  const board = await call('GET', '/api/roadmap?sort=newest');
  assert.ok(!board.data.columns.under_review.items.some((x) => x.featureId === b), 'the duplicate left the board');
  const resolved = await internal('GET', `/internal/features/${b}/resolve`, { from: 'engagement' });
  assert.deepEqual([resolved.data.canonicalId, resolved.data.merged], [a, true]);

  const undo = await internal('POST', '/internal/features/merges/undo', { scope: 'features:merge', body });
  assert.equal(undo.status, 200, JSON.stringify(undo.data));
  const back = await call('GET', `/api/features/${b}`);
  assert.equal(back.status, 200);
  assert.equal(back.data.feature.status, 'under_review');
});

test('decline requires an admin reason and removes the card from the board while retaining ownership history', async () => {
  const id = (await submit(u.alice, 'Decline this sample request')).data.feature.featureId;
  const path = '/api/features/' + id;
  const declined = await call('PATCH', path + '/status', { token: u.admin.token, body: { status: 'declined', reason: 'Outside product scope' } });
  assert.equal(declined.status, 200);
  assert.equal((await call('GET', path)).data.feature.declineReason, 'Outside product scope');
  const board = (await call('GET','/api/roadmap')).data.columns;
  assert.deepEqual(Object.keys(board), STATUSES);
  assert.ok(!Object.values(board).some(column => column.items.some(f => f.featureId === id)));
  assert.ok((await call('GET','/api/me/features',{token:u.alice.token})).data.items.some(f => f.featureId === id));
  assert.equal((await call('DELETE',path,{token:u.alice.token})).status,409);
});

test('aborting a prepared merge releases both locks and Engagement cannot perform Admin steps', async () => {
  const sourceId = (await submit(u.alice,'Duplicate from the sample')).data.feature.featureId;
  const targetId = (await submit(u.alice,'Canonical from the sample')).data.feature.featureId;
  const body = { sourceId, targetId, mergeId: randomUUID() };
  const options = { scope:'features:merge', body };
  assert.equal((await internal('POST','/internal/features/merges/prepare',{...options,from:'engagement'})).status,403);
  for (const step of ['prepare','abort','abort']) {
    assert.equal((await internal('POST','/internal/features/merges/'+step,options)).status,200);
  }
  for (const id of [sourceId,targetId]) assert.equal((await internal('GET','/internal/features/'+id+'/resolve')).data.locked,false);
});

test('public API headers, origin allowlist, body size and JSON parsing', async () => {
  const publicPath='/api/categories';
  const allowed=await call('GET',publicPath,{headers:{Origin:'http://localhost:8080'}});
  assert.equal(allowed.headers.get('access-control-allow-origin'),'http://localhost:8080');
  assert.equal(allowed.headers.get('x-content-type-options'),'nosniff');
  assert.equal((await call('GET',publicPath,{headers:{Origin:'http://example.org'}})).headers.get('access-control-allow-origin'),null);
  assert.equal((await call('POST','/api/features',{body:{description:'x'.repeat(12000)}})).status,413);
  assert.equal((await fetch(svc.url+'/api/features',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
});

test('submit limiter rejects the sixth write for one user on one replica', async () => {
  const limited=await startService({port:4511,env:{ADMIN_URL:admin.url,TURNSTILE_ENABLED:'false',EVENTS:'off',RATE_LIMITS:'on'}});
  try {
    const post = api(limited.url);
    for(let i=1;i<=6;i++) {
      const r=await post('POST','/api/features',{token:u.bob.token,body:{title:'Limited request '+i,description:'Test the per-user submission limit.',categoryId:'other'}});
      assert.equal(r.status,i===6?429:201);
    }
  } finally { await limited.stop(); }
});
