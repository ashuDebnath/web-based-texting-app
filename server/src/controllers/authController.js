const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const userModel = require('../models/userModel');
const { query } = require('../config/db');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const USERNAME_RE = /^[a-zA-Z0-9_]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function issueTokens(user) {
  const accessToken = signAccessToken({ sub: user.id, username: user.username });
  const refreshToken = signRefreshToken({ sub: user.id, username: user.username });

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, hashToken(refreshToken), expiresAt]
  );

  return { accessToken, refreshToken };
}

const register = asyncHandler(async (req, res) => {
  const { username, email, password, displayName, publicKey } = req.body || {};

  if (!username || !email || !password || !displayName) {
    throw new ApiError(400, 'username, email, password, and displayName are required');
  }
  if (!USERNAME_RE.test(username)) {
    throw new ApiError(400, 'Username must be 3-30 characters: letters, numbers, underscores');
  }
  if (!EMAIL_RE.test(email)) {
    throw new ApiError(400, 'Invalid email format');
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters');
  }

  const existingEmail = await userModel.findByEmail(email.toLowerCase());
  if (existingEmail) throw new ApiError(409, 'Email already registered');

  const existingUsername = await userModel.findByUsername(username);
  if (existingUsername) throw new ApiError(409, 'Username already taken');

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await userModel.createUser({
    username,
    email: email.toLowerCase(),
    passwordHash,
    displayName,
  });

  if (publicKey) {
    await userModel.setPublicKey(user.id, publicKey);
  }

  const tokens = await issueTokens(user);
  res.status(201).json({
    user: { ...user, public_key: publicKey || null },
    ...tokens,
  });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    throw new ApiError(400, 'email and password are required');
  }

  const user = await userModel.findByEmail(email.toLowerCase());
  if (!user) throw new ApiError(401, 'Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw new ApiError(401, 'Invalid email or password');

  const tokens = await issueTokens(user);
  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser, ...tokens });
});

const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (!refreshToken) throw new ApiError(400, 'refreshToken is required');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired refresh token');
  }

  const tokenHash = hashToken(refreshToken);
  const { rows } = await query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1 AND user_id = $2 AND revoked = FALSE`,
    [tokenHash, payload.sub]
  );
  if (rows.length === 0) throw new ApiError(401, 'Refresh token not recognized or revoked');
  if (new Date(rows[0].expires_at) < new Date()) {
    throw new ApiError(401, 'Refresh token expired');
  }

  const user = await userModel.findById(payload.sub);
  if (!user) throw new ApiError(401, 'User no longer exists');

  // Rotate: revoke old, issue new
  await query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1', [rows[0].id]);
  const tokens = await issueTokens(user);

  res.json({ user, ...tokens });
});

const logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (refreshToken) {
    await query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [
      hashToken(refreshToken),
    ]);
  }
  res.json({ success: true });
});

const me = asyncHandler(async (req, res) => {
  const user = await userModel.findById(req.user.id);
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ user });
});

const updatePublicKey = asyncHandler(async (req, res) => {
  const { publicKey } = req.body || {};
  if (!publicKey) throw new ApiError(400, 'publicKey is required');
  const updated = await userModel.setPublicKey(req.user.id, publicKey);
  res.json({ user: updated });
});

const searchUsers = asyncHandler(async (req, res) => {
  const term = (req.query.q || '').trim();
  if (term.length < 1) return res.json({ users: [] });
  const users = await userModel.searchUsers(term, req.user.id);
  res.json({ users });
});

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
  updatePublicKey,
  searchUsers,
};
