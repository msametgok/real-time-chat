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
    },
    /**
     * Canonical identity of a 1-on-1 chat: both participant ids, sorted, joined
     * by a colon. Null for group chats.
     *
     * It exists to carry a unique index. Indexing `participants` directly would
     * not work - it's an array, so the index is multikey and `unique` applies
     * to each ELEMENT, which would mean a user could belong to exactly one
     * 1-on-1 chat ever. Sorting is what makes [a,b] and [b,a] the same key.
     */
    pairKey: {
        type: String,
        default: null
    }
}, { timestamps: true

});

chatSchema.index({ participants: 1 });
chatSchema.index({ isGroupChat: 1, participants: 1 });
chatSchema.index({ isGroupChat: 1, updatedAt: -1 });

// The actual guard against duplicate 1-on-1 chats. Partial so group chats
// (pairKey null) are not indexed at all and don't collide with each other.
chatSchema.index(
    { pairKey: 1 },
    { unique: true, partialFilterExpression: { pairKey: { $type: 'string' } } }
);

/** Both ids sorted and joined, or null when this isn't a 1-on-1 chat. */
chatSchema.statics.buildPairKey = function (participants = []) {
    if (participants.length !== 2) return null;
    return participants.map(p => (p?._id || p).toString()).sort().join(':');
};

chatSchema.pre('validate', function(next) {
    if (!this.isGroupChat && this.participants.length !== 2) {
        return next(new Error('1-on-1 chats must have exactly two participants.'));
    }
    if (this.isGroupChat && this.participants.length < 2) { // Groups typically need at least 2, creator + 1 other
        return next(new Error('Group chats must have at least two participants.'));
    }

    // Derived here so every creation path gets it - including scripts that
    // build a Chat directly rather than going through the controller.
    this.pairKey = this.isGroupChat
        ? null
        : this.constructor.buildPairKey(this.participants);

    next();
});

module.exports = mongoose.model('Chat', chatSchema);