module.exports = ({ io, socket, logger, redis, User, Chat }) => {

     //This event is automatically emitted by Socket.IO when a client connection is lost.
    socket.on('disconnect', async (reason) => {
 
        if (!socket.user || !socket.user.userId || !socket.user.username) {
            logger.warn(`Socket ${socket.id} disconnected without full user information. Reason: ${reason}. This might happen if connection dropped before auth completed.`);
            return;
        }

        const userId = socket.user.userId;
        const username = socket.user.username;

        logger.info(`User ${username} (ID: ${userId}, Socket: ${socket.id}) disconnected. Reason: ${reason}`);

        try {
            // 1. Update user's online status and lastSeen in the database
            const lastSeenTime = new Date();
            const updatedUser = await User.findByIdAndUpdate(
                userId,
                { $set: { onlineStatus: 'offline', lastSeen: lastSeenTime } },
                { new: true } // Option to return the updated document
            ).lean();

            if (updatedUser) {
                logger.info(`User ${username} (ID: ${userId}) status updated to 'offline', lastSeen set to ${lastSeenTime.toISOString()}.`);
            } else {
                logger.warn(`User ${username} (ID: ${userId}) not found in DB during disconnect status update.`);
            }

            // 2. Broadcast offline status to relevant chats the user was part of
            const userChats = await Chat.find({ participants: userId }).select('_id').lean();
            
            if (userChats && userChats.length > 0) {
                userChats.forEach(chat => {
                    const chatId = chat._id.toString();
                    // Emit to all other sockets in this chat room
                    socket.to(chatId).emit('userStatusUpdate', {
                        userId,
                        username,
                        onlineStatus: 'offline',
                        lastSeen: updatedUser ? updatedUser.lastSeen : lastSeenTime,
                        chatId
                    });
                });
                logger.info(`Broadcasted offline status for ${username} to ${userChats.length} chat rooms.`);
            }


            // 3. Clear any "typing" indicators for this user from Redis for all chats they were in
            if (userChats && userChats.length > 0) {
                const typingClearPromises = userChats.map(async (chat) => {
                    const chatId = chat._id.toString();
                    const typingKey = `typing:${chatId}:${userId}`; // Matches getTypingKey format
                    try {
                        const result = await redis.del(typingKey);
                        if (result > 0) {
                            logger.info(`Cleared typing indicator for ${username} in chat ${chatId} on disconnect.`);
                            io.to(chatId).emit('typing', {
                                chatId,
                                userId,
                                username,
                                isTyping: false
                            });
                        }
                    } catch (redisError) {
                         logger.error(`Error clearing typing indicator for ${username} in chat ${chatId} from Redis: ${redisError.message}`);
                    }
                });
                await Promise.all(typingClearPromises);
            }

        } catch (error) {
            logger.error(`Error during disconnect event handling for user ${username} (ID: ${userId}): ${error.message}`, error);
        }
    });
};
