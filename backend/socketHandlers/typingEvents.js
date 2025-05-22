module.exports = ({ io, socket, logger, redis, User, Chat }) => {

    // Helper function to generate a unique Redis key for typing status
    const getTypingKey = (userId, chatId) => `typing:${chatId}:${userId}`;

    socket.on('typingStart', async (data) => {
        const { chatId } = data || {};
        const userId = socket.user.userId;
        const username = socket.user.username;

        logger.debug(`User ${username} (Socket: ${socket.id}) 'typingStart' for chat: ${chatId}`);

        if (!chatId) {
            logger.warn(`User ${username} (Socket: ${socket.id}) 'typingStart' without chatId.`);
            return;
        }

        try {
            const typingKey = getTypingKey(userId, chatId);

            // Store username for payload, expire in 10s
            await redis.set(typingKey, username, 'EX', 10);

            // Broadcast to other users in the room
            socket.to(chatId).emit('typing', {
                chatId,
                userId,
                username,
                isTyping: true
            });
            logger.debug(`User ${username} is typing in chat ${chatId}. Event broadcasted.`);

        } catch (error) {
            logger.error(`Error during 'typingStart' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
        }
    });

    socket.on('typingStop', async (data) => {
        const { chatId } = data || {};
        const userId = socket.user.userId;
        const username = socket.user.username;

        logger.debug(`User ${username} (Socket: ${socket.id}) 'typingStop' for chat: ${chatId}`);

        if (!chatId) {
            logger.warn(`User ${username} (Socket: ${socket.id}) 'typingStop' without chatId.`);
            return;
        }

        try {
            const typingKey = getTypingKey(userId, chatId);
            await redis.del(typingKey); // Remove the key from Redis

            // Broadcast to other users in the room
            socket.to(chatId).emit('typing', {
                chatId,
                userId,
                username,
                isTyping: false
            });
            logger.debug(`User ${username} stopped typing in chat ${chatId}. Event broadcasted.`);

        } catch (error) {
            logger.error(`Error during 'typingStop' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
        }
    });
};
