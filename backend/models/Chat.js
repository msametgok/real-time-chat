const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema({
    participants: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    }],
    chatName: {
        type: String,
        trim: true,
        required: function() { return this.isGroupChat; }
    },
    isGroupChat: {
        type: Boolean,
        required: true,
        default: false
    },
    latestMessage: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Message',
        default: null,
    },
    groupAdmin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() { return this.isGroupChat; }
    },
    groupAvatarUrl: {
        type: String,
        trim: true,
        default: null
    }
}, { timestamps: true 

});

chatSchema.index({ participants: 1 });
chatSchema.index({ isGroupChat: 1, participants: 1 });
chatSchema.index({ isGroupChat: 1, updatedAt: -1 });

chatSchema.pre('validate', function(next) {
    if (!this.isGroupChat && this.participants.length !== 2) {
        return next(new Error('1-on-1 chats must have exactly two participants.'));
    }
    if (this.isGroupChat && this.participants.length < 2) { // Groups typically need at least 2, creator + 1 other
        return next(new Error('Group chats must have at least two participants.'));
    }
    next();
});

module.exports = mongoose.model('Chat', chatSchema);