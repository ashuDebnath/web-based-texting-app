const express = require('express');
const groupController = require('../controllers/groupController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// Preview can be viewed without auth (so a link can show "sign up to join"),
// but joining requires an authenticated account.
router.get('/:token', groupController.previewInvite);
router.post('/:token/join', authenticate, groupController.joinViaInvite);

module.exports = router;
