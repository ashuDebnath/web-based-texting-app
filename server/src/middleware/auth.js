const { verifyAccessToken } = require('../utils/jwt');
const ApiError = require('../utils/ApiError');

/**
 * Express middleware: requires a valid "Authorization: Bearer <token>" header.
 * Populates req.user = { id, username } on success.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header'));
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    return next(new ApiError(401, 'Invalid or expired access token'));
  }
}

/**
 * Used by Socket.IO middleware to authenticate the handshake.
 * Returns the decoded payload or throws.
 */
function authenticateSocketToken(token) {
  if (!token) {
    throw new Error('Missing auth token');
  }
  return verifyAccessToken(token);
}

module.exports = { authenticate, authenticateSocketToken };
