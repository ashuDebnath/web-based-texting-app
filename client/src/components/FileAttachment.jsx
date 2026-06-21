import { useState, useEffect } from 'react';
import { useChat } from '../context/ChatContext';
import { decryptFile, decryptText } from '../crypto/e2ee';
import { API_URL, getAccessToken } from '../utils/apiClient';

/**
 * Renders a file message. Attachment metadata (encrypted filename, MIME
 * type, attachment id) is carried on `message.attachment`. Actual bytes
 * are fetched lazily on click and decrypted entirely in-browser.
 */
export default function FileAttachment({ message, group }) {
  const { unlockGroupKey } = useChat();
  const [fileName, setFileName] = useState('Encrypted file');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const attachment = message.attachment;

  useEffect(() => {
    let cancelled = false;
    async function decryptName() {
      if (!attachment?.file_name_cipher || !attachment?.file_name_iv || !group) return;
      try {
        const key = await unlockGroupKey(group);
        if (!key) return;
        const name = await decryptText(attachment.file_name_cipher, attachment.file_name_iv, key);
        if (!cancelled) setFileName(name);
      } catch {
        // leave generic name
      }
    }
    decryptName();
    return () => {
      cancelled = true;
    };
  }, [attachment, group, unlockGroupKey]);

  async function handleDownload() {
    if (!attachment || !group) return;
    setDownloading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/files/${attachment.id}/download`, {
        headers: { Authorization: `Bearer ${getAccessToken()}` },
      });
      if (!res.ok) throw new Error('Download failed');
      const iv = res.headers.get('X-File-IV') || attachment.iv;
      const encryptedBuf = await res.arrayBuffer();

      const key = await unlockGroupKey(group);
      if (!key) throw new Error('Encryption key unavailable');

      const plainBuf = await decryptFile(encryptedBuf, iv, key);
      const blob = new Blob([plainBuf], { type: attachment.mime_type || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (err) {
      setError(err.message || 'Could not decrypt file');
    } finally {
      setDownloading(false);
    }
  }

  if (!attachment) {
    return <div className="file-attachment file-attachment-missing">Attachment unavailable</div>;
  }

  return (
    <div className="file-attachment">
      <span className="file-icon">📎</span>
      <div className="file-info">
        <div className="file-name">{fileName}</div>
        <div className="file-size">{formatSize(attachment.size_bytes)}</div>
      </div>
      <button className="btn-link" onClick={handleDownload} disabled={downloading}>
        {downloading ? 'Decrypting…' : 'Download'}
      </button>
      {error && <div className="file-error">{error}</div>}
    </div>
  );
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
