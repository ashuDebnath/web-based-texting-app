import { useState, useEffect } from 'react';
import { api } from '../utils/apiClient';
import { useChat } from '../context/ChatContext';

export default function GroupInfoModal({ group, onClose }) {
  const { createInviteLink } = useChat();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [creatingInvite, setCreatingInvite] = useState(false);
  const [copiedToken, setCopiedToken] = useState('');

  useEffect(() => {
    (async () => {
      const { members: m } = await api.get(`/groups/${group.id}/members`);
      setMembers(m);
      const { invites: inv } = await api.get(`/groups/${group.id}/invites`);
      setInvites(inv);
    })();
  }, [group.id]);

  async function handleCreateInvite() {
    setCreatingInvite(true);
    try {
      const invite = await createInviteLink(group.id, { expiresInHours: 168 }); // 7 days
      setInvites((prev) => [invite, ...prev]);
    } finally {
      setCreatingInvite(false);
    }
  }

  function inviteUrl(token) {
    return `${window.location.origin}/invite/${token}`;
  }

  async function handleCopy(token) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(''), 2000);
    } catch {
      // clipboard unavailable; user can select manually
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>{group.name}</h2>

        <section className="modal-section">
          <h3>Members ({members.length})</h3>
          <ul className="member-list">
            {members.map((m) => (
              <li key={m.user_id} className="member-list-item">
                <span className={`presence-dot ${m.is_online ? 'online' : 'offline'}`} />
                <span>{m.display_name}</span>
                <span className="mono member-username">@{m.username}</span>
                {m.role === 'owner' && <span className="role-badge">owner</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="modal-section">
          <h3>Invite link</h3>
          <p className="modal-hint">
            Anyone with this link can join the conversation. Links expire after 7 days.
          </p>
          <button className="btn btn-secondary" onClick={handleCreateInvite} disabled={creatingInvite}>
            {creatingInvite ? 'Creating…' : '+ Create invite link'}
          </button>
          <div className="invite-list">
            {invites.map((inv) => (
              <div key={inv.id} className="invite-item">
                <span className="mono invite-token">{inviteUrl(inv.token)}</span>
                <button className="btn-link" onClick={() => handleCopy(inv.token)}>
                  {copiedToken === inv.token ? 'Copied!' : 'Copy'}
                </button>
              </div>
            ))}
          </div>
        </section>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
