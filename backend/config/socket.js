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
    if (!Array.isArray(userIds)) userIds = [userIds].filter(Boolean);
    if (userIds.length === 0) return;

    try {
        await Promise.all(userIds.map(id => redis.del(`user:${id}:chats`)));
        logger.info(`Cache invalidated for users: ${userIds.join(', ')}`);
    } catch (error) {
        logger.error(`Socket: Error invalidating chat cache for users ${userIds.join(', ')}: ${error.message}`, error);
    }
};


const initializeSocket = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: process.env.CLIENT_URL,
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
io.on('connection', async (socket) => {
  try {
    const { userId, username } = socket.user;

    // ─── Join a personal room for this user ───
    // Allows us to ask “who’s online?” via io.in(`user-${userId}`).allSockets()
    socket.join(`user-${userId}`);

    const socketKey = `userSockets:${userId}`;

    // Fetch *all* live socket IDs from Socket.IO
    const liveSockets = await io.in(`user-${userId}`).allSockets();

    // Overwrite Redis with the truly live ones
    await redis.del(socketKey);
    if (liveSockets.size) {
      await redis.sadd(socketKey, ...Array.from(liveSockets));
    }
    const openCount = await redis.scard(socketKey);

    console.log(openCount, socketKey);

    if (openCount === 1) {
  // 1) Fetch every chat and its participants
  const rooms = await Chat.find({ participants: userId })
                          .select('_id participants')
                          .lean();

  // 2) Broadcast “online” / “joined” status
  rooms.forEach(({ _id }) => {
    io.to(_id.toString()).emit('userStatusUpdate', {
      chatId:       _id.toString(),
      userId,
      username,
      onlineStatus: 'online',
      lastSeen:     null
    });
    io.to(_id.toString()).emit('userConnectedToChat', {
      chatId:  _id.toString(),
      userId,
      username
    });
  });

  // 3) Sync all undelivered messages for this user
  for (const { _id: chatId, participants } of rooms) {
    // a) find messages they haven’t yet delivered
    const undelivered = await Message.find({
      chat:        chatId,
      sender:      { $ne: userId },
      deliveredTo: { $ne: userId }
    })
    .select('_id sender deliveredTo')
    .lean();

    // b) for each, add them to deliveredTo and emit update
    for (const msg of undelivered) {
      const updated = await Message.findByIdAndUpdate(
        msg._id,
        { $addToSet: { deliveredTo: userId } },
        { new: true, select: 'sender deliveredTo' }
      ).lean();

      // c) check if now delivered to all other participants
      const senderId = updated.sender.toString();
      const otherIds = participants
        .map(p => p.toString())
        .filter(id => id !== senderId);
      const deliveredToAll = otherIds.every(id =>
        updated.deliveredTo.map(d => d.toString()).includes(id)
      );

      // d) emit exactly the same event your client listens for
      io.to(chatId.toString()).emit('messageDeliveryUpdate', {
        chatId,
        messageId:         msg._id.toString(),
        deliveredToUserId: userId,
        deliveredToAll
      });
    }
  }

  logger.info(`Online broadcast for ${username}`);
}

    // Auto-join all chat rooms
    const userChats = await Chat.find({ participants: userId }).select('_id').lean();
    userChats.forEach(({ _id }) => socket.join(_id.toString()));
    logger.info(`User ${username} auto-joined ${userChats.length} rooms`);

    // Package dependencies for event handlers
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
      invalidateChatCache
    };

    // Register all the handlers
    initializeChatEventHandlers(handlerDependencies);
    initializeTypingEventHandlers(handlerDependencies);
    initializeStatusEventHandlers(handlerDependencies);
    initializeDisconnectHandlers(handlerDependencies);

    socket.on('error', (error) => {
      logger.error(`Socket Error for user ${userId} on socket ${socket.id}: ${error.message}`, error);
    });
  } catch (error) {
    logger.error(`Error in connection handler for socket ${socket.id}: ${error.message}`, error);
  }
});

    logger.info('Socket.IO server initialized and authentication middleware configured.');
    return io;
};

module.exports = initializeSocket;
