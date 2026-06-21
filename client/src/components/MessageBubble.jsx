import { useState } from 'react';
import { useChat } from '../context/ChatContext';
import FileAttachment from './FileAttachment';

function formatTime(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function MessageBubble({ message, isMine, onOpenThread, group }) {
  const { editMessage, deleteMessage } = useChat();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.plaintext || '');
  const [busy, setBusy] = useState(false);

  const readCount = (message.readBy || []).length;

  async function handleSaveEdit() {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await editMessage(message.group_id, message.id, draft.trim());
      setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this message?')) return;
    await deleteMessage(message.id);
  }

  return (
    <div className={`message-row ${isMine ? 'mine' : 'theirs'}`}>
      {!isMine && <div className="message-sender">{message.sender_display_name || message.sender_username}</div>}

      <div className={`message-bubble ${message.deleted ? 'deleted' : ''} ${message.pending ? 'pending' : ''}`}>
        {message.message_type === 'file' && !message.deleted && (
          <FileAttachment message={message} group={group} />
        )}

        {editing ? (
          <div className="message-edit">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} autoFocus />
            <div className="message-edit-actions">
              <button className="btn-link" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn-link" onClick={handleSaveEdit} disabled={busy}>
                Save
              </button>
            </div>
          </div>
        ) : (
          message.message_type !== 'file' && <div className="message-text">{message.plaintext}</div>
        )}

        <div className="message-meta">
          <span className="message-time">{formatTime(message.created_at)}</span>
          {message.edited && !message.deleted && <span className="message-edited">edited</span>}
          {isMine && readCount > 0 && <span className="message-read-receipt" title="Read">✓✓</span>}
          {message.pending && <span className="message-pending" title="Sending…">⏳</span>}
        </div>

        {!message.deleted && (
          <div className="message-actions">
            <button className="btn-link" onClick={onOpenThread}>
              {message.reply_count > 0 ? `${message.reply_count} replies` : 'Reply in thread'}
            </button>
            {isMine && !editing && message.message_type !== 'file' && (
              <>
                <button className="btn-link" onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="btn-link" onClick={handleDelete}>
                  Delete
                </button>
              </>
            )}
            {isMine && message.message_type === 'file' && (
              <button className="btn-link" onClick={handleDelete}>
                Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
