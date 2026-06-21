import { useState } from 'react';
import { useAuth } from '../context/AuthContext';

export default function KeyRecoveryBanner() {
  const { regenerateKeys } = useAuth();
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  async function handleRegenerate() {
    setBusy(true);
    try {
      await regenerateKeys();
      setDismissed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="key-recovery-banner">
      <span>
        This device doesn't have your encryption key, so older messages can't be decrypted here.
        You can generate a new key — new messages will work normally, but message history sent
        before this point will stay locked on this device.
      </span>
      <button className="btn btn-secondary" onClick={handleRegenerate} disabled={busy}>
        {busy ? 'Generating…' : 'Generate new key'}
      </button>
      <button className="btn-link" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
    </div>
  );
}
