const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./logger'); // Adjust path as needed
const redis = require('./redis');   // Adjust path as needed
const { encrypt, decrypt } = require('../utils/encryption'); // Adjust path
const User = require('../models/User'); // Adjust path
const Chat = require('../models/Chat'); // Adjust path
const Message = require('../models/Message'); // Adjust path
require('dotenv').config();

// Import event handler modules (we'll create these next)
const initializeChatEventHandlers = require('../socketHandlers/chatEvents');
const initializeTypingEventHandlers = require('../socketHandlers/typingEvents');
const initializeStatusEventHandlers = require('../socketHandlers/statusEvents'); // For read/delivered
const initializeDisconnectHandlers = require('../socketHandlers/disconnectEvents');

// Helper function to invalidate chat cache
const invalidateChatCache = async (userIds) => {
    if (!Array.isArray(userIds)) {
        userIds = [userIds].filter(id => id); // Filter out null/undefined
    } else {
        userIds = userIds.filter(id => id);
    }
    if (userIds.length === 0) return;

    try {
        const promises = userIds.map(id => {
            const cacheKey = `user:${id.toString()}:chats`;
            return redis.del(cacheKey);
        });
        await Promise.all(promises);
        logger.info(`Socket: Chat cache invalidated for users: ${userIds.join(', ')}`);
    } catch (error) {
        logger.error(`Socket: Error invalidating chat cache for users ${userIds.join(', ')}: ${error.message}`, error);
    }
};


const initializeSocket = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: process.env.CLIENT_URL || "http://localhost:5173", // Use env variable from your frontend
            methods: ["GET", "POST"],
            credentials: true
        },
    });

    // Middleware for Socket.IO authentication
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token; // Client should send token in `socket.handshake.auth.token`
        logger.info(`Socket connection attempt. Token present: ${token ? 'Yes' : 'No'}`);

        if (!token) {
            logger.error('Socket Auth Error: No token provided.');
            return next(new Error('Authentication Error: No token provided.'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            // Fetch the user from DB to ensure they still exist
            const user = await User.findById(decoded.userId).lean();
            if (!user) {
                logger.error(`Socket Auth Error: User ${decoded.userId} not found.`);
                return next(new Error('Authentication Error: User not found.'));
            }
            socket.user = { // Attach user info to the socket object for use in event handlers
                userId: user._id.toString(),
                username: user.username,
            };
            logger.info(`Socket authenticated for user: ${socket.user.userId} (${socket.user.username})`);
            next();
        } catch (error) {
            logger.error(`Socket Auth Error: Invalid token. ${error.message}`);
            next(new Error('Authentication Error: Invalid token.'));
        }
    });

    // Main connection event
    io.on('connection', (socket) => {
        logger.info(`New client connected: ${socket.id}, User: ${socket.user.username} (ID: ${socket.user.userId})`);

        // Package all dependencies for handlers
        const handlerDependencies = {
            io,
            socket,
            logger,
            redis,
            User,
            Chat,
            Message,
            encrypt,
            decrypt,
            invalidateChatCache // Pass the cache invalidation helper
        };

        // Register event handlers from separate modules
        initializeChatEventHandlers(handlerDependencies);
        initializeTypingEventHandlers(handlerDependencies);
        initializeStatusEventHandlers(handlerDependencies);
        initializeDisconnectHandlers(handlerDependencies);

        // Example: A simple ping-pong to check connection
        socket.on('ping', (callback) => {
            logger.info(`Ping received from ${socket.user.username}. Responding with pong.`);
            if (typeof callback === 'function') {
                callback('pong');
            }
        });

        socket.on('error', (error) => {
            logger.error(`Socket Error for user ${socket.user?.userId} on socket ${socket.id}: ${error.message}`, error);
        });
    });

    logger.info('Socket.IO server initialized and authentication middleware configured.');
    return io;
};

module.exports = initializeSocket;
