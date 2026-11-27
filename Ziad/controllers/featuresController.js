
const { categories: categoryRepository } = require('../repositories');

async function categories(req, res) {
  const categories = await categoryRepository.list();
  res.status(200).json({ categories });
}

module.exports = { categories };
