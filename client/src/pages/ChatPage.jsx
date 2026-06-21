import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import Sidebar from '../components/Sidebar';
import ConversationView from '../components/ConversationView';
import NewGroupModal from '../components/NewGroupModal';
import KeyRecoveryBanner from '../components/KeyRecoveryBanner';

export default function ChatPage() {
  const { user, needsKeyRecovery } = useAuth();
  const { groups, activeGroupId, setActiveGroupId } = useChat();
  const [showNewGroup, setShowNewGroup] = useState(false);

  useEffect(() => {
    if (!activeGroupId && groups.length > 0) {
      setActiveGroupId(groups[0].id);
    }
  }, [groups, activeGroupId, setActiveGroupId]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;

  return (
    <div className="chat-shell">
      {needsKeyRecovery && <KeyRecoveryBanner />}
      <div className="chat-body">
        <Sidebar
          user={user}
          groups={groups}
          activeGroupId={activeGroupId}
          onSelectGroup={setActiveGroupId}
          onNewGroup={() => setShowNewGroup(true)}
        />
        {activeGroup ? (
          <ConversationView group={activeGroup} />
        ) : (
          <div className="empty-conversation">
            <p>No conversation selected.</p>
            <button className="btn btn-primary" onClick={() => setShowNewGroup(true)}>
              Start a new conversation
            </button>
          </div>
        )}
      </div>
      {showNewGroup && <NewGroupModal onClose={() => setShowNewGroup(false)} />}
    </div>
  );
}
