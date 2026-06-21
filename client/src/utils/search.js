/**
 * Searches across already-decrypted messages held in memory/local cache.
 * Because message content is end-to-end encrypted, this is where "real"
 * full-text search happens — the server can only search metadata
 * (see server/src/models/messageModel.js searchMessages).
 *
 * @param {Array<{id, plaintext, sender_display_name, created_at}>} messages
 * @param {string} term
 */
export function searchDecryptedMessages(messages, term) {
  const normalized = term.trim().toLowerCase();
  if (!normalized) return [];

  return messages.filter((m) => {
    if (m.deleted) return false;
    const haystack = `${m.plaintext || ''} ${m.sender_display_name || ''}`.toLowerCase();
    return haystack.includes(normalized);
  });
}

/**
 * Highlights matching substrings for rendering search results.
 * Returns an array of { text, highlight } segments.
 */
export function highlightMatches(text, term) {
  if (!term) return [{ text, highlight: false }];
  const normalized = term.toLowerCase();
  const lowerText = text.toLowerCase();
  const segments = [];
  let idx = 0;

  while (idx < text.length) {
    const matchIdx = lowerText.indexOf(normalized, idx);
    if (matchIdx === -1) {
      segments.push({ text: text.slice(idx), highlight: false });
      break;
    }
    if (matchIdx > idx) {
      segments.push({ text: text.slice(idx, matchIdx), highlight: false });
    }
    segments.push({ text: text.slice(matchIdx, matchIdx + term.length), highlight: true });
    idx = matchIdx + term.length;
  }

  return segments;
}
