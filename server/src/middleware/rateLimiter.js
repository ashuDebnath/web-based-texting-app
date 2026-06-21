const rateLimit = require('express-rate-limit');
const config = require('../config/env');

/**
 * General-purpose API rate limiter applied to all /api routes.
 */
const generalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/**
 * Stricter limiter for auth endpoints (login/register) to slow brute force.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

/**
 * Limiter for message-sending over REST (used for the offline fallback /
 * file-attached message endpoint). Socket.IO events have their own
 * in-memory token-bucket limiter (see sockets/rateLimiter.js).
 */
const messageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You are sending messages too fast. Slow down.' },
});

/**
 * Limiter for file uploads.
 */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads, please wait before uploading more files.' },
});

module.exports = { generalLimiter, authLimiter, messageLimiter, uploadLimiter };
