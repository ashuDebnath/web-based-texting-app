const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config/env');

const uploadDirAbs = path.isAbsolute(config.uploadDir)
  ? config.uploadDir
  : path.join(__dirname, '..', '..', config.uploadDir);

if (!fs.existsSync(uploadDirAbs)) {
  fs.mkdirSync(uploadDirAbs, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDirAbs),
  filename: (req, file, cb) => {
    // Store under a random name on disk; the real (encrypted) filename and
    // metadata live in the database. This avoids path traversal / collisions
    // and avoids leaking original filenames via the filesystem.
    const randomName = crypto.randomBytes(24).toString('hex');
    cb(null, randomName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024,
  },
});

module.exports = { upload, uploadDirAbs };
