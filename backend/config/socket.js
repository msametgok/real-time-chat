const socketIo = require('socket.io');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { encrypt } = require('../utils/encryption');
const jwt = require('jsonwebtoken');
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
        console.log('Authenticating with token:', token || 'No token provided');
        if (!token) {
            console.error('No token provided');
            return next(new Error('Authentication error: No token provided'));
        }
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Token verified, user:', decoded.userId);
            socket.user = decoded;
            next();
        } catch (error) {
            console.error('Token verification error:', error.message);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket) => {
        console.log('New Client connected:', socket.id, 'User:', socket.user.userId);

        socket.on('joinChat', (chatId) => {
            console.log(`User ${socket.user.userId} joining chat ${chatId}`);
            socket.join(chatId);
        });

        socket.on('sendMessage', async ({ chatId, content }) => {
            console.log('Received sendMessage:', { chatId, content });
            try {
                const encryptedContent = encrypt(content);
                console.log('Encrypted on backend:', encryptedContent);
        
                const message = new Message({
                    chat: chatId,
                    sender: socket.user.userId,
                    content: encryptedContent
                });
                await message.save();
                console.log('Message saved:', message._id);
        
                const populatedMessage = await Message.findById(message._id)
                    .populate('sender', 'username')
                    .lean();
        
                console.log('Broadcasting message:', populatedMessage);
                io.to(chatId).emit('newMessage', populatedMessage);
            } catch (error) {
                console.error('Error processing sendMessage:', error.message);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });

    return io;
};

module.exports = initializeSocket;