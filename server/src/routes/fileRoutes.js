const express = require('express');
const fileController = require('../controllers/fileController');
const { authenticate } = require('../middleware/auth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { upload } = require('../config/multer');

const router = express.Router();

router.use(authenticate);

router.post('/upload', uploadLimiter, upload.single('file'), fileController.uploadFile);
router.get('/:attachmentId/download', fileController.downloadFile);

module.exports = router;
