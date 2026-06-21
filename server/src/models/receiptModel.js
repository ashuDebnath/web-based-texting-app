const { query } = require('../config/db');

async function markRead(messageId, userId) {
  const { rows } = await query(
    `INSERT INTO read_receipts (message_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (message_id, user_id) DO UPDATE SET read_at = NOW()
     RETURNING *`,
    [messageId, userId]
  );
  return rows[0];
}

async function getReceiptsForMessages(messageIds) {
  if (messageIds.length === 0) return [];
  const { rows } = await query(
    `SELECT r.*, u.username, u.display_name
     FROM read_receipts r
     JOIN users u ON u.id = r.user_id
     WHERE r.message_id = ANY($1::uuid[])`,
    [messageIds]
  );
  return rows;
}

async function getReceiptsForGroup(groupId, userId) {
  // Returns the read state of the *other* members for messages sent by userId.
  const { rows } = await query(
    `SELECT r.message_id, r.user_id, r.read_at
     FROM read_receipts r
     JOIN messages m ON m.id = r.message_id
     WHERE m.group_id = $1`,
    [groupId]
  );
  return rows;
}

module.exports = { markRead, getReceiptsForMessages, getReceiptsForGroup };
