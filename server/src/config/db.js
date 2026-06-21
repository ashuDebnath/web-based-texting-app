const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // Unexpected errors on idle clients should not crash the whole process.
  console.error('Unexpected PostgreSQL pool error:', err.message);
});

/**
 * Run a single query against the pool.
 * @param {string} text - SQL query text with $1, $2... placeholders.
 * @param {Array} params - query parameters.
 */
function query(text, params) {
  return pool.query(text, params);
}

/**
 * Acquire a dedicated client for multi-statement transactions.
 * Caller MUST release the client when done.
 */
async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = { pool, query, getClient };
