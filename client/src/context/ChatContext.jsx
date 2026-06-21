import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { api } from '../utils/apiClient';
import { getSocket } from '../utils/socketClient';
import { useAuth } from './AuthContext';
import {
  generateGroupKey,
  wrapGroupKeyForUser,
  unwrapGroupKey,
  encryptText,
  decryptText,
} from '../crypto/e2ee';
import { cacheGroupKey, getCachedGroupKey } from '../crypto/keyStorage';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user, getMyPrivateKey } = useAuth();
  const [groups, setGroups] = useState([]);
  const [activeGroupId, setActiveGroupId] = useState(null);
  // messagesByGroup: { [groupId]: Array<message with .plaintext decrypted> }
  const [messagesByGroup, setMessagesByGroup] = useState({});
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  const [typingByGroup, setTypingByGroup] = useState({}); // groupId -> Set<username>
  const [connected, setConnected] = useState(false);

  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  // ---------- Group key helpers ----------

  const unlockGroupKey = useCallback(
    async (group) => {
      const cached = getCachedGroupKey(group.id);
      if (cached) return cached;
      if (!group.wrapped_group_key) return null;

      const myPrivateKey = getMyPrivateKey();
      if (!myPrivateKey) return null;

      try {
        const key = await unwrapGroupKey(group.wrapped_group_key, myPrivateKey);
        cacheGroupKey(group.id, key);
        return key;
      } catch (err) {
        console.error('Failed to unwrap group key for', group.id, err);
        return null;
      }
    },
    [getMyPrivateKey]
  );

  const decryptMessage = useCallback(async (message, groupKey) => {
    if (message.deleted) return { ...message, plaintext: '[deleted]' };
    if (message.message_type === 'file' && !message.ciphertext) {
      // File messages may have no text caption at all — nothing to decrypt.
      return { ...message, plaintext: '' };
    }
    if (!groupKey || !message.ciphertext) {
      return { ...message, plaintext: '[unable to decrypt — missing key]' };
    }
    try {
      const plaintext = await decryptText(message.ciphertext, message.iv, groupKey);
      return { ...message, plaintext };
    } catch (err) {
      return { ...message, plaintext: '[unable to decrypt this message]' };
    }
  }, []);

  // ---------- Load groups ----------

  const refreshGroups = useCallback(async () => {
    const { groups: g } = await api.get('/groups');
    setGroups(g);
    return g;
  }, []);

  useEffect(() => {
    if (user) refreshGroups().catch(console.error);
  }, [user, refreshGroups]);

  // ---------- Load + decrypt message history for a group ----------

  const loadHistory = useCallback(
    async (groupId, { before } = {}) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      const groupKey = group ? await unlockGroupKey(group) : null;

      const qs = before ? `?before=${before}` : '';
      const { messages } = await api.get(`/messages/group/${groupId}/history${qs}`);
      const decrypted = await Promise.all(messages.map((m) => decryptMessage(m, groupKey)));

      setMessagesByGroup((prev) => {
        const existing = prev[groupId] || [];
        const existingIds = new Set(existing.map((m) => m.id));
        const merged = before
          ? [...decrypted.filter((m) => !existingIds.has(m.id)), ...existing]
          : decrypted;
        return { ...prev, [groupId]: merged };
      });

      return decrypted;
    },
    [unlockGroupKey, decryptMessage]
  );

  // ---------- Create a new group (with E2E key generation) ----------

  const createGroup = useCallback(
    async ({ name, memberPublicKeys = [] }) => {
      const groupKey = await generateGroupKey();
      const myWrappedGroupKey = await wrapGroupKeyForUser(groupKey, user.public_key);

      const members = await Promise.all(
        memberPublicKeys
          .filter((m) => m.publicKey)
          .map(async (m) => ({
            userId: m.userId,
            wrappedGroupKey: await wrapGroupKeyForUser(groupKey, m.publicKey),
          }))
      );

      const { group } = await api.post('/groups', {
        name,
        isDirect: memberPublicKeys.length === 1,
        members,
        myWrappedGroupKey,
      });

      cacheGroupKey(group.id, groupKey);
      await refreshGroups();
      return group;
    },
    [user, refreshGroups]
  );

  // ---------- Invite links ----------

  const createInviteLink = useCallback(async (groupId, opts = {}) => {
    const { invite } = await api.post(`/groups/${groupId}/invites`, opts);
    return invite;
  }, []);

  const joinViaInvite = useCallback(
    async (token) => {
      const { group } = await api.post(`/invites/${token}/join`, {});
      await refreshGroups();
      return group;
    },
    [refreshGroups]
  );

  const previewInvite = useCallback(async (token) => {
    return api.get(`/invites/${token}`);
  }, []);

  /**
   * Called by an existing, currently-unlocked member to re-share (re-wrap)
   * the group's symmetric key for a member who joined cold via link
   * (without an existing wrapped key). Keeps the group end-to-end
   * encrypted while still allowing frictionless link-based joining.
   * Returns the wrapped key string for the caller to persist via the
   * group-members update flow.
   */
  const computeWrappedKeyForNewMember = useCallback(
    async (groupId, targetPublicKey) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      const groupKey = group ? await unlockGroupKey(group) : null;
      if (!groupKey) throw new Error('You do not have this group key unlocked yet');
      return wrapGroupKeyForUser(groupKey, targetPublicKey);
    },
    [unlockGroupKey]
  );

  // ---------- Sending messages ----------

  const sendMessage = useCallback(
    async (groupId, plaintext, { parentMessageId = null, threadRootId = null } = {}) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      const groupKey = group ? await unlockGroupKey(group) : null;
      if (!groupKey) throw new Error('Group key not available — cannot encrypt message');

      const { ciphertext, iv } = await encryptText(plaintext, groupKey);
      const clientTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setMessagesByGroup((prev) => {
        const existing = prev[groupId] || [];
        return {
          ...prev,
          [groupId]: [
            ...existing,
            {
              id: clientTempId,
              clientTempId,
              group_id: groupId,
              sender_id: user.id,
              sender_username: user.username,
              sender_display_name: user.display_name,
              plaintext,
              message_type: 'text',
              parent_message_id: parentMessageId,
              thread_root_id: threadRootId,
              created_at: new Date().toISOString(),
              pending: true,
            },
          ],
        };
      });

      return new Promise((resolve, reject) => {
        getSocket().emit(
          'message:send',
          {
            groupId,
            ciphertext,
            iv,
            messageType: 'text',
            parentMessageId,
            threadRootId,
            clientTempId,
          },
          (res) => {
            if (!res?.ok) {
              reject(new Error(res?.error || 'Failed to send message'));
              return;
            }
            resolve(res.message);
          }
        );
      });
    },
    [unlockGroupKey, user]
  );

  const editMessage = useCallback(
    async (groupId, messageId, newPlaintext) => {
      const group = groupsRef.current.find((g) => g.id === groupId);
      const groupKey = group ? await unlockGroupKey(group) : null;
      if (!groupKey) throw new Error('Group key not available');
      const { ciphertext, iv } = await encryptText(newPlaintext, groupKey);

      return new Promise((resolve, reject) => {
        getSocket().emit('message:edit', { messageId, ciphertext, iv }, (res) => {
          if (!res?.ok) return reject(new Error(res?.error || 'Failed to edit'));
          resolve(res.message);
        });
      });
    },
    [unlockGroupKey]
  );

  const deleteMessage = useCallback((messageId) => {
    return new Promise((resolve, reject) => {
      getSocket().emit('message:delete', { messageId }, (res) => {
        if (!res?.ok) return reject(new Error(res?.error || 'Failed to delete'));
        resolve();
      });
    });
  }, []);

  const markMessageRead = useCallback((messageId) => {
    getSocket().emit('message:read', { messageId });
  }, []);

  const sendTyping = useCallback((groupId, isTyping, threadRootId = null) => {
    getSocket().emit(isTyping ? 'typing:start' : 'typing:stop', { groupId, threadRootId });
  }, []);

  // ---------- Socket event wiring ----------

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onNewMessage = async (message) => {
      const group = groupsRef.current.find((g) => g.id === message.group_id);
      const groupKey = group ? await unlockGroupKey(group) : null;
      const decrypted = await decryptMessage(message, groupKey);

      setMessagesByGroup((prev) => {
        const existing = prev[message.group_id] || [];
        const withoutTemp = message.clientTempId
          ? existing.filter((m) => m.clientTempId !== message.clientTempId)
          : existing;
        if (withoutTemp.some((m) => m.id === message.id)) return prev;

        // If this is a threaded reply, bump the root message's reply_count
        // in local state too, so the "N replies" link updates live in the
        // main channel view without requiring a reload.
        const withBumpedRoot = message.thread_root_id
          ? withoutTemp.map((m) =>
              m.id === message.thread_root_id
                ? { ...m, reply_count: (m.reply_count || 0) + 1 }
                : m
            )
          : withoutTemp;

        return { ...prev, [message.group_id]: [...withBumpedRoot, decrypted] };
      });
    };

    const onBacklog = async (pendingMessages) => {
      const byGroup = {};
      for (const m of pendingMessages) {
        byGroup[m.group_id] = byGroup[m.group_id] || [];
        byGroup[m.group_id].push(m);
      }
      for (const [groupId, msgs] of Object.entries(byGroup)) {
        const group = groupsRef.current.find((g) => g.id === groupId);
        const groupKey = group ? await unlockGroupKey(group) : null;
        const decrypted = await Promise.all(msgs.map((m) => decryptMessage(m, groupKey)));
        setMessagesByGroup((prev) => {
          const existing = prev[groupId] || [];
          const existingIds = new Set(existing.map((m) => m.id));
          return {
            ...prev,
            [groupId]: [...existing, ...decrypted.filter((m) => !existingIds.has(m.id))],
          };
        });
      }
    };

    const onUpdated = async (message) => {
      const group = groupsRef.current.find((g) => g.id === message.group_id);
      const groupKey = group ? await unlockGroupKey(group) : null;
      const decrypted = await decryptMessage(message, groupKey);
      setMessagesByGroup((prev) => {
        const existing = prev[message.group_id] || [];
        return {
          ...prev,
          [message.group_id]: existing.map((m) => (m.id === decrypted.id ? decrypted : m)),
        };
      });
    };

    const onDeleted = ({ id, group_id }) => {
      setMessagesByGroup((prev) => {
        const existing = prev[group_id] || [];
        return {
          ...prev,
          [group_id]: existing.map((m) =>
            m.id === id ? { ...m, deleted: true, plaintext: '[deleted]' } : m
          ),
        };
      });
    };

    const onRead = ({ messageId, userId, readAt }) => {
      setMessagesByGroup((prev) => {
        const next = { ...prev };
        for (const groupId of Object.keys(next)) {
          next[groupId] = next[groupId].map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  readBy: [
                    ...(m.readBy || []).filter((r) => r.userId !== userId),
                    { userId, readAt },
                  ],
                }
              : m
          );
        }
        return next;
      });
    };

    const onPresenceOnline = ({ userId }) => {
      setOnlineUsers((prev) => new Set(prev).add(userId));
    };

    const onPresenceOffline = ({ userId }) => {
      setOnlineUsers((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    };

    const onTypingStart = ({ groupId, userId, username }) => {
      if (userId === user.id) return;
      setTypingByGroup((prev) => {
        const set = new Set(prev[groupId] || []);
        set.add(username);
        return { ...prev, [groupId]: set };
      });
    };

    const onTypingStop = ({ groupId, username }) => {
      setTypingByGroup((prev) => {
        const set = new Set(prev[groupId] || []);
        set.delete(username);
        return { ...prev, [groupId]: set };
      });
    };

    // A new member joined a group cold (no wrapped key yet). If we already
    // have that group's key unlocked, re-wrap it for them and deliver it —
    // this is how link-based joins stay fully end-to-end encrypted.
    const onKeyRequest = async ({ groupId, userId: newUserId, publicKey }) => {
      if (!publicKey) return;
      try {
        const wrapped = await computeWrappedKeyForNewMember(groupId, publicKey);
        await api.put(`/groups/${groupId}/members/${newUserId}/key`, { wrappedGroupKey: wrapped });
      } catch (err) {
        // We may not have this group's key unlocked either (e.g. fresh
        // device) — that's fine, another online member will handle it.
      }
    };

    // The group key was just delivered to us by another member. Re-fetch
    // our membership so the new wrapped_group_key is picked up.
    const onKeyDelivered = () => {
      refreshGroups().catch(console.error);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('message:new', onNewMessage);
    socket.on('message:backlog', onBacklog);
    socket.on('message:updated', onUpdated);
    socket.on('message:deleted', onDeleted);
    socket.on('message:read', onRead);
    socket.on('presence:online', onPresenceOnline);
    socket.on('presence:offline', onPresenceOffline);
    socket.on('typing:start', onTypingStart);
    socket.on('typing:stop', onTypingStop);
    socket.on('group:key-request', onKeyRequest);
    socket.on('group:key-delivered', onKeyDelivered);

    setConnected(socket.connected);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('message:new', onNewMessage);
      socket.off('message:backlog', onBacklog);
      socket.off('message:updated', onUpdated);
      socket.off('message:deleted', onDeleted);
      socket.off('message:read', onRead);
      socket.off('presence:online', onPresenceOnline);
      socket.off('presence:offline', onPresenceOffline);
      socket.off('typing:start', onTypingStart);
      socket.off('typing:stop', onTypingStop);
      socket.off('group:key-request', onKeyRequest);
      socket.off('group:key-delivered', onKeyDelivered);
    };
  }, [user, unlockGroupKey, decryptMessage, computeWrappedKeyForNewMember, refreshGroups]);

  const value = {
    groups,
    activeGroupId,
    setActiveGroupId,
    messagesByGroup,
    onlineUsers,
    typingByGroup,
    connected,
    refreshGroups,
    loadHistory,
    createGroup,
    createInviteLink,
    joinViaInvite,
    previewInvite,
    sendMessage,
    editMessage,
    deleteMessage,
    markMessageRead,
    sendTyping,
    unlockGroupKey,
    computeWrappedKeyForNewMember,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
