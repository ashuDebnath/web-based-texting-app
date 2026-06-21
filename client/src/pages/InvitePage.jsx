import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/apiClient';
import AuthLayout from '../components/AuthLayout';

export default function InvitePage() {
  const { token } = useParams();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get(`/invites/${token}`);
        setPreview(data);
      } catch (err) {
        setError(err.data?.error || 'This invite link is invalid or has expired.');
      } finally {
        setLoadingPreview(false);
      }
    })();
  }, [token]);

  async function handleJoin() {
    if (!user) {
      navigate('/login', { state: { from: `/invite/${token}` } });
      return;
    }
    setJoining(true);
    setError('');
    try {
      await api.post(`/invites/${token}/join`, {});
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.data?.error || 'Failed to join the conversation.');
    } finally {
      setJoining(false);
    }
  }

  if (authLoading || loadingPreview) {
    return (
      <AuthLayout title="Loading invite…" subtitle="">
        <p className="modal-hint">One moment.</p>
      </AuthLayout>
    );
  }

  if (error && !preview) {
    return (
      <AuthLayout title="Invite unavailable" subtitle={error}>
        <Link to="/" className="btn btn-primary" style={{ display: 'block', textAlign: 'center' }}>
          Go to SecureChat
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Join "${preview.group.name}"`}
      subtitle={`${preview.memberCount} member${preview.memberCount === 1 ? '' : 's'} already here.`}
    >
      {error && <div className="auth-error">{error}</div>}
      <button className="btn btn-primary" onClick={handleJoin} disabled={joining}>
        {joining ? 'Joining…' : user ? 'Join conversation' : 'Sign in to join'}
      </button>
      {!user && (
        <p className="auth-switch">
          Don't have an account? <Link to="/register" state={{ from: `/invite/${token}` }}>Sign up</Link>
        </p>
      )}
    </AuthLayout>
  );
}
