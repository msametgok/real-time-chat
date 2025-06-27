// src/socketHandlers/disconnectEvents.js
module.exports = ({ io, socket, logger, redis, Chat }) => {
  // Automatically emitted when a client disconnects
  socket.on('disconnect', async (reason) => {
    try {
      // If socket.user isn't set, skip (auth might not have completed)
      if (!socket.user?.userId || !socket.user?.username) {
        logger.warn(`Socket ${socket.id} disconnected before auth completed.`);
        return;
      }

      const { userId, username } = socket.user;
      const socketKey = `userSockets:${userId}`;

      logger.info(`User ${username} (ID: ${userId}) disconnected (Socket: ${socket.id}). Reason: ${reason}`);

      // Prune stale socket IDs in Redis
      const liveSockets = await io.in(`user-${userId}`).allSockets();
      await redis.del(socketKey);
      if (liveSockets.size) {
        await redis.sadd(socketKey, ...Array.from(liveSockets));
      }
      const remaining = await redis.scard(socketKey);
      logger.debug(`After prune, user ${username} has ${remaining} active sockets.`);

      // If no sockets remain, broadcast offline status to all chats
      if (remaining === 0) {
        const rooms = await Chat.find({ participants: userId }).select('_id').lean();

        // Persist last seen timestamp in Redis
        const lastSeenStr = new Date().toISOString();
        await redis.set(`userLastSeen:${userId}`, lastSeenStr);

        rooms.forEach(({ _id: chatId }) => {
          io.to(chatId.toString()).emit('userStatusUpdate', {
            chatId: chatId.toString(),
            userId,
            username,
            onlineStatus: 'offline',
            lastSeen:     lastSeenStr
          });
        });
        logger.info(`User ${username} is now offline in ${rooms.length} chats.`);
      }(`User ${username} is now offline in ${rooms.length} chats.`);
      
    } catch (err) {
      logger.error(`Error in disconnect handler for socket ${socket.id}: ${err.message}`, err);
    }
  });
};
