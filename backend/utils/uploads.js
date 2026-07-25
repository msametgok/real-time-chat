const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const logger = require('../config/logger');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Decided server-side from the MIME type, never trusted from the client - the
// client uploads a file and is told what kind of message it became.
// SVG deliberately maps to 'file': it is the one image format that can carry
// scripts, so it is never treated as an inline image (see isInlineFile).
const messageTypeForMime = (mimetype = '') => {
    if (mimetype === 'image/svg+xml') return 'file';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'file';
};

// Extensions the /uploads static route may serve inline. Everything else is
// sent with Content-Disposition: attachment, so an uploaded HTML or SVG file
// downloads instead of executing in the backend's origin when opened directly.
const INLINE_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp',
    '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.m4a', '.pdf'
]);

const isInlineFile = (filePath) =>
    INLINE_EXTENSIONS.has(path.extname(filePath).toLowerCase());

// Multer decodes originalname as latin1, so anything outside ASCII (ğ, ş, ü,
// emoji...) arrives mangled without this round-trip.
const decodeOriginalName = (name = '') =>
    Buffer.from(name, 'latin1').toString('utf8');

// Random name on disk: the original filename is user input and belongs in the
// database (fileName), never in a filesystem path.
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Created lazily so requiring this module has no side effects.
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        cb(null, UPLOADS_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = /^\.[a-z0-9]{1,10}$/.test(ext) ? ext : '';
        cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`);
    }
});

const upload = multer({ storage, limits: { fileSize: MAX_FILE_SIZE } });

// upload.single wrapped so multer's own errors (most commonly the size cap)
// come back as a 400 with a readable message instead of falling through to
// the generic 500 handler.
const uploadSingleFile = (req, res, next) => {
    upload.single('file')(req, res, (err) => {
        if (!err) return next();
        const message = err.code === 'LIMIT_FILE_SIZE'
            ? 'File is too large (max 10 MB).'
            : err.message || 'File upload failed.';
        logger.warn(`Upload rejected for user ${req.user?.userId}: ${message}`);
        res.status(400).json({ message });
    });
};

// Best-effort removal of a stored upload (delete-for-everyone). basename()
// guards against a crafted fileUrl reaching outside the uploads dir. Missing
// files are fine - the message is the source of truth, the file is cargo.
const removeUploadedFile = (fileUrl) => {
    if (!fileUrl || !fileUrl.startsWith('/uploads/')) return;
    const filePath = path.join(UPLOADS_DIR, path.basename(fileUrl));
    fs.unlink(filePath, (err) => {
        if (err && err.code !== 'ENOENT') {
            logger.warn(`Could not remove uploaded file ${filePath}: ${err.message}`);
        }
    });
};

module.exports = {
    uploadSingleFile,
    removeUploadedFile,
    messageTypeForMime,
    isInlineFile,
    decodeOriginalName,
    UPLOADS_DIR,
    MAX_FILE_SIZE
};
