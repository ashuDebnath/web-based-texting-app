const express = require('express');
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/refresh', authLimiter, authController.refresh);
router.post('/logout', authController.logout);

router.get('/me', authenticate, authController.me);
router.put('/public-key', authenticate, authController.updatePublicKey);
router.get('/users/search', authenticate, authController.searchUsers);

module.exports = router;
