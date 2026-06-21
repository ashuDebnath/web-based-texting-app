const { authenticateSocketToken } = require('../middleware/auth');
const userModel = require('../models/userModel');
const groupModel = require('../models/groupModel');
const messageModel = require('../models/messageModel');
const receiptModel = require('../models/receiptModel');
const PresenceTracker = require('./presenceTracker');
const SocketRateLimiter = require('./rateLimiter');

const presence = new PresenceTracker();
const messageLimiter = new SocketRateLimiter({ capacity: 20, refillPerSecond: 5 });
const typingLimiter = new SocketRateLimiter({ capacity: 10, refillPerSecond: 3 });

function groupRoom(groupId) {
  return `group:${groupId}`;
}

function userRoom(userId) {
  return `user:${userId}`;
}

/**
 * Registers all Socket.IO middleware and event handlers on the given io
 * instance. Called once from server.js.
 */
function registerSocketHandlers(io) {
  // --- Auth middleware: every connecting socket must present a valid JWT ---
  io.use((socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.replace('Bearer ', '');
      const payload = authenticateSocketToken(token);
      socket.userId = payload.sub;
      socket.username = payload.username;
      next();
    } catch (err) {
      next(new Error('Authentication failed: ' + err.message));
    }
  });

  io.on('connection', async (socket) => {
    const { userId } = socket;

    // Defensive: prevent any unhandled 'error' event from crashing the process.
    socket.on('error', (err) => {
      console.error(`Socket error (user ${userId}):`, err?.message || err);
    });

    try {
      await handleConnect(io, socket);
    } catch (err) {
      console.error('Error during socket connect handling:', err);
    }

    // ---------------- JOIN GROUP ROOMS ----------------
    socket.on('group:join', async (groupId, ack) => {
      try {
        const isMember = await groupModel.isMember(groupId, userId);
        if (!isMember) {
          return ack?.({ ok: false, error: 'Not a member of this group' });
        }
        socket.join(groupRoom(groupId));
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
      }
    });

    socket.on('group:leave', (groupId, ack) => {
      socket.leave(groupRoom(groupId));
      ack?.({ ok: true });
    });

    // ---------------- SEND MESSAGE ----------------
    socket.on('message:send', async (payload, ack) => {
      if (!messageLimiter.consume(socket.id)) {
        return ack?.({ ok: false, error: 'Rate limit exceeded. Slow down.' });
      }
      try {
        const {
          groupId,
          ciphertext,
          iv,
          authTag,
          messageType = 'text',
          parentMessageId = null,
          threadRootId = null,
          clientSearchToken = null,
          clientTempId = null,
        } = payload || {};

        if (!groupId || !ciphertext || !iv) {
          return ack?.({ ok: false, error: 'groupId, ciphertext, and iv are required' });
        }

        const isMember = await groupModel.isMember(groupId, userId);
        if (!isMember) {
          return ack?.({ ok: false, error: 'Not a member of this group' });
        }

        const message = await messageModel.createMessage({
          groupId,
          senderId: userId,
          ciphertext,
          iv,
          authTag,
          messageType,
          parentMessageId,
          threadRootId,
          clientSearchToken,
        });

        const enriched = { ...message, sender_username: socket.username, clientTempId };

        // Broadcast to everyone currently in the room (including sender's
        // other tabs) for instant delivery.
        io.to(groupRoom(groupId)).emit('message:new', enriched);

        // Mark delivered for any recipients who are online right now, and
        // nudge their personal room in case they're viewing another
        // conversation (so unread badges update live).
        const members = await groupModel.getGroupMembers(groupId);
        const onlineMemberIds = members
          .map((m) => m.user_id)
          .filter((id) => id !== userId && presence.isOnline(id));

        for (const recipientId of onlineMemberIds) {
          await messageModel.markDelivered([message.id], recipientId);
          io.to(userRoom(recipientId)).emit('message:notify', {
            groupId,
            messageId: message.id,
          });
        }

        ack?.({ ok: true, message: enriched });
      } catch (err) {
        console.error('message:send error:', err);
        ack?.({ ok: false, error: 'Failed to send message' });
      }
    });

    // ---------------- EDIT / DELETE ----------------
    socket.on('message:edit', async (payload, ack) => {
      try {
        const { messageId, ciphertext, iv, authTag } = payload || {};
        const existing = await messageModel.getMessageById(messageId);
        if (!existing) return ack?.({ ok: false, error: 'Message not found' });
        if (existing.sender_id !== userId) {
          return ack?.({ ok: false, error: 'Not your message' });
        }
        const updated = await messageModel.markEdited(messageId, ciphertext, iv, authTag || null);
        io.to(groupRoom(existing.group_id)).emit('message:updated', updated);
        ack?.({ ok: true, message: updated });
      } catch (err) {
        ack?.({ ok: false, error: 'Failed to edit message' });
      }
    });

    socket.on('message:delete', async (payload, ack) => {
      try {
        const { messageId } = payload || {};
        const existing = await messageModel.getMessageById(messageId);
        if (!existing) return ack?.({ ok: false, error: 'Message not found' });
        if (existing.sender_id !== userId) {
          return ack?.({ ok: false, error: 'Not your message' });
        }
        const deleted = await messageModel.softDelete(messageId);
        io.to(groupRoom(existing.group_id)).emit('message:deleted', {
          id: deleted.id,
          group_id: deleted.group_id,
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: 'Failed to delete message' });
      }
    });

    // ---------------- READ RECEIPTS ----------------
    socket.on('message:read', async (payload, ack) => {
      try {
        const { messageId } = payload || {};
        const message = await messageModel.getMessageById(messageId);
        if (!message) return ack?.({ ok: false, error: 'Message not found' });

        const isMember = await groupModel.isMember(message.group_id, userId);
        if (!isMember) return ack?.({ ok: false, error: 'Not a member' });

        const receipt = await receiptModel.markRead(messageId, userId);
        io.to(groupRoom(message.group_id)).emit('message:read', {
          messageId,
          userId,
          username: socket.username,
          readAt: receipt.read_at,
        });
        ack?.({ ok: true });
      } catch (err) {
        ack?.({ ok: false, error: 'Failed to mark read' });
      }
    });

    // ---------------- TYPING INDICATORS ----------------
    socket.on('typing:start', (payload) => {
      if (!typingLimiter.consume(socket.id)) return;
      const { groupId, threadRootId = null } = payload || {};
      if (!groupId) return;
      socket.to(groupRoom(groupId)).emit('typing:start', {
        groupId,
        threadRootId,
        userId,
        username: socket.username,
      });
    });

    socket.on('typing:stop', (payload) => {
      const { groupId, threadRootId = null } = payload || {};
      if (!groupId) return;
      socket.to(groupRoom(groupId)).emit('typing:stop', {
        groupId,
        threadRootId,
        userId,
        username: socket.username,
      });
    });

    // ---------------- DISCONNECT ----------------
    socket.on('disconnect', async () => {
      messageLimiter.removeSocket(socket.id);
      typingLimiter.removeSocket(socket.id);
      try {
        await handleDisconnect(io, socket);
      } catch (err) {
        console.error('Error during socket disconnect handling:', err);
      }
    });
  });
}

async function handleConnect(io, socket) {
  const { userId } = socket;
  socket.join(userRoom(userId));

  const wasOffline = presence.addSocket(userId, socket.id);

  // Auto-join rooms for all groups the user belongs to, so they receive
  // messages immediately without an explicit group:join round-trip.
  const groups = await groupModel.getUserGroups(userId);
  for (const g of groups) {
    socket.join(groupRoom(g.id));
  }

  if (wasOffline) {
    await userModel.setOnlineStatus(userId, true);
    for (const g of groups) {
      socket.to(groupRoom(g.id)).emit('presence:online', { userId });
    }
  }

  // ---- Flush offline message queue ----
  const pending = await messageModel.getPendingMessages(userId);
  if (pending.length > 0) {
    const withAttachments = await messageModel.attachAttachmentsToMessages(pending);
    socket.emit('message:backlog', withAttachments);
    await messageModel.markDelivered(
      pending.map((m) => m.id),
      userId
    );
  }
}

async function handleDisconnect(io, socket) {
  const { userId } = socket;
  const fullyOffline = presence.removeSocket(userId, socket.id);

  if (fullyOffline) {
    const updated = await userModel.setOnlineStatus(userId, false);
    const groups = await groupModel.getUserGroups(userId);
    for (const g of groups) {
      io.to(groupRoom(g.id)).emit('presence:offline', {
        userId,
        lastSeenAt: updated?.last_seen_at,
      });
    }
  }
}

module.exports = { registerSocketHandlers, presence };
