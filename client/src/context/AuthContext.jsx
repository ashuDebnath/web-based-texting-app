import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api, setTokens, clearTokens, getAccessToken } from '../utils/apiClient';
import { reconnectSocket, disconnectSocket } from '../utils/socketClient';
import { generateIdentityKeyPair } from '../crypto/e2ee';
import { savePrivateKey, loadPrivateKey, hasPrivateKey, clearPrivateKey } from '../crypto/keyStorage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsKeyRecovery, setNeedsKeyRecovery] = useState(false);

  const bootstrap = useCallback(async () => {
    const token = getAccessToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const { user: me } = await api.get('/auth/me');
      setUser(me);
      if (!hasPrivateKey(me.id)) {
        // The private key only ever lives in this browser. If it's missing
        // (new device, cleared storage), the user can't decrypt history
        // from before this point. They can still send/receive new messages
        // after generating a fresh keypair, which re-keys their groups.
        setNeedsKeyRecovery(true);
      }
      reconnectSocket();
    } catch (err) {
      clearTokens();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const register = useCallback(async ({ username, email, password, displayName }) => {
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    const data = await api.post('/auth/register', {
      username,
      email,
      password,
      displayName,
      publicKey,
    });
    setTokens(data);
    savePrivateKey(data.user.id, privateKey);
    setUser(data.user);
    setNeedsKeyRecovery(false);
    reconnectSocket();
    return data.user;
  }, []);

  const login = useCallback(async ({ email, password }) => {
    const data = await api.post('/auth/login', { email, password });
    setTokens(data);
    setUser(data.user);
    setNeedsKeyRecovery(!hasPrivateKey(data.user.id));
    reconnectSocket();
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {});
    } catch {
      // ignore network errors on logout
    }
    clearTokens();
    disconnectSocket();
    setUser(null);
  }, []);

  /**
   * Generates a brand-new identity keypair for this browser and uploads
   * the public half. Used for key recovery on a new device. Existing
   * encrypted history that was wrapped to the OLD key becomes
   * unreadable unless another member re-shares the group key — this is
   * expected, standard E2E behavior (the server never holds a master key
   * that could bypass this).
   */
  const regenerateKeys = useCallback(async () => {
    if (!user) throw new Error('Not logged in');
    const { publicKey, privateKey } = await generateIdentityKeyPair();
    await api.put('/auth/public-key', { publicKey });
    savePrivateKey(user.id, privateKey);
    setUser((u) => ({ ...u, public_key: publicKey }));
    setNeedsKeyRecovery(false);
  }, [user]);

  const getMyPrivateKey = useCallback(() => {
    if (!user) return null;
    return loadPrivateKey(user.id);
  }, [user]);

  const value = {
    user,
    loading,
    needsKeyRecovery,
    register,
    login,
    logout,
    regenerateKeys,
    getMyPrivateKey,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
