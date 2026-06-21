const { query, getClient } = require('../config/db');

async function createGroup({ name, isDirect, createdBy }) {
  const { rows } = await query(
    `INSERT INTO groups (name, is_direct, created_by)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [name, isDirect, createdBy]
  );
  return rows[0];
}

async function addMember({ groupId, userId, role = 'member', wrappedGroupKey = null }) {
  const { rows } = await query(
    `INSERT INTO group_members (group_id, user_id, role, wrapped_group_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (group_id, user_id) DO NOTHING
     RETURNING *`,
    [groupId, userId, role, wrappedGroupKey]
  );
  return rows[0] || null;
}

/**
 * Atomically creates a group and adds the initial member list.
 * Each member may have a pre-wrapped group key (for E2E key distribution).
 */
async function createGroupWithMembers({ name, isDirect, createdBy, members }) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const groupResult = await client.query(
      `INSERT INTO groups (name, is_direct, created_by) VALUES ($1, $2, $3) RETURNING *`,
      [name, isDirect, createdBy]
    );
    const group = groupResult.rows[0];

    for (const member of members) {
      await client.query(
        `INSERT INTO group_members (group_id, user_id, role, wrapped_group_key)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (group_id, user_id) DO NOTHING`,
        [group.id, member.userId, member.role || 'member', member.wrappedGroupKey || null]
      );
    }

    await client.query('COMMIT');
    return group;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findGroupById(groupId) {
  const { rows } = await query('SELECT * FROM groups WHERE id = $1', [groupId]);
  return rows[0] || null;
}

async function isMember(groupId, userId) {
  const { rows } = await query(
    'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return rows.length > 0;
}

async function getMembership(groupId, userId) {
  const { rows } = await query(
    'SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2',
    [groupId, userId]
  );
  return rows[0] || null;
}

async function getGroupMembers(groupId) {
  const { rows } = await query(
    `SELECT gm.user_id, gm.role, gm.joined_at, gm.wrapped_group_key,
            u.username, u.display_name, u.avatar_url, u.public_key, u.is_online, u.last_seen_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.joined_at ASC`,
    [groupId]
  );
  return rows;
}

async function getUserGroups(userId) {
  const { rows } = await query(
    `SELECT g.*, gm.role, gm.wrapped_group_key, gm.last_read_message_id,
            (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
            (SELECT m.created_at FROM messages m WHERE m.group_id = g.id AND m.deleted = FALSE
              ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id
     WHERE gm.user_id = $1
     ORDER BY last_message_at DESC NULLS LAST, g.created_at DESC`,
    [userId]
  );
  return rows;
}

async function updateLastRead(groupId, userId, messageId) {
  await query(
    `UPDATE group_members SET last_read_message_id = $1
     WHERE group_id = $2 AND user_id = $3`,
    [messageId, groupId, userId]
  );
}

async function removeMember(groupId, userId) {
  await query('DELETE FROM group_members WHERE group_id = $1 AND user_id = $2', [
    groupId,
    userId,
  ]);
}

async function setWrappedGroupKey(groupId, userId, wrappedGroupKey) {
  const { rows } = await query(
    `UPDATE group_members SET wrapped_group_key = $1
     WHERE group_id = $2 AND user_id = $3
     RETURNING *`,
    [wrappedGroupKey, groupId, userId]
  );
  return rows[0] || null;
}

module.exports = {
  createGroup,
  addMember,
  createGroupWithMembers,
  findGroupById,
  isMember,
  getMembership,
  getGroupMembers,
  getUserGroups,
  updateLastRead,
  removeMember,
  setWrappedGroupKey,
};
