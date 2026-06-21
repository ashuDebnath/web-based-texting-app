import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import AuthLayout from '../components/AuthLayout';

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', email: '', password: '', displayName: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [keyGenStatus, setKeyGenStatus] = useState('');

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    setKeyGenStatus('Generating your encryption keypair…');
    try {
      await register(form);
      const redirectTo = location.state?.from || '/';
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.data?.error || err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
      setKeyGenStatus('');
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      subtitle="A private encryption key is generated on this device and never leaves it."
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <label>
          Display name
          <input
            value={form.displayName}
            onChange={update('displayName')}
            required
            placeholder="Ada Lovelace"
          />
        </label>
        <label>
          Username
          <input
            value={form.username}
            onChange={update('username')}
            required
            pattern="[a-zA-Z0-9_]{3,30}"
            title="3-30 characters: letters, numbers, underscores"
            placeholder="ada"
          />
        </label>
        <label>
          Email
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
            required
            autoComplete="email"
            placeholder="ada@example.com"
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={form.password}
            onChange={update('password')}
            required
            minLength={8}
            autoComplete="new-password"
            placeholder="At least 8 characters"
          />
        </label>
        {error && <div className="auth-error">{error}</div>}
        {keyGenStatus && <div className="auth-status mono">{keyGenStatus}</div>}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login" state={location.state}>Sign in</Link>
      </p>
    </AuthLayout>
  );
}
