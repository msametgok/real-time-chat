const socketIo = require('socket.io');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { encrypt } = require('../utils/encryption');
const jwt = require('jsonwebtoken');
const redis = require('../config/redis');
const logger = require('../config/logger');
const User = require('../models/User');
require('dotenv').config();

const initializeSocket = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: "http://localhost:5173",
            methods: ["GET", "POST"]
        }
    });

    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        logger.info(`Received token: ${token ? 'valid' : 'missing'}`);
        if (!token) {
            logger.error('Socket authentication error: No token provided');
            return next(new Error('Authentication error: No token provided'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded;
            next();
        } catch (error) {
            logger.error(`Socket authentication error: ${error.message}`);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        logger.info(`New Client connected:, ${socket.id}, 'User:', ${socket.user?.userId || 'unknown'}`);

        socket.on('joinChat', async (chatId) => {
            logger.info(`User ${socket.user?.userId || 'unknown'} joining chat ${chatId}`);
            socket.join(chatId);
            await Message.updateMany(
                { chat: chatId, status: 'sent' },
                { status: 'delivered' }
            );
            io.to(chatId).emit('messageStatus', { chatId, status: 'delivered' });
            socket.emit('joinChatAck', { chatId });
        });

        socket.on('sendMessage', async ({ chatId, content }) => {
            try {
                const encryptedContent = encrypt(content);        
                const message = new Message({
                    chat: chatId,
                    sender: socket.user.userId,
                    content: encryptedContent,
                    status: 'sent'
                });
                await message.save();
                // Update latestMessage in Chat
                await Chat.findByIdAndUpdate(chatId, { latestMessage: message._id }, { new: true });
        
                const populatedMessage = await Message.findById(message._id)
                    .populate('sender', 'username')
                    .lean();
        
                io.to(chatId).emit('newMessage', populatedMessage);

                //Invalidate cache for all participants
                const chat = await Chat.findById(chatId);
                await Promise.all(chat.participants.map(id => invalidateChatCache(id.toString())));
            } catch (error) {
                logger.error(`Error processing sendMessage: ${error.message}`);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        socket.on('markMessagesRead', async ({ chatId }) => {
            try {
              await Message.updateMany(
                { chat: chatId, readBy: { $ne: socket.user.userId } },
                { $addToSet: { readBy: socket.user.userId } }
              );
              io.to(chatId).emit('messagesRead', { chatId, userId: socket.user.userId });
            } catch (error) {
              logger.error(`Error in markMessagesRead: ${error.message}`);
              socket.emit('error', { message: 'Failed to mark messages as read' });
            }
        });

        socket.on('typingStart', async (data) => {
            try {
                const { chatId } = data;
                const key = `user:${socket.user.userId}:typing:chat:${chatId}`;
                await redis.set(key, '1', 'EX', 5);
                const user = await User.findById(socket.user.userId).select('username');
                const username = user?.username || 'unknown';
                io.to(chatId).emit('typing', { userId: socket.user.userId, username });
            } catch (error) {
                logger.error(`Error in typingStart: ${error.message}`);
            }
        });

        socket.on('typingStop', async ({ chatId }) => {
            try {
                const key = `user:${socket.user.userId}:typing:chat:${chatId}`;
                await redis.del(key);
                io.to(chatId).emit('typing', { userId: socket.user.userId, stopped: true });
            } catch (error) {
                logger.error(`Error in typingStop: ${error.message}`);
            }
        });


        socket.on('disconnect', () => {
            logger.info(`Client disconnected: ${socket.id}`);
        });
    });

    return io;
};

module.exports = initializeSocket;

// Helper function to invalidate cache
const invalidateChatCache = async (userId) => {
    const cacheKey = `user:${userId}:chats`;
    await redis.del(cacheKey);
};