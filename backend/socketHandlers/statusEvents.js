const { computeDeliveredToAll, computeReadByAll } = require('../utils/messageStatus');
const { findChatForParticipant } = require('../utils/chatAuth');

module.exports = ({ io, socket, logger, redis, Message, Chat }) => {

    /**
     * Handles a client event indicating that messages in a chat have been read by the user.
     * Client should send: { chatId: '...', messageIds: ['id1', 'id2', ...] }
     * where messageIds are messages the current user has just read.
     */
    socket.on('markMessagesAsRead', async (data) => {
        // Hoisted so the catch block can read them - see chatEvents.js
        let chatId;
        const readerId = socket.user.userId;
        const readerName = socket.user.username;

        try {
            let messageIds;
            ({ chatId, messageIds } = data || {});

            logger.info(`User ${readerName} (Socket: ${socket.id}) marking messages as read in chat: ${chatId}`);

            if (!chatId || !Array.isArray(messageIds) || messageIds.length === 0) {
                logger.warn(`${readerName} 'markMessagesAsRead' with invalid chatId or messageIds.`);
                return socket.emit('statusError', { message: 'Chat ID and a non-empty array of Message IDs are required.' });
            }

            // 1. Verify the user is a participant of the chat
            const chat = await findChatForParticipant(Chat, chatId, readerId);
            if (!chat) {
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
                .filter(msg => computeReadByAll(msg, chat.participants))
                .map(msg => msg._id.toString());

                // Broadcast to chat room
                io.to(chatId).emit('messagesReadUpdate', {
                    chatId,
                    reader: { userId: readerId, username: readerName },
                    messageIds,
                    messagesReadByAll: readByAll
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
    socket.on('messageDeliveredToClient', async ({ chatId, messageId } = {}) => {
        const userId = socket.user.userId;
        try {
            if (!chatId || !messageId) {
                return socket.emit('statusError', { chatId, message: 'Chat ID and Message ID are required.' });
            }

            // 1) Claim this delivery event BEFORE touching the DB, so duplicate
            //    emits (reconnect, multi-tab) never reach Mongo at all.
            const deliveryKey = `delivery:${messageId}:${userId}`;
            const claimed = await redis.set(deliveryKey, '1', 'NX', 'EX', 30); // 30s TTL
            if (!claimed) return; // another emit already handled this one

            // 2) Atomically add this user to deliveredTo if not already present.
            //    Returns null when the user was already there - nothing to broadcast.
            const updatedMsg = await Message.findOneAndUpdate(
                { _id: messageId, deliveredTo: { $ne: userId } },
                { $addToSet: { deliveredTo: userId } },
                { new: true, select: 'sender deliveredTo' }
            ).lean();

            if (!updatedMsg) return;

            // 3) Check if *all* other participants have now received it
            const chat = await Chat.findById(chatId).select('participants').lean();
            if (!chat) return;

            const deliveredToAll = computeDeliveredToAll(updatedMsg, chat.participants);

            // 4) Broadcast a delivery update for *this* message
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