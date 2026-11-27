// Synthetic test identities in the local emulator.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getOrCreateSecret } = require('./aws');

async function loadKeys() {
  // All fixtures are in a test-only namespace. Never read the team's private key.
  const pair = await getOrCreateSecret('roadhub-test/signing-fixture', () => crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  }));
  await getOrCreateSecret('roadhub-test/jwt-public', () => ({ PUBLIC_KEY: pair.publicKey }));
  const privateKey = pair.privateKey;
  const internal = await getOrCreateSecret('roadhub-test/internal', () => ({ INTERNAL_SIGNING_KEY: crypto.randomBytes(48).toString('hex') }));
  return { privateKey, internalKey: internal.INTERNAL_SIGNING_KEY };
}

// A login token exactly like the one the Administration Service issues (RS256, 1 hour).
function userToken(keys, { id, name = 'Test User', tv = 0 }) {
  return jwt.sign({ typ: 'user', name, tv }, keys.privateKey, {
    algorithm: 'RS256', issuer: 'roadhub-admin', audience: 'roadhub-api', subject: id, expiresIn: 3600
  });
}

// A service-to-service token exactly like shared/internal-auth.js makes (HS256, 60 s).
function serviceToken(keys, { from, to, scope }) {
  return jwt.sign({ typ: 'service', scope: [].concat(scope) }, keys.internalKey, {
    algorithm: 'HS256', issuer: from, audience: to, expiresIn: 60, jwtid: crypto.randomUUID()
  });
}

module.exports = { loadKeys, userToken, serviceToken };
