const mongoose = require('mongoose');
const logger = require('../config/logger');
const { invalidateChatCache } = require('../utils/chatCache');

const messageSchema = new mongoose.Schema({
    chat: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Chat',
        required: [true, "Chat ID is required for a message"],
        index: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, "Sender ID is required for a message"]
    },
    messageType: {
        type: String,
        enum: ['text', 'image', 'video', 'audio', 'file', 'system', 'notification'],
        required: true,
        default: 'text'
    },
    content: {
        type: String,
        required: function() { return this.messageType === 'text' || this.messageType === 'notification' || this.messageType === 'system'; },
        trim: true
    },
    fileUrl: {
        type: String,
        trim: true,
        required: function() { return ['image', 'video', 'audio', 'file'].includes(this.messageType); }
    },
    fileName: {
        type: String,
        trim: true,    
    },
    fileType: {
        type: String,
        trim: true,
    },
    fileSize: {
        type: Number,
    },
    metadata: {
        type: mongoose.Schema.Types.Mixed,
    },
    deliveredTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
    ],
    readBy: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    status: {
        type: String,
        enum: ['sending', 'sent', 'delivered', 'read', 'failed'],
        default: 'sent'
    }
}, { timestamps: true });

messageSchema.index({ chat: 1, createdAt: -1 });

messageSchema.post('save', async function(doc, next) {
    try {
        const Chat = mongoose.model('Chat');
        const chat = await Chat.findByIdAndUpdate(
            doc.chat,
            { latestMessage: doc._id, updatedAt: Date.now() },
            { new: true }
        ).select('participants');

        if (chat && Array.isArray(chat.participants)) {
            const participantIds = chat.participants.map(id => id.toString());
            await invalidateChatCache(participantIds);
        }
        next();
    } catch (error) {
        logger.error(`Error updating latestMessage in Chat from Message post-save hook for message ${doc._id}: ${error.message}`, error);
        //console.error(`Error updating latestMessage in Chat from Message post-save hook for message ${doc._id}: ${error.message}`, error);
        next(error);
    }
});

module.exports = mongoose.model('Message', messageSchema);