import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function Sidebar({ user, groups, activeGroupId, onSelectGroup, onNewGroup }) {
  const { logout } = useAuth();
  const { onlineUsers, connected } = useChat();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <span className="auth-brand-lock">⛓</span> SecureChat
        </div>
        <span
          className={`presence-dot ${connected ? 'online' : 'offline'}`}
          title={connected ? 'Connected' : 'Reconnecting…'}
        />
      </div>

      <button className="btn btn-primary sidebar-new-btn" onClick={onNewGroup}>
        + New conversation
      </button>

      <div className="sidebar-group-list scrollbar-thin">
        {groups.length === 0 && (
          <p className="sidebar-empty">No conversations yet. Start one above.</p>
        )}
        {groups.map((g) => (
          <button
            key={g.id}
            className={`sidebar-group-item ${g.id === activeGroupId ? 'active' : ''}`}
            onClick={() => onSelectGroup(g.id)}
          >
            <div className="sidebar-group-avatar">{g.name.slice(0, 1).toUpperCase()}</div>
            <div className="sidebar-group-info">
              <div className="sidebar-group-name">{g.name}</div>
              <div className="sidebar-group-meta">
                {g.member_count} member{g.member_count === 1 ? '' : 's'}
              </div>
            </div>
            {g.last_message_at && (
              <span className="sidebar-group-time">{formatRelativeTime(g.last_message_at)}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-me">
          <span
            className={`presence-dot ${onlineUsers.has(user.id) || connected ? 'online' : 'offline'}`}
          />
          <span className="sidebar-me-name">{user.display_name}</span>
        </div>
        <button className="btn-link" onClick={logout}>
          Sign out
        </button>
      </div>
    </aside>
  );
}
