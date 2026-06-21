const express = require('express');
const groupController = require('../controllers/groupController');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.use(authenticate);

router.post('/', groupController.createGroup);
router.get('/', groupController.listMyGroups);
router.get('/:groupId', groupController.getGroup);
router.delete('/:groupId/leave', groupController.leaveGroup);
router.get('/:groupId/members', groupController.getGroupMembersHandler);

router.post('/:groupId/invites', groupController.createInvite);
router.get('/:groupId/invites', groupController.listInvites);
router.delete('/invites/:inviteId', groupController.revokeInvite);

router.put('/:groupId/members/:userId/key', groupController.shareGroupKey);

module.exports = router;
