import { io } from 'socket.io-client';
import { getAccessToken } from './apiClient';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000';

let socket = null;

/**
 * Returns a singleton, authenticated Socket.IO connection. Creates it on
 * first call; reuses the existing connection on subsequent calls so we
 * don't open duplicate sockets across component remounts.
 */
export function getSocket() {
  if (socket && socket.connected) return socket;

  if (socket) {
    socket.disconnect();
  }

  socket = io(SOCKET_URL, {
    auth: { token: getAccessToken() },
    autoConnect: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

/**
 * Force a fresh connection using the latest access token (call after login
 * or token refresh, since the auth payload is only read at connect time).
 */
export function reconnectSocket() {
  disconnectSocket();
  return getSocket();
}
