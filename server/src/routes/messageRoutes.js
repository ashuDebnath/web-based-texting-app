const express = require('express');
const messageController = require('../controllers/messageController');
const { authenticate } = require('../middleware/auth');
const { messageLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.use(authenticate);

router.get('/group/:groupId/history', messageController.getHistory);
router.get('/group/:groupId/search', messageController.search);
router.get('/group/:groupId/thread/:messageId', messageController.getThread);

router.put('/:messageId', messageLimiter, messageController.editMessage);
router.delete('/:messageId', messageController.deleteMessage);
router.post('/:messageId/read', messageController.markRead);

module.exports = router;
