import { useState, useMemo } from 'react';
import { searchDecryptedMessages, highlightMatches } from '../utils/search';

function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SearchPanel({ group, messages, onClose, onJumpToThread }) {
  const [term, setTerm] = useState('');

  const results = useMemo(() => searchDecryptedMessages(messages, term), [messages, term]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card search-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Search in {group.name}</h2>
        <p className="modal-hint">
          Searches your decrypted local message history — content never leaves your device for
          this search.
        </p>
        <input
          autoFocus
          className="search-input"
          placeholder="Search messages…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />

        <div className="search-results scrollbar-thin">
          {term && results.length === 0 && <div className="modal-hint">No matches found.</div>}
          {results.map((m) => (
            <button
              key={m.id}
              className="search-result"
              onClick={() => onJumpToThread(m.thread_root_id || m.id)}
            >
              <div className="search-result-meta">
                <span>{m.sender_display_name || m.sender_username}</span>
                <span className="mono">{formatDateTime(m.created_at)}</span>
              </div>
              <div className="search-result-text">
                {highlightMatches(m.plaintext || '', term).map((seg, i) =>
                  seg.highlight ? (
                    <mark key={i}>{seg.text}</mark>
                  ) : (
                    <span key={i}>{seg.text}</span>
                  )
                )}
              </div>
            </button>
          ))}
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
