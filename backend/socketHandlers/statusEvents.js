module.exports = ({ io, socket, logger, Message, Chat }) => {
    /**
     * Helper function to check if all relevant participants (excluding sender) are in a status array.
     * @param {Array<ObjectId_Stringable>} statusArray - The array to check (e.g., message.deliveredTo, message.readBy).
     * @param {Array<ObjectId_Stringable>} participants - All participants of the chat.
     * @param {ObjectId_Stringable} senderId - The ID of the message sender.
     * @returns {boolean} - True if all other participants are in statusArray.
     */
    const areAllOtherParticipantsInArray = (statusArray, participants, senderId) => {
        // Ensure all inputs are consistently strings for comparison
        const statusArrayStrings = statusArray.map(id => id.toString());
        const participantStrings = participants.map(id => id.toString());
        const senderIdString = senderId.toString();

        const otherParticipantIds = participantStrings.filter(pId => pId !== senderIdString);

        if (otherParticipantIds.length === 0) return true;

        return otherParticipantIds.every(pId => statusArrayStrings.includes(pId));
    };

    /**
     * Handles a client event indicating that messages in a chat have been read by the user.
     * Client should send: { chatId: '...', messageIds: ['id1', 'id2', ...] }
     * where messageIds are messages the current user has just read.
     */
    socket.on('markMessagesAsRead', async (data) => {
        const { chatId, messageIds } = data || {};
        const readerUserId = socket.user.userId;
        const readerUsername = socket.user.username;

        logger.info(`User ${readerUsername} (Socket: ${socket.id}) marking messages as read in chat: ${chatId}`);

        if (!chatId || !messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
            logger.warn(`${readerUsername} 'markMessagesAsRead' with invalid chatId or messageIds.`);
            return socket.emit('statusError', { message: 'Chat ID and a non-empty array of Message IDs are required.' });
        }

        try {
            // 1. Verify the user is a participant of the chat
            const chat = await Chat.findById(chatId).select('participants').lean(); // Only need participants
            if (!chat || !chat.participants.map(p => p.toString()).includes(readerUserId)) {
                logger.warn(`${readerUsername} 'markMessagesAsRead' for unauthorized/non-existent chat ${chatId}.`);
                return socket.emit('statusError', { chatId, message: 'Access denied or chat not found.' });
            }

            // 2. Update messages: add readerUserId to readBy array for messages not sent by them
            //    and where they are not already in readBy.
            const updateResult = await Message.updateMany(
                {
                    _id: { $in: messageIds },
                    chat: chatId,
                    sender: { $ne: readerUserId },
                    readBy: { $ne: readerUserId }
                },
                {
                    $addToSet: { readBy: readerUserId }
                }
            );

            if (updateResult.modifiedCount > 0) {
                logger.info(`${readerUsername} marked ${updateResult.modifiedCount} messages as read in chat ${chatId}.`);

                // 3. For each message that was potentially updated, check if it's now read by all.
                // We only need to check the messages that this user's action might have affected.
                const potentiallyUpdatedMessages = await Message.find({
                    _id: { $in: messageIds },
                    chat: chatId
                }).select('sender readBy').lean(); // Select only needed fields

                const messagesReadByAllDetails = [];
                for (const msg of potentiallyUpdatedMessages) {
                    // Only consider messages where the current reader was actually added to readBy
                    // (or if they were already there but we're re-evaluating)
                    if (msg.readBy.map(id => id.toString()).includes(readerUserId)) {
                        if (areAllOtherParticipantsInArray(msg.readBy, chat.participants, msg.sender)) {
                            messagesReadByAllDetails.push({ messageId: msg._id.toString(), readByAll: true });
                            await Message.updateOne({ _id: msg._id }, { $set: { status: 'read' } });
                        }
                    }
                }

                // 4. Broadcast the update to the chat room
                io.to(chatId).emit('messagesReadUpdate', {
                    chatId,
                    reader: { userId: readerUserId, username: readerUsername },
                    messageIds,
                    messagesReadByAll: messagesReadByAllDetails
                });

                socket.emit('markMessagesAsReadAck', { chatId, updatedCount: updateResult.modifiedCount });
            } else {
                logger.info(`No new messages for ${readerUsername} to mark as read in chat ${chatId} from list.`);
                socket.emit('markMessagesAsReadAck', { chatId, updatedCount: 0, message: "Messages already marked or not applicable." });
            }

        } catch (error) {
            logger.error(`Error during 'markMessagesAsRead' for ${readerUsername}, chat ${chatId}: ${error.message}`, error);
            socket.emit('statusError', { chatId, message: 'Failed to mark messages as read.' });
        }
    });

    /**
     * Handles an event when a message has been delivered to a specific client's device/app.
     * Client should send: { messageId: '...', chatId: '...' }
     */
    socket.on('messageDeliveredToClient', async (data) => {
        const { messageId, chatId } = data || {};
        const recipientUserId = socket.user.userId;
        const recipientUsername = socket.user.username;

        logger.info(`${recipientUsername} (Socket: ${socket.id}) reports message ${messageId} in chat ${chatId} as delivered.`);

        if (!messageId || !chatId) {
            logger.warn(`${recipientUsername} 'messageDeliveredToClient' with missing messageId or chatId.`);
            return socket.emit('statusError', { message: 'Message ID and Chat ID are required.' });
        }

        try {
            const message = await Message.findById(messageId);
            if (!message) {
                logger.warn(`'messageDeliveredToClient' for non-existent message ${messageId}.`);
                return socket.emit('statusError', { messageId, message: 'Message not found.' });
            }

            if (message.chat.toString() !== chatId) {
                logger.warn(`'messageDeliveredToClient' for msg ${messageId} with mismatched chatId ${chatId}.`);
                return socket.emit('statusError', { messageId, message: 'Chat ID mismatch.' });
            }

            if (message.sender.toString() === recipientUserId) {
                logger.info(`Sender ${recipientUsername} cannot mark own message ${messageId} as 'deliveredToClient'.`);
                return socket.emit('messageDeliveredToClientAck', { messageId, chatId, message: "Sender cannot mark own message as delivered." });
            }

            const alreadyDelivered = message.deliveredTo.some(id => id.equals(recipientUserId));

            if (!alreadyDelivered) {
                message.deliveredTo.push(recipientUserId);
                if (message.status === 'sent') { message.status = 'delivered'; }
                await message.save();
                logger.info(`Message ${messageId} marked as delivered to ${recipientUsername}.`);

                const chat = await Chat.findById(chatId).select('participants').lean();
                if (!chat) {
                    logger.error(`Chat ${chatId} not found for delivery processing of msg ${messageId}.`);
                    return socket.emit('statusError', { messageId, message: 'Chat not found.' });
                }

                const deliveredToAll = areAllOtherParticipantsInArray(message.deliveredTo, chat.participants, message.sender);

                io.to(chatId).emit('messageDeliveryUpdate', {
                    chatId,
                    messageId,
                    deliveredToUserId: recipientUserId,
                    deliveredToAll: deliveredToAll,
                });
            } else {
                logger.info(`Message ${messageId} already marked delivered to ${recipientUsername}.`);
            }
            socket.emit('messageDeliveredToClientAck', { messageId, chatId });

        } catch (error) {
            logger.error(`Error during 'messageDeliveredToClient' for ${recipientUsername}, msg ${messageId}: ${error.message}`, error);
            socket.emit('statusError', { messageId, chatId, message: 'Failed to process message delivery.' });
        }
    });

    function findSocketByUserId(ioInstance, userId) {
        for (const [_socketId, sock] of ioInstance.sockets.sockets) {
            if (sock.user && sock.user.userId === userId) {
                return sock; // Return the socket object
            }
        }
        return null; // No active socket found for this userId
    }
};