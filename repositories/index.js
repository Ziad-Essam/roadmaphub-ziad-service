// Chooses the database adapter (STORAGE_DRIVER). Business logic only uses these functions.
const { storage } = require('../shared');

module.exports = storage.chooseDriver('roadmap-service', {
  dynamodb: () => require('./dynamodb')
});
