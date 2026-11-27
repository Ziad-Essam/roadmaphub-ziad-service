// Login checks: verify the RS256 token with the public key, then ask the Administration
// Service whether the account is still active (fresh check on every request).
const { userAuth, remoteStatus } = require('../../shared');
const services = require('../clients/services');

module.exports = userAuth.createUserAuth({ getStatus: remoteStatus.remoteStatusFetcher(services) });
