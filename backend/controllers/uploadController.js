const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const logger = require('../config/logger');
const { findChatForParticipant } = require('../utils/chatAuth');
const { messageTypeForMime, decodeOriginalName } = require('../utils/uploads');

// Kept out of chatController deliberately: this file must stay importable in
// tests without dragging in redis/socket config the way chatController does.

// Runs BEFORE multer in the route chain, so a non-participant's upload is
// rejected without ever writing a byte to disk.
const requireChatParticipant = async (req, res, next) => {
    const { chatId } = req.params;
    const { userId } = req.user;
    try {
        if (!mongoose.Types.ObjectId.isValid(chatId)) {
            return res.status(400).json({ message: 'Invalid chat id.' });
        }
        const chat = await findChatForParticipant(Chat, chatId, userId);
        if (!chat) {
            logger.warn(`Upload to chat ${chatId} denied for user ${userId}: not a participant.`);
            return res.status(403).json({ message: 'Access denied or chat not found.' });
        }
        next();
    } catch (error) {
        logger.error(`Error verifying chat access for upload (chat ${chatId}, user ${userId}): ${error.message}`, error);
        res.status(500).json({ message: 'Failed to verify chat access.' });
    }
};

// The upload is only the file transfer - no Message is created here. The
// client takes this response and emits sendMessage over the socket with these
// fields, which keeps message creation, acks, and optimistic reconciliation
// on the one existing path.
const uploadChatFile = (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file was uploaded.' });
    }

    logger.info(`User ${req.user.userId} uploaded ${req.file.filename} (${req.file.size} bytes) for chat ${req.params.chatId}`);

    res.status(201).json({
        // Relative on purpose: the client resolves it against its API base,
        // so moving the backend does not strand every stored URL.
        fileUrl: `/uploads/${req.file.filename}`,
        fileName: decodeOriginalName(req.file.originalname),
        fileType: req.file.mimetype,
        fileSize: req.file.size,
        messageType: messageTypeForMime(req.file.mimetype)
    });
};

module.exports = { requireChatParticipant, uploadChatFile };
