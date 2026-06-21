import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import MessageBubble from './MessageBubble';
import MessageComposer from './MessageComposer';
import ThreadPanel from './ThreadPanel';
import GroupInfoModal from './GroupInfoModal';
import SearchPanel from './SearchPanel';

export default function ConversationView({ group }) {
  const { user } = useAuth();
  const {
    messagesByGroup,
    typingByGroup,
    loadHistory,
    markMessageRead,
    setActiveGroupId,
    unlockGroupKey,
  } = useChat();

  const [loading, setLoading] = useState(true);
  const [activeThreadRootId, setActiveThreadRootId] = useState(null);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [keyMissing, setKeyMissing] = useState(false);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  const observedIds = useRef(new Set());

  const messages = (messagesByGroup[group.id] || []).filter((m) => !m.parent_message_id);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    observedIds.current = new Set();
    (async () => {
      const key = await unlockGroupKey(group);
      setKeyMissing(!key);
      await loadHistory(group.id);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [group.id, loadHistory, unlockGroupKey]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  // Mark visible, not-yet-read messages from others as read.
  useEffect(() => {
    for (const m of messages) {
      if (
        m.sender_id !== user.id &&
        !m.pending &&
        !observedIds.current.has(m.id) &&
        !String(m.id).startsWith('tmp-')
      ) {
        observedIds.current.add(m.id);
        markMessageRead(m.id);
      }
    }
  }, [messages, user.id, markMessageRead]);

  const typingUsers = Array.from(typingByGroup[group.id] || []);

  const handleLoadMore = useCallback(() => {
    if (messages.length === 0) return;
    loadHistory(group.id, { before: messages[0].id });
  }, [group.id, messages, loadHistory]);

  return (
    <div className="conversation">
      <header className="conversation-header">
        <div>
          <h2>{group.name}</h2>
          <span className="conversation-subtitle mono">
            {keyMissing ? 'encryption key unavailable on this device' : 'end-to-end encrypted'}
          </span>
        </div>
        <div className="conversation-header-actions">
          <button className="btn-icon" title="Search messages" onClick={() => setShowSearch(true)}>
            🔍
          </button>
          <button className="btn-icon" title="Group info & invite" onClick={() => setShowGroupInfo(true)}>
            ℹ
          </button>
        </div>
      </header>

      <div className="conversation-main">
        <div className="conversation-messages scrollbar-thin" ref={scrollRef}>
          {!loading && messages.length >= 50 && (
            <button className="btn-link load-more" onClick={handleLoadMore}>
              Load earlier messages
            </button>
          )}
          {loading && <div className="conversation-loading">Decrypting conversation…</div>}
          {!loading && messages.length === 0 && (
            <div className="conversation-empty">
              No messages yet. Say hello — it'll be encrypted before it leaves your device.
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              isMine={m.sender_id === user.id}
              onOpenThread={() => setActiveThreadRootId(m.id)}
              group={group}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        {activeThreadRootId && (
          <ThreadPanel
            group={group}
            rootMessageId={activeThreadRootId}
            onClose={() => setActiveThreadRootId(null)}
          />
        )}
      </div>

      {typingUsers.length > 0 && (
        <div className="typing-indicator">
          {typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing…
        </div>
      )}

      <MessageComposer group={group} disabled={keyMissing} />

      {showGroupInfo && <GroupInfoModal group={group} onClose={() => setShowGroupInfo(false)} />}
      {showSearch && (
        <SearchPanel
          group={group}
          messages={messagesByGroup[group.id] || []}
          onClose={() => setShowSearch(false)}
          onJumpToThread={(rootId) => {
            setActiveThreadRootId(rootId);
            setShowSearch(false);
          }}
        />
      )}
    </div>
  );
}
