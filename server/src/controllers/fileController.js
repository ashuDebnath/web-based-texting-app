const path = require('path');
const fs = require('fs');
const messageModel = require('../models/messageModel');
const groupModel = require('../models/groupModel');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { uploadDirAbs } = require('../config/multer');
const { presence } = require('../sockets/socketHandlers');

/**
 * Uploads an already client-side-encrypted file blob, creates a 'file'
 * message that references it, and fans the message out to the offline
 * delivery queue (same as text messages) so it's not missed by offline users.
 *
 * Expected multipart fields:
 *   file            - the encrypted binary blob
 *   groupId         - target group
 *   iv              - base64 IV used for the file's AES-GCM encryption
 *   fileNameCipher  - the original filename, itself encrypted (so the
 *                     server never learns the plaintext filename either)
 *   mimeType        - MIME type (may also be left generic client-side)
 *   ciphertext/ivMsg - the encrypted message envelope text (e.g. a caption),
 *                      same shape as a normal text message
 */
const uploadFile = asyncHandler(async (req, res) => {
  if (!req.file) throw new ApiError(400, 'file is required');

  const {
    groupId,
    iv,
    fileNameCipher,
    fileNameIv,
    mimeType,
    ciphertext,
    ivMsg,
    parentMessageId,
    threadRootId,
  } = req.body || {};

  if (!groupId || !iv || !fileNameCipher || !fileNameIv) {
    // Clean up the orphaned upload before failing.
    fs.unlink(req.file.path, () => {});
    throw new ApiError(400, 'groupId, iv, fileNameCipher, and fileNameIv are required');
  }

  const isMember = await groupModel.isMember(groupId, req.user.id);
  if (!isMember) {
    fs.unlink(req.file.path, () => {});
    throw new ApiError(403, 'You are not a member of this group');
  }

  const message = await messageModel.createMessage({
    groupId,
    senderId: req.user.id,
    ciphertext: ciphertext || '',
    iv: ivMsg || iv,
    messageType: 'file',
    parentMessageId: parentMessageId || null,
    threadRootId: threadRootId || null,
  });

  const attachment = await messageModel.addAttachment({
    messageId: message.id,
    fileNameCipher,
    fileNameIv,
    storagePath: path.basename(req.file.path),
    mimeType: mimeType || 'application/octet-stream',
    sizeBytes: req.file.size,
    iv,
  });

  const io = req.app.get('io');
  const enrichedMessage = { ...message, attachment, sender_username: req.user.username };
  if (io) {
    io.to(`group:${groupId}`).emit('message:new', enrichedMessage);

    const members = await groupModel.getGroupMembers(groupId);
    for (const m of members) {
      if (m.user_id !== req.user.id && presence.isOnline(m.user_id)) {
        await messageModel.markDelivered([message.id], m.user_id);
        io.to(`user:${m.user_id}`).emit('message:notify', { groupId, messageId: message.id });
      }
    }
  }

  res.status(201).json({ message: enrichedMessage, attachment });
});

/**
 * Streams the raw encrypted bytes back to an authorized group member.
 * Decryption happens entirely client-side.
 */
const downloadFile = asyncHandler(async (req, res) => {
  const { attachmentId } = req.params;
  const attachment = await messageModel.getAttachmentById(attachmentId);
  if (!attachment) throw new ApiError(404, 'Attachment not found');

  const message = await messageModel.getMessageById(attachment.message_id);
  if (!message) throw new ApiError(404, 'Associated message not found');

  const isMember = await groupModel.isMember(message.group_id, req.user.id);
  if (!isMember) throw new ApiError(403, 'You are not a member of this group');

  const filePath = path.join(uploadDirAbs, attachment.storage_path);
  if (!fs.existsSync(filePath)) throw new ApiError(404, 'File no longer available on disk');

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('X-File-IV', attachment.iv);
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      console.error('sendFile error:', err.message);
    }
  });
});

module.exports = { uploadFile, downloadFile };
