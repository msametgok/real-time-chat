const {body, param, query, validationResult} = require('express-validator');
const mongoose = require('mongoose');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const redis = require('../config/redis');
const logger = require('../config/logger');
const { decrypt } = require('../utils/encryption');

// Helper function to invalidate cache
const invalidateChatCache = async (userIds) => {
    if (!Array.isArray(userIds)) {
        userIds = [userIds];
    }
    try {
        const promises = userIds.map(id => {
            if (id) {
                const cacheKey = `user:${id.toString()}:chats`;
                return redis.del(cacheKey);
            }
            return Promise.resolve();
        });
        await Promise.all(promises);
        logger.info(`Chat cache invalidated for users: ${userIds.filter(id => id).join(', ')}`);
    } catch (error) {
        logger.error(`Error invalidating cache for user: ${userIds.filter(id => id).join(', ')}: ${error.message}`, error);
    }
}

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

    if (chatObject.latestMessage && chatObject.latestMessage.content && chatObject.latestMessage.messageType === 'text') {
        try {
            chatObject.latestMessage.content = decrypt(chatObject.latestMessage.content);
        } catch (e) {
            logger.warn(`Failed to decrypt latestMessage content for chat ${chatObject._id}: ${e.message}`);
        }
    }

    return chatObject;
}

exports.createOneOnOneChat = [

    body('otherUserId')
        .trim()
        .notEmpty().withMessage('otherUserId is required')
        .isMongoId().withMessage('Invalid ID format'),

    async (req, res) => {
        const errors = validationResult(req);
        if(!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({onlyFirstError: true}) });
        }

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

            // Check if chat already exists
            let chat = await Chat.findOne({
                isGroupChat: false,
                participants: { $all: participants, $size: 2 }
            })

            if (chat) {
                // If chat exists, return it
                chat = await Chat.findById(chat._id)
                    .populate('participants', 'username email avatar onlineStatus')
                    .populate({
                        path: 'latestMessage',
                        populate: { path: 'sender', select: 'username avatar' }
                    });

                const formatted = formatChatResponse(chat, currentUserId);
                return res.status(200).json({message: 'Chat already exists', chat: formatted });
            }

            // If chat does not exist create new  1-on-1 chat

            const newChat = new Chat({
                isGroupChat: false,
                participants
            });

            await newChat.save();

            const populatedChat = await Chat.findById(newChat._id)
                .populate('participants', 'username email avatar onlineStatus');
            
            const formattedNewChat = formatChatResponse(populatedChat, currentUserId);

            await invalidateChatCache(participants);
            res.status(201).json({ message: 'Chat created successfully', chat: formattedNewChat });
        } catch (error) {
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
        
    async (req, res) => {
        const errors = validationResult(req);
        if(!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({onlyFirstError: true}) });
        }

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

    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({ onlyFirstError: true }) });
        }

        const { chatId } = req.params;
        const currentUserId = req.user.userId;
        
        // Cursor for fetching messages created 'before' this timestamp
        const beforeTimestamp = req.query.before; // This will be a Date object if valid, or undefined
        // Number of messages to fetch per request
        const limit = req.query.limit || 20; // Default to 20 messages

        try {
            // Verify the current user is a participant of the chat
            const chat = await Chat.findOne({ _id: chatId, participants: currentUserId });
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

            // Decrypt text message content
            const decryptedMessages = messages.map(msg => {
                let content = msg.content;
                if (msg.messageType === 'text' && msg.content) {
                    try {
                        content = decrypt(msg.content);
                    } catch (e) {
                        logger.warn(`Failed to decrypt message content for msg ${msg._id} in chat ${chatId}: ${e.message}`);
                        content = "[Content decryption failed]"; // Fallback content
                    }
                }
                return { ...msg, content };
            });

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
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({ onlyFirstError: true }) });
        }
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
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array({ onlyFirstError: true }) });
        }

        const { chatId } = req.params;
        const currentUserId = req.user.userId;

        try {
            const chat = await Chat.findById(chatId);

            if (!chat) {
                return res.status(404).json({ message: 'Chat not found.' });
            }

            if (!chat.participants.some(p_obj => p_obj.equals(currentUserId))) {
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
