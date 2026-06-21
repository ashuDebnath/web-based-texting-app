/**
 * Tracks online presence at the user level (not socket level), since a
 * single user may have multiple tabs/devices connected simultaneously.
 * A user is only considered "offline" once their LAST socket disconnects.
 */
class PresenceTracker {
  constructor() {
    this.userSockets = new Map(); // userId -> Set<socketId>
  }

  addSocket(userId, socketId) {
    if (!this.userSockets.has(userId)) {
      this.userSockets.set(userId, new Set());
    }
    const set = this.userSockets.get(userId);
    const wasOffline = set.size === 0;
    set.add(socketId);
    return wasOffline; // true if this is the user's first connection
  }

  /**
   * @returns {boolean} true if the user has no more active sockets (now fully offline)
   */
  removeSocket(userId, socketId) {
    const set = this.userSockets.get(userId);
    if (!set) return true;
    set.delete(socketId);
    if (set.size === 0) {
      this.userSockets.delete(userId);
      return true;
    }
    return false;
  }

  isOnline(userId) {
    return this.userSockets.has(userId) && this.userSockets.get(userId).size > 0;
  }

  getSocketIds(userId) {
    return Array.from(this.userSockets.get(userId) || []);
  }

  getOnlineUserIds() {
    return Array.from(this.userSockets.keys());
  }
}

module.exports = PresenceTracker;
