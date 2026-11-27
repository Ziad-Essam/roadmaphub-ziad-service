// This service's client for the other services (real HTTP calls with service tokens).
const { internalClient } = require('../../shared');

module.exports = internalClient.createInternalClient('roadmap');
