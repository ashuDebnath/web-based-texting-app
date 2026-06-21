const { query, getClient } = require('../config/db');

/**
 * Creates a message and, in the same transaction, inserts a delivery-queue
 * row for every group member except the sender (offline message queueing).
 */
async function createMessage({
  groupId,
  senderId,
  ciphertext,
  iv,
  authTag = null,
  messageType = 'text',
  parentMessageId = null,
  threadRootId = null,
  clientSearchToken = null,
}) {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    const msgResult = await client.query(
      `INSERT INTO messages
        (group_id, sender_id, ciphertext, iv, auth_tag, message_type,
         parent_message_id, thread_root_id, client_search_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        groupId,
        senderId,
        ciphertext,
        iv,
        authTag,
        messageType,
        parentMessageId,
        threadRootId,
        clientSearchToken,
      ]
    );
    const message = msgResult.rows[0];

    // If this is a thread reply, bump the parent/root reply_count.
    if (threadRootId) {
      await client.query(
        `UPDATE messages SET reply_count = reply_count + 1 WHERE id = $1`,
        [threadRootId]
      );
    }

    // Fan out to delivery queue for offline recipients.
    const membersResult = await client.query(
      `SELECT user_id FROM group_members WHERE group_id = $1 AND user_id != $2`,
      [groupId, senderId]
    );

    for (const row of membersResult.rows) {
      await client.query(
        `INSERT INTO message_delivery_queue (message_id, recipient_id, delivered)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (message_id, recipient_id) DO NOTHING`,
        [message.id, row.user_id]
      );
    }

    await client.query('COMMIT');
    return message;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getMessageById(id) {
  const { rows } = await query('SELECT * FROM messages WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Paginated message history for a group (newest-first input, returned oldest-first
 * for chat rendering). Uses keyset pagination via `before` (a message id) to remain
 * efficient at scale, instead of OFFSET.
 */
async function getGroupMessages(groupId, { before = null, limit = 50 } = {}) {
  let rows;
  if (before) {
    const beforeMsg = await getMessageById(before);
    if (!beforeMsg) {
      const result = await query(
        `SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.group_id = $1 AND m.deleted = FALSE AND m.parent_message_id IS NULL
         ORDER BY m.created_at DESC
         LIMIT $2`,
        [groupId, limit]
      );
      rows = result.rows;
    } else {
      const result = await query(
        `SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name
         FROM messages m
         LEFT JOIN users u ON u.id = m.sender_id
         WHERE m.group_id = $1 AND m.deleted = FALSE AND m.parent_message_id IS NULL
           AND m.created_at < $2
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [groupId, beforeMsg.created_at, limit]
      );
      rows = result.rows;
    }
  } else {
    const result = await query(
      `SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name
       FROM messages m
       LEFT JOIN users u ON u.id = m.sender_id
       WHERE m.group_id = $1 AND m.deleted = FALSE AND m.parent_message_id IS NULL
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [groupId, limit]
    );
    rows = result.rows;
  }
  return rows.reverse(); // oldest first for rendering
}

/**
 * Fetch a thread: the root message plus all replies, oldest first.
 */
async function getThreadMessages(threadRootId) {
  const { rows } = await query(
    `SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name
     FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE (m.id = $1 OR m.thread_root_id = $1) AND m.deleted = FALSE
     ORDER BY m.created_at ASC`,
    [threadRootId]
  );
  return rows;
}

/**
 * Server-side search. Because message bodies are end-to-end encrypted,
 * the server cannot search ciphertext content. It instead searches:
 *   1) the optional client_search_token (a client-derived searchable token, e.g.
 *      for non-sensitive deployments or metadata search), and
 *   2) sender username / display name and message_type.
 * Full content search across decrypted plaintext happens client-side
 * (see client/src/utils/search.js) over the locally cached, already-decrypted
 * messages. This endpoint is primarily useful for searching file names,
 * senders, and any group the search-token feature is enabled for.
 */
async function searchMessages(groupId, term, limit = 50) {
  const { rows } = await query(
    `SELECT m.*, u.username AS sender_username, u.display_name AS sender_display_name
     FROM messages m
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE m.group_id = $1 AND m.deleted = FALSE
       AND (
         m.client_search_token ILIKE $2
         OR u.username ILIKE $2
         OR u.display_name ILIKE $2
       )
     ORDER BY m.created_at DESC
     LIMIT $3`,
    [groupId, `%${term}%`, limit]
  );
  return rows;
}

async function markDelivered(messageIds, recipientId) {
  if (messageIds.length === 0) return;
  await query(
    `UPDATE message_delivery_queue
     SET delivered = TRUE, delivered_at = NOW()
     WHERE recipient_id = $1 AND message_id = ANY($2::uuid[])`,
    [recipientId, messageIds]
  );
}

/**
 * Returns all undelivered (queued) messages for a user, across all their
 * groups, oldest first. Called on reconnect to flush the offline queue.
 */
async function getPendingMessages(recipientId) {
  const { rows } = await query(
    `SELECT m.*, q.id AS queue_id, u.username AS sender_username,
            u.display_name AS sender_display_name
     FROM message_delivery_queue q
     JOIN messages m ON m.id = q.message_id
     LEFT JOIN users u ON u.id = m.sender_id
     WHERE q.recipient_id = $1 AND q.delivered = FALSE AND m.deleted = FALSE
     ORDER BY m.created_at ASC`,
    [recipientId]
  );
  return rows;
}

async function markEdited(messageId, ciphertext, iv, authTag) {
  const { rows } = await query(
    `UPDATE messages SET ciphertext = $1, iv = $2, auth_tag = $3, edited = TRUE
     WHERE id = $4 RETURNING *`,
    [ciphertext, iv, authTag, messageId]
  );
  return rows[0] || null;
}

async function softDelete(messageId) {
  const { rows } = await query(
    `UPDATE messages SET deleted = TRUE, ciphertext = '', iv = '' WHERE id = $1 RETURNING *`,
    [messageId]
  );
  return rows[0] || null;
}

async function addAttachment({ messageId, fileNameCipher, fileNameIv, storagePath, mimeType, sizeBytes, iv }) {
  const { rows } = await query(
    `INSERT INTO attachments (message_id, file_name_cipher, file_name_iv, storage_path, mime_type, size_bytes, iv)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [messageId, fileNameCipher, fileNameIv, storagePath, mimeType, sizeBytes, iv]
  );
  return rows[0];
}

async function getAttachmentsForMessage(messageId) {
  const { rows } = await query('SELECT * FROM attachments WHERE message_id = $1', [messageId]);
  return rows;
}

async function getAttachmentById(id) {
  const { rows } = await query('SELECT * FROM attachments WHERE id = $1', [id]);
  return rows[0] || null;
}

/**
 * Given a list of message rows, fetches attachment metadata for any
 * 'file' type messages and attaches it as `.attachment` on each row.
 * Avoids N+1 queries by batching with ANY($1::uuid[]).
 */
async function attachAttachmentsToMessages(messages) {
  const fileMessageIds = messages.filter((m) => m.message_type === 'file').map((m) => m.id);
  if (fileMessageIds.length === 0) return messages;

  const { rows: attachments } = await query(
    `SELECT * FROM attachments WHERE message_id = ANY($1::uuid[])`,
    [fileMessageIds]
  );
  const byMessageId = new Map(attachments.map((a) => [a.message_id, a]));

  return messages.map((m) =>
    byMessageId.has(m.id) ? { ...m, attachment: byMessageId.get(m.id) } : m
  );
}

module.exports = {
  createMessage,
  getMessageById,
  getGroupMessages,
  getThreadMessages,
  searchMessages,
  markDelivered,
  getPendingMessages,
  markEdited,
  softDelete,
  addAttachment,
  getAttachmentsForMessage,
  getAttachmentById,
  attachAttachmentsToMessages,
};
