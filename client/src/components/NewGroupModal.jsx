import { useState, useEffect, useRef } from 'react';
import { api } from '../utils/apiClient';
import { useChat } from '../context/ChatContext';

export default function NewGroupModal({ onClose }) {
  const { createGroup, setActiveGroupId } = useChat();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // [{userId, username, displayName, publicKey}]
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const { users } = await api.get(`/auth/users/search?q=${encodeURIComponent(query)}`);
        setResults(users.filter((u) => !selected.some((s) => s.userId === u.id)));
      } catch (err) {
        console.error(err);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function addMember(u) {
    setSelected((prev) => [
      ...prev,
      { userId: u.id, username: u.username, displayName: u.display_name, publicKey: u.public_key },
    ]);
    setResults((prev) => prev.filter((r) => r.id !== u.id));
    setQuery('');
  }

  function removeMember(userId) {
    setSelected((prev) => prev.filter((s) => s.userId !== userId));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Give your conversation a name.');
      return;
    }
    setCreating(true);
    try {
      const memberPublicKeys = selected.map((m) => ({ userId: m.userId, publicKey: m.publicKey }));

      const group = await createGroup({ name, memberPublicKeys });
      setActiveGroupId(group.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to create group');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h2>New conversation</h2>
        <form onSubmit={handleCreate} className="auth-form">
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project Falcon"
              required
              autoFocus
            />
          </label>

          <label>
            Add members
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by username…"
            />
          </label>

          {results.length > 0 && (
            <div className="member-results">
              {results.map((u) => (
                <button type="button" key={u.id} className="member-result" onClick={() => addMember(u)}>
                  {u.display_name} <span className="mono">@{u.username}</span>
                </button>
              ))}
            </div>
          )}

          {selected.length > 0 && (
            <div className="member-chips">
              {selected.map((m) => (
                <span key={m.userId} className="member-chip">
                  {m.displayName}
                  {!m.publicKey && (
                    <span className="member-chip-warning" title="This user hasn't set up encryption yet">
                      ⚠
                    </span>
                  )}
                  <button type="button" onClick={() => removeMember(m.userId)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <p className="modal-hint">
            You can also create the group now and invite people later with a shareable link.
          </p>

          {error && <div className="auth-error">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={creating}>
              {creating ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
