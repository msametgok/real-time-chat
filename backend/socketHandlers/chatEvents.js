// Destructure dependencies passed from main socket.js
module.exports = ({ io, socket, logger, redis, Chat, Message, encrypt, decrypt, invalidateChatCache }) => {

    socket.on('joinChat', async (data) => {
        // Declared outside the try so the catch block can actually read them -
        // a `const` inside the try is out of scope in the catch, which made the
        // error handler itself throw ReferenceError and swallow the real error.
        let chatId;
        const { userId, username } = socket.user;

        try {
            ({ chatId } = data || {});

            logger.info(`User ${username} (ID: ${userId}, Socket: ${socket.id}) attempting to join chat: ${chatId}`);

            if (!chatId) {
                logger.warn(`User ${username} (Socket: ${socket.id}) sent 'joinChat' without a chatId.`);
                return socket.emit('chatError', { message: 'Chat ID is required to join.' });
            }
            // Verify chat exists and user is a participant
            const chat = await Chat.findOne({ _id: chatId, participants: userId }).lean();

            if (!chat) {
                logger.warn(`User ${username} (Socket: ${socket.id}) failed to join chat ${chatId}: Not a participant or chat does not exist.`);
                return socket.emit('chatError', { chatId, message: 'Cannot join this chat. Access denied or chat not found.' });
            }

            // Join room
            socket.join(chatId);
            socket.emit('joinedChat', { chatId });

            // Notify others viewing
            socket.to(chatId).emit('userConnectedToChat', { chatId, userId, username });
            logger.info(`User ${username} joined chat ${chatId}`);
        } catch (error) {
            logger.error(`Error during 'joinChat' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('chatError', { chatId, message: 'Failed to join chat due to a server error.' });
        }
    });

    socket.on('leaveChat', async (data) => {
        let chatId;
        const { userId, username } = socket.user;

        try {
            ({ chatId } = data || {});

            logger.info(`User ${username} (ID: ${userId}, Socket: ${socket.id}) attempting to leave chat: ${chatId}`);

            if (!chatId) {
                logger.warn(`User ${username} (Socket: ${socket.id}) sent 'leaveChat' without a chatId.`);
                return socket.emit('chatError', { message: 'Chat ID is required to leave.' });
            }

            // Leave room
            socket.leave(chatId);
            socket.emit('leftChatAck', { chatId });

            // Notify others
            socket.to(chatId).emit('userDisconnectedFromChat', { chatId, userId, username });
            logger.info(`User ${username} left chat ${chatId}`);

        } catch (error) {
            logger.error(`Error during 'leaveChat' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('chatError', { chatId, message: 'Failed to leave chat due to a server error.' });
        }
    });

    socket.on('sendMessage', async (data) => {
        // tempId is hoisted alongside chatId so the catch can tell the client
        // WHICH optimistic bubble failed - without it the client cannot clear
        // the pending state and the message spins forever.
        let chatId;
        let tempId;
        const { userId, username } = socket.user;

        try {
            let messageType, content, fileUrl, fileName, fileType, fileSize;
            ({ chatId, messageType, content, fileUrl, fileName, fileType, fileSize, tempId } = data || {});

            if (!chatId || !messageType) {
                logger.warn(`sendMessage missing parameters from ${username}`);
                return socket.emit('messageError', { tempId, message: 'chatId and messageType are required.' });
            }

            // Verify user is part of the chat
            const chat = await Chat.findOne({ _id: chatId, participants: userId }).lean();
            if (!chat) {
                logger.warn(`Unauthorized sendMessage by ${username} to ${chatId}`);
                return socket.emit('messageError', { chatId, tempId, message: 'Access denied.' });
            }

            let msg = {
                chat: chatId,
                sender: userId,
                messageType,
                status: 'sent',
            };

            if (messageType === 'text') {
                const trimmed = content?.trim() || '';
                msg.content = encrypt(trimmed);
            } else {
                msg.fileUrl = fileUrl;
                if (fileName) msg.fileName = fileName;
                if (fileType) msg.fileType = fileType;
                if (fileSize) msg.fileSize = fileSize;
                if (content && content.trim()) {
                msg.content = encrypt(content.trim());
                }
            }

            const newMessage = await new Message(msg).save(); // This will trigger the post-save hook in Message.js

            let populated = await Message.findById(newMessage._id)
                .populate('sender', 'username avatar').lean();

            // Decrypt text content for broadcasting to clients
            if (populated.messageType === 'text' && populated.content) {
                try {
                    populated.content = decrypt(populated.content);
                } catch (e) {
                    logger.error(`Error decrypting message ${populated._id} for broadcast: ${e.message}`);
                    // Decide how to handle: send encrypted, or a placeholder
                    populated.content = "[Unable to display message content]";
                }
            } else if (['image', 'video', 'audio', 'file'].includes(populated.messageType) && populated.content) {
                // Decrypt caption if it exists
                try {
                    populated.content = decrypt(populated.content);
                } catch (e) {
                    logger.error(`Error decrypting caption for message ${populated._id} for broadcast: ${e.message}`);
                    populated.content = null; // Or some placeholder for caption
                }
            }

            // Ack the sender FIRST. The ack is the only payload carrying tempId,
            // so the sender must see it before anything else can arrive - otherwise
            // the client has no way to match the real message to its optimistic
            // bubble and falls back to guessing by content.
            socket.emit('messageSentAck', { tempId, message: populated });

            // Then broadcast to everyone else. socket.to() excludes the sender,
            // who already has the message via the ack above; io.to() would deliver
            // it twice and re-append a duplicate bubble.
            //
            // No separate chatListUpdate: every participant auto-joins all their
            // chat rooms on connect, so this broadcast already reaches everyone
            // online regardless of which chat they are viewing. Emitting a second
            // sidebar event just made unread counts climb by 3 per message.
            socket.to(chatId).emit('newMessage', populated);

            // 3) Emit delivery‐receipt events only for truly online users and update DB
            for (const participantId of chat.participants.map(p => p.toString())) {
                if (participantId === userId) continue;

                // “Who’s actually connected right now?”
                const sockets = await io.in(`user-${participantId}`).allSockets();
                if (sockets.size > 0) {
                    // Atomically add this user to deliveredTo if not already present
                    const updatedMsg = await Message.findOneAndUpdate(
                        { _id: populated._id, deliveredTo: { $ne: participantId } },
                        { $addToSet: { deliveredTo: participantId } },
                        { new: true, select: 'sender deliveredTo' }
                    ).lean();

                    // Compute whether *all* other participants have now received it
                    const senderId = updatedMsg.sender.toString();
                    const otherIds = chat.participants
                    .map(p => p.toString())
                    .filter(id => id !== senderId);
                    const deliveredToAll = otherIds.every(id =>
                    updatedMsg.deliveredTo.map(d => d.toString()).includes(id)
                    );

                    // Broadcast exactly the same update your React client expects
                    io.to(chatId).emit('messageDeliveryUpdate', {
                        chatId,
                        messageId: populated._id.toString(),
                        deliveredToUserId: participantId,
                        deliveredToAll
                    });
                }
            }

            // Invalidate chat cache for all participants since latestMessage/order changed
            await invalidateChatCache(chat.participants);
            logger.info(`Message ${newMessage._id} by ${username} in chat ${chatId}`);

        } catch (error) {
            logger.error(`Error during 'sendMessage' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('messageError', { chatId, tempId, message: 'Failed to send message.' });
        }
    });
};
