import { useState, useRef, useCallback } from 'react';
import { useChat } from '../context/ChatContext';
import { api } from '../utils/apiClient';
import { encryptText, encryptFile } from '../crypto/e2ee';

const TYPING_STOP_DELAY = 2000;

export default function MessageComposer({ group, disabled, parentMessageId = null, threadRootId = null }) {
  const { sendMessage, sendTyping, unlockGroupKey } = useChat();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploading, setUploading] = useState(false);
  const typingTimeoutRef = useRef(null);
  const fileInputRef = useRef(null);

  const handleTextChange = useCallback(
    (e) => {
      setText(e.target.value);
      sendTyping(group.id, true, threadRootId);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        sendTyping(group.id, false, threadRootId);
      }, TYPING_STOP_DELAY);
    },
    [group.id, sendTyping, threadRootId]
  );

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    sendTyping(group.id, false, threadRootId);
    try {
      await sendMessage(group.id, trimmed, { parentMessageId, threadRootId });
      setText('');
    } catch (err) {
      setUploadError(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploading(true);
    setUploadError('');
    try {
      const key = await unlockGroupKey(group);
      if (!key) throw new Error('Encryption key unavailable for this group');

      const arrayBuffer = await file.arrayBuffer();
      const { ciphertextBlob, iv } = await encryptFile(arrayBuffer, key);
      const { ciphertext: fileNameCipher, iv: fileNameIv } = await encryptText(file.name, key);

      const formData = new FormData();
      formData.append('file', ciphertextBlob, 'blob');
      formData.append('groupId', group.id);
      formData.append('iv', iv);
      formData.append('fileNameCipher', fileNameCipher);
      formData.append('fileNameIv', fileNameIv);
      formData.append('mimeType', file.type || 'application/octet-stream');
      if (parentMessageId) formData.append('parentMessageId', parentMessageId);
      if (threadRootId) formData.append('threadRootId', threadRootId);

      await api.postForm('/files/upload', formData);
    } catch (err) {
      setUploadError(err.message || 'File upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit}>
      {uploadError && <div className="composer-error">{uploadError}</div>}
      <div className="composer-row">
        <button
          type="button"
          className="btn-icon"
          title="Attach a file"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || uploading}
        >
          {uploading ? '…' : '📎'}
        </button>
        <input ref={fileInputRef} type="file" hidden onChange={handleFileChange} />
        <textarea
          value={text}
          onChange={handleTextChange}
          placeholder={disabled ? 'Encryption key unavailable — cannot send messages' : 'Message…'}
          rows={1}
          disabled={disabled || sending}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSubmit(e);
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={disabled || sending || !text.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}
