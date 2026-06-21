import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../utils/apiClient';
import { useChat } from '../context/ChatContext';
import { useAuth } from '../context/AuthContext';
import { decryptText } from '../crypto/e2ee';
import { getSocket } from '../utils/socketClient';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';

export default function ThreadPanel({ group, rootMessageId, onClose }) {
  const { user } = useAuth();
  const { unlockGroupKey, markMessageRead } = useChat();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const observedIds = useRef(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const key = await unlockGroupKey(group);
      const { messages: raw } = await api.get(
        `/messages/group/${group.id}/thread/${rootMessageId}`
      );
      const decrypted = await Promise.all(
        raw.map(async (m) => {
          if (m.deleted) return { ...m, plaintext: '[deleted]' };
          if (!key) return { ...m, plaintext: '[unable to decrypt — missing key]' };
          try {
            const plaintext = await decryptText(m.ciphertext, m.iv, key);
            return { ...m, plaintext };
          } catch {
            return { ...m, plaintext: '[unable to decrypt this message]' };
          }
        })
      );
      setMessages(decrypted);
    } finally {
      setLoading(false);
    }
  }, [group, rootMessageId, unlockGroupKey]);

  useEffect(() => {
    observedIds.current = new Set();
    load();
  }, [load]);

  // Live updates: append new replies posted to this thread while the panel is open.
  useEffect(() => {
    const socket = getSocket();

    const onNewMessage = async (message) => {
      if (message.thread_root_id !== rootMessageId) return;
      const key = await unlockGroupKey(group);
      let plaintext = '[unable to decrypt — missing key]';
      if (key && message.ciphertext) {
        try {
          plaintext = await decryptText(message.ciphertext, message.iv, key);
        } catch {
          plaintext = '[unable to decrypt this message]';
        }
      }
      setMessages((prev) => {
        const withoutTemp = message.clientTempId
          ? prev.filter((m) => m.clientTempId !== message.clientTempId)
          : prev;
        if (withoutTemp.some((m) => m.id === message.id)) return prev;
        return [...withoutTemp, { ...message, plaintext }];
      });
    };

    socket.on('message:new', onNewMessage);
    return () => socket.off('message:new', onNewMessage);
  }, [rootMessageId, group, unlockGroupKey]);

  const rootMessage = messages.find((m) => m.id === rootMessageId);
  const replies = messages.filter((m) => m.id !== rootMessageId);

  // Mark visible thread messages from others as read (deduped so we don't
  // re-emit for messages already marked in a prior render).
  useEffect(() => {
    for (const m of messages) {
      if (
        m.sender_id !== user.id &&
        !m.pending &&
        !String(m.id).startsWith('tmp-') &&
        !observedIds.current.has(m.id)
      ) {
        observedIds.current.add(m.id);
        markMessageRead(m.id);
      }
    }
  }, [messages, user.id, markMessageRead]);

  return (
    <aside className="thread-panel">
      <header className="thread-panel-header">
        <h3>Thread</h3>
        <button className="btn-icon" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="thread-panel-body scrollbar-thin">
        {loading && <div className="conversation-loading">Loading thread…</div>}
        {!loading && rootMessage && (
          <>
            <MessageBubble
              message={rootMessage}
              isMine={rootMessage.sender_id === user.id}
              onOpenThread={() => {}}
              group={group}
            />
            <div className="thread-divider">
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </div>
          </>
        )}
        {!loading &&
          replies.map((m) => (
            <MessageBubble key={m.id} message={m} isMine={m.sender_id === user.id} onOpenThread={() => {}} group={group} />
          ))}
      </div>

      <MessageComposer group={group} parentMessageId={rootMessageId} threadRootId={rootMessageId} />
    </aside>
  );
}
