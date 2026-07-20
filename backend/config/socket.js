// backend/config/socket.js
const socketIo = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const logger = require('./logger');
const redis = require('./redis');
const { encrypt, decryptMessageDoc } = require('../utils/encryption');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
require('dotenv').config();

const initializeChatEventHandlers = require('../socketHandlers/chatEvents');
const initializeTypingEventHandlers = require('../socketHandlers/typingEvents');
const initializeStatusEventHandlers = require('../socketHandlers/statusEvents');
const initializeDisconnectHandlers = require('../socketHandlers/disconnectEvents');
const { invalidateChatCache } = require('../utils/chatCache');
const { computeDeliveredToAll, computeReadByAll } = require('../utils/messageStatus');
const { syncUserSockets } = require('../utils/presence');

// Held at module scope so non-socket code (HTTP controllers) can broadcast.
// Anything that reads this must tolerate `null` - it is unset until the server
// finishes booting, and stays unset in unit tests that require a controller
// without standing up Socket.IO.
let ioInstance = null;
const getIO = () => ioInstance;

/**
 * Per-chat cap on the tick-state replay performed at connect. The syncs below
 * used to be unbounded, so connect cost scaled with total message history -
 * and every millisecond of it ran before the socket's event handlers were
 * registered.
 */
const SYNC_MESSAGE_LIMIT = 50;

const initializeSocket = async (server) => {
  const io = socketIo(server, {
    cors: { origin: process.env.CLIENT_URL, methods: ['GET','POST'], credentials: true }
  });

  // Duplicate existing Redis client pub/sub
  const pubClient = redis.duplicate();
  const subClient = redis.duplicate();

  pubClient.on('connect', () => logger.info('pubClient connected to Redis'));
  pubClient.on('error', err => logger.error(`Redis pubClient error: ${err.message}`, err));

  subClient.on('connect', () => logger.info('subClient connected to Redis'));
  subClient.on('error', err => logger.error(`Redis subClient error: ${err.message}`, err));

  // Tell Socket.IO to use the Redis adapter
  io.adapter(createAdapter(pubClient, subClient));

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

      // 1) Register event handlers FIRST, before anything that awaits.
      //
      // They used to be registered last, after presence sync and an unbounded
      // delivery replay. Until that finished the socket had no listeners at
      // all, so anything the client emitted hit the floor - no error, no log,
      // no hint to the client. Measured at ~210ms on a near-empty account, and
      // it grew with message history because the replay ran inside the window.
      // The client emits straight into it: joinChat from the reconnect effect
      // fires inside its own 'connect' callback.
      //
      // Moving registration merely *earlier* was not enough - with a single
      // await still ahead of it the window shrank to ~17ms but an emit sent
      // from the client's connect callback was still dropped, every time.
      // Nothing may be awaited above this block: everything before the first
      // await runs in the same tick as the connection event, so a client emit
      // (which is at least one network hop away) can never outrun it.
      socket.join(`user-${userId}`); // synchronous
      const deps = { io, socket, logger, redis, User, Chat, Message, encrypt, decryptMessageDoc, invalidateChatCache };
      initializeChatEventHandlers(deps);
      initializeTypingEventHandlers(deps);
      initializeStatusEventHandlers(deps);
      initializeDisconnectHandlers(deps);

      socket.on('error', (err) => logger.error(`Socket Error [${userId}]: ${err.message}`, err));

      // 2) Prune stale sockets for presence
      const openCount = await syncUserSockets(io, redis, userId);
      logger.debug(`Presence pruning: user ${userId} has ${openCount} live sockets`);

      // 3) Auto-join all chat rooms.
      //    Note this now lands a few ms AFTER handler registration. The only
      //    handler that depends on room membership is typingEvents, which
      //    authorizes with socket.rooms.has(chatId) - so a typing event in that
      //    window would be ignored. It needs a keystroke to occur within a few
      //    ms of connecting, and the cost is one skipped indicator that the
      //    next keystroke repairs. Worth it to close the window above.
      const rooms = await Chat.find({ participants: userId }).select('_id participants').lean();
      rooms.forEach(({ _id }) => socket.join(_id.toString()));

      // 4) Initial presence sync for each other participant
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

      // 5) If first socket, broadcast own online status & sync deliveries
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
        // Sync undelivered messages. Bounded: this used to walk every
        // undelivered message ever, so a user returning after a long absence
        // paid for the whole backlog before their socket became usable.
        for (const { _id: chatId, participants } of rooms) {
          const undelivered = await Message.find({
            chat:        chatId,
            sender:      { $ne: userId },
            deliveredTo: { $ne: userId }
          })
            .sort({ createdAt: -1 })
            .limit(SYNC_MESSAGE_LIMIT)
            .select('_id sender deliveredTo').lean();
          for (const msg of undelivered) {
            const updated = await Message.findByIdAndUpdate(
              msg._id,
              { $addToSet: { deliveredTo: userId } },
              { new: true, select: 'sender deliveredTo' }
            ).lean();
            const deliveredToAll = computeDeliveredToAll(updated, participants);
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

      // 6. Sync missed delivery ticks for reconnecting user.
      //    `rooms` carries participants already - passing it avoids a
      //    Chat.findById per chat (and, before, per message).
      await syncMissedDeliveryEvents(socket, userId, rooms);

      // 7. Sync missed read-receipt events for reconnecting user
      await syncMissedReadReceipts(socket, userId, rooms);
    } catch (error) {
      logger.error(`Error in connection handler for socket ${socket.id}: ${error.message}`, error);
    }
  });

  ioInstance = io;
  logger.info('Socket.IO server initialized.');
  return io;
};

/**
 * Replay tick state the client may have missed while it was away.
 *
 * Both syncs take `rooms` ({_id, participants}) rather than bare chat ids: the
 * caller already has the participants, and looking them up again meant a
 * Chat.findById per chat - in the delivery sync, per *message*, since the query
 * sat inside the inner loop.
 *
 * Both are bounded to the most recent SYNC_MESSAGE_LIMIT per chat. They used to
 * replay every message ever delivered or read, unbounded, on every connect.
 * Older messages already carry the right ticks in the payload the client
 * fetches over HTTP, so replaying them added nothing.
 */
const syncMissedDeliveryEvents = async (socket, userId, rooms) => {
  try {
    for (const { _id: chatId, participants } of rooms) {
      const messages = await Message.find({
        chat: chatId,
        deliveredTo: userId,
        sender: { $ne: userId }
      })
        .sort({ createdAt: -1 })
        .limit(SYNC_MESSAGE_LIMIT)
        .select('_id deliveredTo sender').lean();

      for (const msg of messages) {
        socket.emit('messageDeliveryUpdate', {
          chatId,
          messageId: msg._id.toString(),
          deliveredToUserId: userId,
          deliveredToAll: computeDeliveredToAll(msg, participants)
        });
      }
    }
  } catch (err) {
    logger.error(`Error in delivery sync for user ${userId}: ${err.message}`, err);
  }
};

/**
 * Sync any read receipts this user may have missed while disconnected.
 */
const syncMissedReadReceipts = async (socket, userId, rooms) => {
  try {
    for (const { _id: chatId, participants } of rooms) {
      // Find messages in this chat that *this* user has marked as read in DB
      const msgs = await Message.find({
        chat: chatId,
        readBy: userId,
        sender: { $ne: userId }
      })
        .sort({ createdAt: -1 })
        .limit(SYNC_MESSAGE_LIMIT)
        .select('_id readBy sender').lean();

      for (const msg of msgs) {
        const readByAll = computeReadByAll(msg, participants);

        socket.emit('messagesReadUpdate', {
          chatId,
          reader: { userId, username: socket.user.username },
          messageIds: [msg._id.toString()],
          messagesReadByAll: readByAll ? [msg._id.toString()] : []
        });
      }
    }
  } catch (err) {
    logger.error(`Error in read‐receipt sync for user ${userId}: ${err.message}`, err);
  }
};

module.exports = { initializeSocket, getIO };
