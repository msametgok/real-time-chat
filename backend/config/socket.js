const socketIo = require('socket.io');
const Message = require('../models/Message');

const initializeSocket = (server) => {
    const io = socketIo(server, {
        cors: {
            origin: "*", // Allow all origins (or specify your frontend URL, e.g., "http://localhost:3000")
            methods: ["GET", "POST"]
        }
    });

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
                
                //Save message to database
                const message = new Message({
                    chat: chatId,
                    sender: userId,
                    content
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