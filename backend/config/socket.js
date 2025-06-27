// backend/config/socket.js
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const redis = require('./redis');
const { encrypt, decrypt } = require('../utils/encryption');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
require('dotenv').config();

const initializeChatEventHandlers = require('../socketHandlers/chatEvents');
const initializeTypingEventHandlers = require('../socketHandlers/typingEvents');
const initializeStatusEventHandlers = require('../socketHandlers/statusEvents');
const initializeDisconnectHandlers = require('../socketHandlers/disconnectEvents');

const invalidateChatCache = async (userIds) => {
  if (!Array.isArray(userIds)) userIds = [userIds].filter(Boolean);
  if (userIds.length === 0) return;
  try {
    await Promise.all(userIds.map(id => redis.del(`user:${id}:chats`)));
    logger.info(`Cache invalidated for users: ${userIds.join(', ')}`);
  } catch (error) {
    logger.error(`Error invalidating chat cache for users ${userIds.join(', ')}: ${error.message}`, error);
  }
};

const initializeSocket = (server) => {
  const io = socketIo(server, {
    cors: { origin: process.env.CLIENT_URL, methods: ['GET','POST'], credentials: true }
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication Error: No token provided.'));
    try {
      const { userId } = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(userId).lean();
      if (!user) return next(new Error('Authentication Error: User not found.'));
      socket.user = { userId: user._id.toString(), username: user.username };
      next();
    } catch (err) {
      next(new Error('Authentication Error: Invalid token.'));
    }
  });

  io.on('connection', async (socket) => {
    try {
      const { userId, username } = socket.user;

      // 1) Join personal room and prune stale sockets
      socket.join(`user-${userId}`);
      const socketKey = `userSockets:${userId}`;
      const liveSockets = await io.in(`user-${userId}`).allSockets();
      await redis.del(socketKey);
      if (liveSockets.size) await redis.sadd(socketKey, ...Array.from(liveSockets));
      const openCount = await redis.scard(socketKey);
      logger.debug(`Presence pruning: user ${userId} has ${openCount} live sockets`);

      // 2) Auto-join all chat rooms
      const rooms = await Chat.find({ participants: userId })
                               .select('_id participants')
                               .lean();
      rooms.forEach(({ _id }) => socket.join(_id.toString()));

      // 3) Initial presence sync for each other participant
      for (const { participants } of rooms) {
        if (Array.isArray(participants)) {
          for (const p of participants) {
            const pid = p.toString();
            if (pid === userId) continue;
            const count = await redis.scard(`userSockets:${pid}`);
            let status, lastSeen;
            if (count > 0) {
              status = 'online';
              lastSeen = null;
            } else {
              status = 'offline';
              const lastSeenStr = await redis.get(`userLastSeen:${pid}`);
              lastSeen = lastSeenStr || null;
            }
            socket.emit('userStatusUpdate', { userId: pid, onlineStatus: status, lastSeen });
          }
        }
      }

      // 4) If first socket, broadcast own online status & sync deliveries
      if (openCount === 1) {
        for (const { _id: chatId, participants } of rooms) {
          io.to(chatId.toString()).emit('userStatusUpdate', {
            chatId:       chatId.toString(),
            userId,
            username,
            onlineStatus: 'online',
            lastSeen:     null
          });
          io.to(chatId.toString()).emit('userConnectedToChat', {
            chatId:  chatId.toString(),
            userId,
            username
          });
        }
        // Sync undelivered messages
        for (const { _id: chatId, participants } of rooms) {
          const undelivered = await Message.find({
            chat:        chatId,
            sender:      { $ne: userId },
            deliveredTo: { $ne: userId }
          }).select('_id sender deliveredTo').lean();
          for (const msg of undelivered) {
            const updated = await Message.findByIdAndUpdate(
              msg._id,
              { $addToSet: { deliveredTo: userId } },
              { new: true, select: 'sender deliveredTo' }
            ).lean();
            const senderId = updated.sender.toString();
            const otherIds = participants.map(p => p.toString()).filter(i => i !== senderId);
            const deliveredToAll = otherIds.every(i => updated.deliveredTo.map(d => d.toString()).includes(i));
            io.to(chatId.toString()).emit('messageDeliveryUpdate', {
              chatId,
              messageId:         msg._id.toString(),
              deliveredToUserId: userId,
              deliveredToAll
            });
          }
        }
        logger.info(`User ${username} is now online in ${rooms.length} chats`);
      }

      // 5) Register event handlers
      const deps = { io, socket, logger, redis, User, Chat, Message, encrypt, decrypt, invalidateChatCache };
      initializeChatEventHandlers(deps);
      initializeTypingEventHandlers(deps);
      initializeStatusEventHandlers(deps);
      initializeDisconnectHandlers(deps);

      socket.on('error', (err) => logger.error(`Socket Error [${userId}]: ${err.message}`, err));
    } catch (error) {
      logger.error(`Error in connection handler for socket ${socket.id}: ${error.message}`, error);
    }
  });

  logger.info('Socket.IO server initialized.');
  return io;
};

module.exports = initializeSocket;
