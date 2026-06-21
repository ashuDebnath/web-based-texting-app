/**
 * Simple in-memory token-bucket limiter, keyed per-socket, for high-frequency
 * realtime events (message:send, typing, etc.) that shouldn't be throttled
 * by HTTP middleware. For multi-instance deployments behind a load balancer,
 * swap this for a Redis-backed limiter — the interface below stays the same.
 */
class SocketRateLimiter {
  constructor({ capacity = 20, refillPerSecond = 5 } = {}) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.buckets = new Map(); // socketId -> { tokens, lastRefill }
  }

  _refill(bucket) {
    const now = Date.now();
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    const refillAmount = elapsedSeconds * this.refillPerSecond;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + refillAmount);
    bucket.lastRefill = now;
  }

  /**
   * @returns {boolean} true if the action is allowed (and consumes a token).
   */
  consume(socketId, cost = 1) {
    let bucket = this.buckets.get(socketId);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: Date.now() };
      this.buckets.set(socketId, bucket);
    }
    this._refill(bucket);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }
    return false;
  }

  removeSocket(socketId) {
    this.buckets.delete(socketId);
  }
}

module.exports = SocketRateLimiter;
