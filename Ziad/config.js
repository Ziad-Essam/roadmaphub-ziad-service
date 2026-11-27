// Settings of the Roadmap Service.
module.exports = {
  tables: {
    features: process.env.FEATURES_TABLE || 'roadhub-features',
    categories: process.env.CATEGORIES_TABLE || 'roadhub-categories'
  },
  countsQueueName: process.env.COUNTS_QUEUE_NAME || 'roadhub-roadmap-counts-queue'
};
