const { query } = require('../config/db');

async function createUser({ username, email, passwordHash, displayName }) {
  const { rows } = await query(
    `INSERT INTO users (username, email, password_hash, display_name)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, email, display_name, avatar_url, public_key, created_at`,
    [username, email, passwordHash, displayName]
  );
  return rows[0];
}

async function findByEmail(email) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function findByUsername(username) {
  const { rows } = await query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await query(
    `SELECT id, username, email, display_name, avatar_url, public_key,
            is_online, last_seen_at, created_at
     FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function findByIds(ids) {
  if (ids.length === 0) return [];
  const { rows } = await query(
    `SELECT id, username, display_name, avatar_url, public_key, is_online, last_seen_at
     FROM users WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  return rows;
}

async function searchUsers(term, excludeUserId, limit = 20) {
  const { rows } = await query(
    `SELECT id, username, display_name, avatar_url, is_online, public_key
     FROM users
     WHERE (username ILIKE $1 OR display_name ILIKE $1)
       AND id != $2
     ORDER BY username ASC
     LIMIT $3`,
    [`%${term}%`, excludeUserId, limit]
  );
  return rows;
}

async function setPublicKey(userId, publicKey) {
  const { rows } = await query(
    `UPDATE users SET public_key = $1 WHERE id = $2
     RETURNING id, username, public_key`,
    [publicKey, userId]
  );
  return rows[0] || null;
}

async function setOnlineStatus(userId, isOnline) {
  const { rows } = await query(
    `UPDATE users
     SET is_online = $1, last_seen_at = NOW()
     WHERE id = $2
     RETURNING id, username, is_online, last_seen_at`,
    [isOnline, userId]
  );
  return rows[0] || null;
}

module.exports = {
  createUser,
  findByEmail,
  findByUsername,
  findById,
  findByIds,
  searchUsers,
  setPublicKey,
  setOnlineStatus,
};
