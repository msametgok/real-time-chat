const areAllOtherInArray = (statusArray = [], participants = [], senderId) => {
    const statusIds = statusArray.map(id => id.toString());
    const others = participants
        .map(id => id.toString())
        .filter(pid => pid !== senderId.toString());
    return others.every(pid => statusIds.includes(pid));
};

module.exports = ({ io, socket, logger, Message, Chat }) => {

    /**
     * Handles a client event indicating that messages in a chat have been read by the user.
     * Client should send: { chatId: '...', messageIds: ['id1', 'id2', ...] }
     * where messageIds are messages the current user has just read.
     */
    socket.on('markMessagesAsRead', async (data) => {
        try {
            const { chatId, messageIds } = data || {};
            const readerId = socket.user.userId;
            const readerName = socket.user.username;

            logger.info(`User ${readerName} (Socket: ${socket.id}) marking messages as read in chat: ${chatId}`);

            if (!chatId || !Array.isArray(messageIds) || messageIds.length === 0) {
                logger.warn(`${readerName} 'markMessagesAsRead' with invalid chatId or messageIds.`);
                return socket.emit('statusError', { message: 'Chat ID and a non-empty array of Message IDs are required.' });
            }

            // 1. Verify the user is a participant of the chat
            const chat = await Chat.findById(chatId).select('participants').lean(); // Only need participants
            if (!chat || !chat.participants.map(p => p.toString()).includes(readerId)) {
                logger.warn(`${readerName} 'markMessagesAsRead' for unauthorized/non-existent chat ${chatId}.`);
                return socket.emit('statusError', { chatId, message: 'Access denied or chat not found.' });
            }

            // 2. Update messages: add readerId to readBy array for messages not sent by them
            //    and where they are not already in readBy.
            const updateResult = await Message.updateMany(
                {
                    _id: { $in: messageIds },
                    chat: chatId,
                    sender: { $ne: readerId },
                    readBy: { $ne: readerId }
                },
                {
                    $addToSet: { readBy: readerId }
                }
            );

            if (updateResult.modifiedCount > 0) {
                logger.info(`${readerName} marked ${updateResult.modifiedCount} messages as read in chat ${chatId}.`);

                // 3. For each message that was potentially updated, check if it's now read by all.
                // We only need to check the messages that this user's action might have affected.
                const updated = await Message.find({
                    _id: { $in: messageIds },
                    chat: chatId
                }).select('sender readBy').lean(); // Select only needed fields

                // Determine which are now read by all
                const readByAll = updated
                .filter(msg => areAllOtherInArray(msg.readBy, chat.participants, msg.sender))
                .map(msg => msg._id.toString());

                // Broadcast to chat room
                io.to(chatId).emit('messagesReadUpdate', {
                    chatId,
                    reader: { userId: readerId, username: readerName },
                    messageIds,
                    messagesReadByAll: readByAll
                });

                // Update chat list UI
                io.to(chatId).emit('chatListUpdate', {
                    chatId,
                    timestamp: new Date().toISOString()
                });
            }

            // Acknowledge back
            socket.emit('markMessagesAsReadAck', {
                chatId,
                updatedCount: updateResult.modifiedCount
            });

        } catch (error) {
            logger.error(`Error during 'markMessagesAsRead' for ${readerName}, chat ${chatId}: ${error.message}`, error);
            socket.emit('statusError', { chatId, message: 'Failed to mark messages as read.' });
        }
    });

    /**
     * Handles an event when a message has been delivered to a specific client's device/app.
     * Client should send: { messageId: '...', chatId: '...' }
     */
module.exports = ({ io, socket, logger, Chat, Message }) => {
  socket.on('messageDeliveredToClient', async ({ chatId, messageId }) => {
    const userId = socket.user.userId;
    try {
      // 1) Atomically add this user to deliveredTo if not already present
      const updatedMsg = await Message.findOneAndUpdate(
        { _id: messageId, deliveredTo: { $ne: userId } },
        { $addToSet: { deliveredTo: userId } },
        { new: true, select: 'sender deliveredTo' }
      ).lean();

      // If no update, either message doesn't exist or user already marked delivered
      if (!updatedMsg) return;

      // 2) Check if *all* other participants have now delivered it
      const chat = await Chat.findById(chatId).select('participants').lean();
      const senderId = updatedMsg.sender.toString();
      const otherIds = chat.participants
        .map(p => p.toString())
        .filter(id => id !== senderId);

      const deliveredToAll = otherIds.every(id =>
        updatedMsg.deliveredTo.map(d => d.toString()).includes(id)
      );

      // 3) Broadcast a delivery update for *this* message
      io.to(chatId).emit('messageDeliveryUpdate', {
        chatId,
        messageId,
        deliveredToUserId: userId,
        deliveredToAll
      });

    } catch (err) {
      logger.error(
        `statusEvents: Error in messageDeliveredToClient for msg ${messageId}, user ${userId}: ${err.message}`,
        err
      );
    }
  });
};
};