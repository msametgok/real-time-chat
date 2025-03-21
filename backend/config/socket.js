const socketIo = require('socket.io');
const Message = require('../models/Message');
const Chat = require('../models/Chat');
const { encrypt } = require('../utils/encryption');

const initializeSocket = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: "*", // Allow all origins (or specify your frontend URL, e.g., "http://localhost:3000")
            methods: ["GET", "POST"]
        }
    });

    // Middleware to authenticate Socket connections
    io.use((socket, next) => {
        const token = socket.handshake.auth.token; //Expect token from client
        if(!token) {
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = decoded; // Attach user info to socket
            next(); 
        } catch (error) {
            next(new Error('Authentication error: Invalid token'));
        }

    })

    io.on('connection', (socket) => {
        console.log('New Client connected:', socket.id);

        //Join a chat room based on chatId
        socket.on('joinChat', (chatId) => {
            socket.join(chatId);
            console.log(`Client ${socket.id} joined chat ${chatId}`);
        });

        //Handle sending messages
        socket.on('SendMessage', async ({chatId, userId, content}) => {
            try {
                //Encrypt the message content
                const encryptedContent = encrypt(content);
                //Save message to database
                const message = new Message({
                    chat: chatId,
                    sender: userId,
                    content : encryptedContent
                });
                await message.save();

                //Populate sender info for the response
                const populatedMessage = await Message.findById(message._id)
                    .populate('sender', 'username')
                    .lean();

                //Broadcast the message to the chat room
                io.to(chatId).emit('newMessage', populatedMessage);

            } catch (error) {
                console.error('Error sending message:', error);
                socket.emit('error', { message: 'Failed to send message' });
            }
        })

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        })
    })

    return io;
}

module.exports = initializeSocket;