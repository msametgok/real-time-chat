const {body, param, query} = require('express-validator');
const { handleValidation } = require('../utils/validate');
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const redis = require('../config/redis');
const logger = require('../config/logger');
const { decryptMessageDoc } = require('../utils/encryption');
const { invalidateChatCache } = require('../utils/chatCache');
const { getIO } = require('../config/socket');
const { isParticipant, findChatForParticipant } = require('../utils/chatAuth');

const formatChatResponse = (chat, currentUserId) => {
    if (!chat) return null;

    // Ensure chat is a plain object for modification, works with Mongoose docs and lean objects
    const chatObject = (typeof chat.toJSON === 'function') ? chat.toJSON() : { ...chat };

    if (!chatObject.isGroupChat && chatObject.participants && chatObject.participants.length === 2) {
        const otherParticipant = chatObject.participants.find( p => p && p._id && p._id.toString() !== currentUserId.toString());
        if (otherParticipant) {
            chatObject.displayChatName = otherParticipant.username;
            chatObject.chatAvatar = otherParticipant.avatar;
        } else {
            chatObject.displayChatName = 'User';
            chatObject.chatAvatar = null;
        }
    } else if (chatObject.isGroupChat) {
        chatObject.displayChatName = chatObject.chatName;
        chatObject.chatAvatar = chatObject.groupAvatarUrl;
    }

    // Previously this caught the failure, logged it, and left the ciphertext
    // in place - so an undecryptable message rendered as a base64 blob in the
    // sidebar. decryptMessageDoc substitutes a placeholder instead.
    if (chatObject.latestMessage) {
        chatObject.latestMessage = decryptMessageDoc(chatObject.latestMessage);
    }

    return chatObject;
}

/**
 * Tell every participant a chat now exists. Creation happens over HTTP, so
 * without this the others have no idea until they reload - and their sockets
 * never join the new room either (the client rejoins on chat-list change, so
 * prepending the chat is enough to trigger it).
 *
 * The creator is included deliberately. Their originating tab already has the
 * chat from the HTTP response and ignores this via the dedupe in
 * handleNewChat, but their OTHER tabs and devices have no other way to learn
 * about it - `user-<id>` is a fan-out room across every socket that user has
 * open. Skipping them left those sessions blind until a manual reload.
 *
 * Payload is built per recipient because formatChatResponse resolves
 * displayChatName/chatAvatar relative to the viewer.
 *
 * Best-effort: a socket failure must not fail the HTTP request that just
 * successfully created the chat.
 */
const emitNewChat = (populatedChat) => {
    try {
        const io = getIO();
        if (!io) return;

        for (const participant of populatedChat.participants || []) {
            const pid = (participant?._id || participant).toString();
            io.to(`user-${pid}`).emit('newChat', formatChatResponse(populatedChat, pid));
        }
    } catch (error) {
        logger.error(`Failed to emit newChat for chat ${populatedChat?._id}: ${error.message}`, error);
    }
};

exports.createOneOnOneChat = [

    body('otherUserId')
        .trim()
        .notEmpty().withMessage('otherUserId is required')
        .isMongoId().withMessage('Invalid ID format'),
    handleValidation,

    async (req, res) => {

        const currentUserId = req.user.userId;
        const { otherUserId } = req.body;

        if(currentUserId === otherUserId) {
            return res.status(400).json({ message: 'Cannot create chat with self' });
        }

        try {
            // Check if other user exists
            const otherUser = await User.findById(otherUserId);
            if (!otherUser) {
                return res.status(404).json({ message: 'The other user not found' });
            }

            const participants = [ currentUserId, otherUserId ].sort();
            const pairKey = Chat.buildPairKey(participants);

            // Find-or-create in ONE atomic operation. This was previously a
            // findOne followed by a save: two requests arriving together both
            // saw "no chat" and both created one, leaving the pair with
            // duplicate conversations and messages split between them. The
            // unique partial index on pairKey is what makes this safe - upsert
            // alone still races, it just loses more rarely.
            const result = await Chat.findOneAndUpdate(
                { pairKey },
                { $setOnInsert: { isGroupChat: false, participants, pairKey } },
                {
                    upsert: true,
                    new: true,
                    setDefaultsOnInsert: true,
                    // Returns { value, lastErrorObject, ok } instead of the bare
                    // document, so we can tell insert from match and keep the
                    // status code and socket emit correct. This is Mongoose 8's
                    // name for it - the old `rawResult` is silently ignored
                    // here, which yields an undefined `.value`.
                    includeResultMetadata: true
                }
            );

            const created = !result.lastErrorObject?.updatedExisting;
            const chatId = result.value._id;

            const populatedChat = await Chat.findById(chatId)
                .populate('participants', 'username email avatar')
                .populate({
                    path: 'latestMessage',
                    populate: { path: 'sender', select: 'username avatar' }
                });

            const formatted = formatChatResponse(populatedChat, currentUserId);

            if (!created) {
                return res.status(200).json({ message: 'Chat already exists', chat: formatted });
            }

            await invalidateChatCache(participants);
            emitNewChat(populatedChat);
            res.status(201).json({ message: 'Chat created successfully', chat: formatted });
        } catch (error) {
            // The loser of a genuine race: the index rejected the duplicate
            // insert. The chat exists now, so answer as if we had found it.
            if (error.code === 11000) {
                const existing = await Chat.findOne({
                    pairKey: Chat.buildPairKey([currentUserId, otherUserId].sort())
                })
                    .populate('participants', 'username email avatar')
                    .populate({
                        path: 'latestMessage',
                        populate: { path: 'sender', select: 'username avatar' }
                    });

                if (existing) {
                    return res.status(200).json({
                        message: 'Chat already exists',
                        chat: formatChatResponse(existing, currentUserId)
                    });
                }
            }

            logger.error(`Error creating chat: ${error.message}`, error);
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: error.message });
            }
            res.status(500).json({ message: 'Server error while creating chat' });
        }
    }
]

// Create Group Chat
exports.createGroupChat = [
    // Validate group chat name
    body('chatName').trim().isLength({ min: 1, max: 100 })
        .withMessage('Group chat name must be between 1 and 100 characters'),
    // Validate participant IDs
    body('participantIds').isArray({min: 1})
        .withMessage('At least one other participant is required for a group chat')
        .custom( value => value.every( id => mongoose.Types.ObjectId.isValid(id)))
        .withMessage('Invalid participant ID format found in the list'),
    handleValidation,

    async (req, res) => {

        const currentUserId = req.user.userId;
        const { chatName, participantIds } = req.body;

        const uniqueOtherParticipantIds = [...new Set(participantIds.filter(id => id !== currentUserId))];

        if (uniqueOtherParticipantIds.length < 1) {
            return res.status(400).json({ message: 'At least one other participant is required for a group chat' });
        }

        const allParticipants = [currentUserId, ...uniqueOtherParticipantIds];

        try {
            const users = await User.find({ _id: { $in: uniqueOtherParticipantIds } });
            if (users.length !== uniqueOtherParticipantIds.length) {
                return res.status(404).json({ message: 'One or more participant users not found' });
            }

            const newGroupChat = new Chat({
                isGroupChat: true,
                chatName,
                participants: allParticipants,
                groupAdmin: currentUserId
            })
            await newGroupChat.save();

            // Populate for response
            const populatedChat = await Chat.findById(newGroupChat._id)
                .populate('participants', 'username email avatar onlineStatus')
                .populate('groupAdmin', 'username email avatar onlineStatus')
            const formattedChat = formatChatResponse(populatedChat, currentUserId);

            // Invalidate cache for all participants
            await invalidateChatCache(allParticipants);
            emitNewChat(populatedChat);

            res.status(201).json({ message: 'Group chat created successfully', chat: formattedChat });
        } catch (error) {
            logger.error(`Error creating group chat: ${error.message}`, error);
            if (error.name === 'ValidationError') {
                return res.status(400).json({ message: error.message });
            }
            res.status(500).json({ message: 'Server error while creating group chat' });
        }
    }  
]

exports.getUserChats = [
    async (req, res) => {
        const currentUserId = req.user.userId;
        const cacheKey = `user:${currentUserId}:chats`;

        try {
            // Try to fetch from cache first
            const cachedChats = await redis.get(cacheKey);
            if (cachedChats) {
                logger.info(`Serving chats for user ${currentUserId} from cache.`);
                return res.status(200).json(JSON.parse(cachedChats));
            }

            logger.info(`Fetching chats for user ${currentUserId} from DB.`);
            // Fetch chats from DB where the current user is a participant
            const chats = await Chat.find({ participants: currentUserId })
                .populate('participants', 'username email avatar onlineStatus') // Populate participant details
                .populate({ // Populate latest message and its sender
                    path: 'latestMessage',
                    populate: { path: 'sender', select: 'username avatar' }
                })
                .populate('groupAdmin', 'username avatar') // Populate admin for group chats
                .sort({ updatedAt: -1 }) // Order by most recently updated
                .lean();

            const formattedChats = chats.map(chat => formatChatResponse(chat, currentUserId));

            // Store the result in Redis cache for 5 minutes (300 seconds)
            await redis.set(cacheKey, JSON.stringify(formattedChats), 'EX', 300);

            res.status(200).json(formattedChats);
        } catch (error) {
            logger.error(`Error fetching user chats for ${currentUserId}: ${error.message}`, error);
            res.status(500).json({ message: 'Server error while fetching chats.' });
        }
    }
];

// Get Messages for a Specific Chat
exports.getChatMessages = [
    // Validate chatId from URL parameter
    param('chatId').isMongoId().withMessage('Invalid Chat ID format.'),
    // Validate optional 'before' query parameter (ISO8601 timestamp string)
    query('before').optional().isISO8601().withMessage('Invalid "before" timestamp format. Please use ISO8601.').toDate(),
    // Validate 'limit' for number of messages to fetch
    query('limit').optional().isInt({ min: 1, max: 50 }).toInt().withMessage('Limit must be an integer between 1 and 50.'),
    handleValidation,

    async (req, res) => {

        const { chatId } = req.params;
        const currentUserId = req.user.userId;
        
        // Cursor for fetching messages created 'before' this timestamp
        const beforeTimestamp = req.query.before; // This will be a Date object if valid, or undefined
        // Number of messages to fetch per request
        const limit = req.query.limit || 20; // Default to 20 messages

        try {
            // Verify the current user is a participant of the chat
            const chat = await findChatForParticipant(Chat, chatId, currentUserId);
            if (!chat) {
                return res.status(403).json({ message: 'Access Denied: You are not a participant of this chat or chat does not exist.' });
            }

            // Construct the query for messages
            const messageQuery = { chat: chatId };
            if (beforeTimestamp) {
                // If 'before' timestamp is provided, fetch messages older than it
                messageQuery.createdAt = { $lt: beforeTimestamp };
            }

            const messages = await Message.find(messageQuery)
                .populate('sender', 'username avatar')
                .sort({ createdAt: -1 }) // Fetch in reverse chronological order (newest of the older batch first)
                .limit(limit)
                .lean();

            // Decrypt message content
            const decryptedMessages = messages.map(decryptMessageDoc);

            res.status(200).json({
                messages: decryptedMessages,
            });

        } catch (error) {
            logger.error(`Error fetching messages for chat ${chatId}: ${error.message}`, error);
            res.status(500).json({ message: 'Server error while fetching messages.' });
        }
    }
];

exports.getChatDetails = [
    param('chatId').isMongoId().withMessage('Invalid Chat ID format.'),
    handleValidation,
    async (req, res) => {
        const { chatId } = req.params;
        const currentUserId = req.user.userId;

        try {
            const chat = await Chat.findOne({ _id: chatId, participants: currentUserId })
                .populate('participants', 'username email avatar onlineStatus')
                .populate({
                    path: 'latestMessage',
                    populate: { path: 'sender', select: 'username avatar' }
                })
                .populate('groupAdmin', 'username avatar')
                .lean();

            if (!chat) {
                return res.status(404).json({ message: 'Chat not found or you are not a participant.' });
            }
            
            // Format the chat response (handles 1-on-1 naming/avatars, message decryption)
            const formattedChat = formatChatResponse(chat, currentUserId);
            res.status(200).json(formattedChat);

        } catch (error) {
            logger.error(`Error fetching chat details for ${chatId}: ${error.message}`, error);
            res.status(500).json({ message: 'Server error while fetching chat details.' });
        }
    }
];

// 6. Delete a Chat (for 1-on-1) or Leave a Group Chat
exports.deleteOrLeaveChat = [
    param('chatId').isMongoId().withMessage('Invalid Chat ID format.'),
    handleValidation,
    async (req, res) => {

        const { chatId } = req.params;
        const currentUserId = req.user.userId;

        try {
            const chat = await Chat.findById(chatId);

            if (!chat) {
                return res.status(404).json({ message: 'Chat not found.' });
            }

            // Not findChatForParticipant: this handler mutates the chat and
            // saves it, so it needs a hydrated document, not a lean object.
            if (!isParticipant(chat, currentUserId)) {
                return res.status(403).json({ message: 'Access Denied: You are not a participant of this chat.' });
            }

            const initialParticipantsStrings = chat.participants.map(p_obj => p_obj.toString());

            if (chat.isGroupChat) {
                // Logic for leaving a group chat
                // Filter out the current user using .equals() for ObjectId comparison
                chat.participants = chat.participants.filter(p_obj => !p_obj.equals(currentUserId));

                if (chat.participants.length < 1) { // Or < 2 if groups must have at least 2 members
                    // If this was the last participant, delete the group chat entirely
                    await Message.deleteMany({ chat: chatId }); // chatId (string) will be cast
                    await Chat.findByIdAndDelete(chatId);       // chatId (string) will be cast
                    await invalidateChatCache(initialParticipantsStrings); // Invalidate cache for all original participants
                    return res.status(200).json({ message: 'Group chat deleted as the last participant left.' });
                } else {
                    // If the admin is leaving, reassign admin role
                    // chat.groupAdmin is an ObjectId instance.
                    if (chat.groupAdmin && chat.groupAdmin.equals(currentUserId)) {
                        chat.groupAdmin = chat.participants[0]; // Assign to the first in the new list
                    }
                    await chat.save();
                    await invalidateChatCache(initialParticipantsStrings); // Invalidate cache for original participants
                    return res.status(200).json({ message: 'Successfully left the group chat.' });
                }
            } else {
                // For 1-on-1 chats, deleting it means deleting for both users.
                await Message.deleteMany({ chat: chatId }); // chatId (string) will be cast
                await Chat.findByIdAndDelete(chatId);       // chatId (string) will be cast
                await invalidateChatCache(initialParticipantsStrings);
                return res.status(200).json({ message: '1-on-1 chat deleted successfully.' });
            }
        } catch (error) {
            logger.error(`Error deleting/leaving chat ${chatId}: ${error.message}`, error);
            res.status(500).json({ message: 'Server error while deleting or leaving chat.' });
        }
    }
];

// --- Placeholder for future functionalities ---
// exports.updateGroupChatDetails = [ /* ... */ ]; // e.g., rename group, change group avatar
// exports.addParticipantToGroup = [ /* ... */ ];
// exports.removeParticipantFromGroup = [ /* ... */ ]; // Admin action
