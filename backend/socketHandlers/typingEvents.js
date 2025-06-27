// Helper to form Redis key for typing status
const getTypingKey = (chatId, userId) => `typing:${chatId}:${userId}`;

module.exports = ({ io, socket, logger, redis }) => {

    socket.on('typingStart', async (data) => {
        try {

            const { chatId } = data || {};
            const userId = socket.user.userId;
            const username = socket.user.username;

            if (!chatId) {
                logger.warn(`User ${username} (Socket: ${socket.id}) 'typingStart' without chatId.`);
                return;
            }

            const key = getTypingKey(userId, chatId);

            // Store username for payload, expire in 10s
            await redis.set(key, username, 'EX', 10);

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
        try {
            const { chatId } = data || {};
            const userId = socket.user.userId;
            const username = socket.user.username;

            logger.debug(`User ${username} (Socket: ${socket.id}) 'typingStop' for chat: ${chatId}`);

            if (!chatId) {
                logger.warn(`User ${username} (Socket: ${socket.id}) 'typingStop' without chatId.`);
                return;
            }
            
            const key = getTypingKey(userId, chatId);
            await redis.del(key); // Remove the key from Redis

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
