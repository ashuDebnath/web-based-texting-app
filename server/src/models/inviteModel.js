const crypto = require('crypto');
const { query } = require('../config/db');

function generateToken() {
  return crypto.randomBytes(24).toString('base64url'); // URL-safe, ~32 chars
}

async function createInviteLink({ groupId, createdBy, maxUses = null, expiresAt = null }) {
  const token = generateToken();
  const { rows } = await query(
    `INSERT INTO invite_links (group_id, token, created_by, max_uses, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [groupId, token, createdBy, maxUses, expiresAt]
  );
  return rows[0];
}

async function findByToken(token) {
  const { rows } = await query('SELECT * FROM invite_links WHERE token = $1', [token]);
  return rows[0] || null;
}

async function incrementUse(id) {
  const { rows } = await query(
    `UPDATE invite_links SET uses_count = uses_count + 1 WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0];
}

async function revoke(id, requestingUserId) {
  const { rows } = await query(
    `UPDATE invite_links SET revoked = TRUE
     WHERE id = $1 AND created_by = $2
     RETURNING *`,
    [id, requestingUserId]
  );
  return rows[0] || null;
}

async function listForGroup(groupId) {
  const { rows } = await query(
    `SELECT * FROM invite_links WHERE group_id = $1 ORDER BY created_at DESC`,
    [groupId]
  );
  return rows;
}

function isInviteValid(invite) {
  if (!invite || invite.revoked) return false;
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) return false;
  if (invite.max_uses !== null && invite.uses_count >= invite.max_uses) return false;
  return true;
}

module.exports = {
  createInviteLink,
  findByToken,
  incrementUse,
  revoke,
  listForGroup,
  isInviteValid,
};
