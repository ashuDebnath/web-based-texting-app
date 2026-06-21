const express = require('express');
const authRoutes = require('./authRoutes');
const groupRoutes = require('./groupRoutes');
const inviteRoutes = require('./inviteRoutes');
const messageRoutes = require('./messageRoutes');
const fileRoutes = require('./fileRoutes');

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

router.use('/auth', authRoutes);
router.use('/groups', groupRoutes);
router.use('/invites', inviteRoutes);
router.use('/messages', messageRoutes);
router.use('/files', fileRoutes);

module.exports = router;
