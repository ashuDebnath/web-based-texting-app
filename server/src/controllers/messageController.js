const messageModel = require('../models/messageModel');
const groupModel = require('../models/groupModel');
const receiptModel = require('../models/receiptModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

async function assertMember(groupId, userId) {
  const member = await groupModel.isMember(groupId, userId);
  if (!member) throw new ApiError(403, 'You are not a member of this group');
}

const getHistory = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const { before, limit } = req.query;
  await assertMember(groupId, req.user.id);

  const messages = await messageModel.getGroupMessages(groupId, {
    before: before || null,
    limit: limit ? Math.min(parseInt(limit, 10), 100) : 50,
  });
  const withAttachments = await messageModel.attachAttachmentsToMessages(messages);

  const messageIds = messages.map((m) => m.id);
  const receipts = await receiptModel.getReceiptsForMessages(messageIds);

  res.json({ messages: withAttachments, receipts });
});

const getThread = asyncHandler(async (req, res) => {
  const { groupId, messageId } = req.params;
  await assertMember(groupId, req.user.id);
  const messages = await messageModel.getThreadMessages(messageId);
  const withAttachments = await messageModel.attachAttachmentsToMessages(messages);
  res.json({ messages: withAttachments });
});

const search = asyncHandler(async (req, res) => {
  const { groupId } = req.params;
  const term = (req.query.q || '').trim();
  await assertMember(groupId, req.user.id);
  if (term.length < 1) return res.json({ messages: [] });

  const messages = await messageModel.searchMessages(groupId, term);
  res.json({ messages });
});

const editMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const { ciphertext, iv, authTag } = req.body || {};
  if (!ciphertext || !iv) throw new ApiError(400, 'ciphertext and iv are required');

  const existing = await messageModel.getMessageById(messageId);
  if (!existing) throw new ApiError(404, 'Message not found');
  if (existing.sender_id !== req.user.id) {
    throw new ApiError(403, 'You can only edit your own messages');
  }

  const updated = await messageModel.markEdited(messageId, ciphertext, iv, authTag || null);
  res.json({ message: updated });
});

const deleteMessage = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const existing = await messageModel.getMessageById(messageId);
  if (!existing) throw new ApiError(404, 'Message not found');
  if (existing.sender_id !== req.user.id) {
    throw new ApiError(403, 'You can only delete your own messages');
  }
  const deleted = await messageModel.softDelete(messageId);
  res.json({ message: deleted });
});

const markRead = asyncHandler(async (req, res) => {
  const { messageId } = req.params;
  const message = await messageModel.getMessageById(messageId);
  if (!message) throw new ApiError(404, 'Message not found');
  await assertMember(message.group_id, req.user.id);

  const receipt = await receiptModel.markRead(messageId, req.user.id);
  res.json({ receipt });
});

module.exports = {
  getHistory,
  getThread,
  search,
  editMessage,
  deleteMessage,
  markRead,
};
