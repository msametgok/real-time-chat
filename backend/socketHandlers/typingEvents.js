// Helper to form Redis key for typing status
const getTypingKey = (chatId, userId) => `typing:${chatId}:${userId}`;

/**
 * Typing events had no authorization at all: any authenticated user could emit
 * typingStart for any chatId and the server would broadcast it, so a stranger
 * could inject "X is typing..." into a conversation they aren't part of.
 *
 * Room membership stands in for a participant lookup here. It is equivalent -
 * sockets only ever join a chat room via the connection bootstrap (which
 * queries the user's own chats) or joinChat (which verifies participation) -
 * and it is free, which matters when this runs on a keystroke burst. A DB read
 * per typing event would be a poor trade.
 *
 * Returns false and logs rather than emitting an error: a user who isn't in
 * the chat shouldn't learn whether it exists.
 */
const canTypeIn = (socket, chatId, logger, event) => {
    if (socket.rooms?.has(chatId)) return true;

    logger.warn(
        `User ${socket.user?.username} (Socket: ${socket.id}) sent '${event}' ` +
        `for chat ${chatId} they have not joined. Ignored.`
    );
    return false;
};

module.exports = ({ io, socket, logger, redis }) => {

    socket.on('typingStart', async (data) => {
        // Hoisted so the catch block can read them - see chatEvents.js
        let chatId;
        const { userId, username } = socket.user;

        try {
            ({ chatId } = data || {});

            if (!chatId) {
                logger.warn(`User ${username} (Socket: ${socket.id}) 'typingStart' without chatId.`);
                return;
            }

            if (!canTypeIn(socket, chatId, logger, 'typingStart')) return;

            // Argument order matters: the signature is (chatId, userId).
            const key = getTypingKey(chatId, userId);

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
        let chatId;
        const { userId, username } = socket.user;

        try {
            ({ chatId } = data || {});

            logger.debug(`User ${username} (Socket: ${socket.id}) 'typingStop' for chat: ${chatId}`);

            if (!chatId) {
                logger.warn(`User ${username} (Socket: ${socket.id}) 'typingStop' without chatId.`);
                return;
            }

            if (!canTypeIn(socket, chatId, logger, 'typingStop')) return;

            const key = getTypingKey(chatId, userId);
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
