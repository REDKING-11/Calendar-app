const { Pool } = require('pg');

function createDb(config) {
  if (!config.postgresUrl) {
    throw new Error('POSTGRES_URL is required.');
  }

  const pool = new Pool({
    connectionString: config.postgresUrl,
    max: 10,
  });

  return {
    pool,
    async query(text, params) {
      return pool.query(text, params);
    },
    async connect() {
      return pool.connect();
    },
    async close() {
      await pool.end();
    },
  };
}

module.exports = { createDb };
