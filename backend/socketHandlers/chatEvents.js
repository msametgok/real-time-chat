// Destructure dependencies passed from main socket.js
module.exports = ({ io, socket, logger, User, Chat, Message, encrypt, decrypt, invalidateChatCache }) => {

    socket.on('joinChat', async (data) => {
        const { chatId } = data || {};
        const userId = socket.user.userId;
        const username = socket.user.username;

        logger.info(`User ${username} (ID: ${userId}, Socket: ${socket.id}) attempting to join chat: ${chatId}`);

        if (!chatId) {
            logger.warn(`User ${username} (Socket: ${socket.id}) sent 'joinChat' without a chatId.`);
            return socket.emit('chatError', { message: 'Chat ID is required to join.' });
        }

        try {
            // Verify chat exists and user is a participant
            const chat = await Chat.findOne({ _id: chatId, participants: userId }).lean();

            if (!chat) {
                logger.warn(`User ${username} (Socket: ${socket.id}) failed to join chat ${chatId}: Not a participant or chat does not exist.`);
                return socket.emit('chatError', { chatId, message: 'Cannot join this chat. Access denied or chat not found.' });
            }

            // Join the Socket.IO room
            socket.join(chatId);
            logger.info(`User ${username} (Socket: ${socket.id}) successfully joined chat room: ${chatId}`);

            // Acknowledge successful join
            socket.emit('joinedChat', { chatId, message: `Successfully joined chat: ${chat.isGroupChat ? chat.chatName : '1-on-1 Chat'}` });

        } catch (error) {
            logger.error(`Error during 'joinChat' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('chatError', { chatId, message: 'Failed to join chat due to a server error.' });
        }
    });

    socket.on('leaveChat', async (data) => {
        const { chatId } = data || {};
        const userId = socket.user.userId;
        const username = socket.user.username;

        logger.info(`User ${username} (ID: ${userId}, Socket: ${socket.id}) attempting to leave chat: ${chatId}`);

        if (!chatId) {
            logger.warn(`User ${username} (Socket: ${socket.id}) sent 'leaveChat' without a chatId.`);
            return socket.emit('chatError', { message: 'Chat ID is required to leave.' });
        }

        try {
            if (!socket.rooms.has(chatId)) {
                logger.warn(`User ${username} (Socket: ${socket.id}) attempted to leave chat room ${chatId} they were not in.`);
                // Still emit success as the desired state (not being in the room) is achieved.
                return socket.emit('leftChatAck', { chatId, message: `You were not in chat: ${chatId}` });
            }
            
            socket.leave(chatId);
            logger.info(`User ${username} (Socket: ${socket.id}) successfully left chat room: ${chatId}`);

            // Acknowledge successful leave
            socket.emit('leftChatAck', { chatId, message: `Successfully left chat: ${chatId}` });

            // Emit to the room that a user has disconnected from this specific chat view
            // This informs other users in the room.
            io.to(chatId).emit('userDisconnectedFromChat', { 
                chatId, 
                userId, 
                username,
                message: `${username} has left the chat view.`
            });

        } catch (error) {
            logger.error(`Error during 'leaveChat' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('chatError', { chatId, message: 'Failed to leave chat due to a server error.' });
        }
    });

    socket.on('sendMessage', async (data) => {
        const { chatId, messageType, content, fileUrl, fileName, fileType, fileSize } = data || {};
        const userId = socket.user.userId;
        const username = socket.user.username;

        logger.info(`User ${username} (Socket: ${socket.id}) attempting to send message to chat: ${chatId}`);
        logger.debug(`sendMessage payload for chat ${chatId}:`, data);


        if (!chatId) {
            logger.warn(`User ${username} (Socket: ${socket.id}) 'sendMessage' without chatId.`);
            return socket.emit('messageError', { message: 'Chat ID is required to send a message.' });
        }
        if (!messageType) {
            logger.warn(`User ${username} (Socket: ${socket.id}) 'sendMessage' without messageType for chat ${chatId}.`);
            return socket.emit('messageError', { chatId, message: 'Message type is required.' });
        }

        // Basic validation based on messageType
        if (messageType === 'text' && (!content || content.trim() === '')) {
            logger.warn(`User ${username} (Socket: ${socket.id}) 'sendMessage' with empty text content for chat ${chatId}.`);
            return socket.emit('messageError', { chatId, message: 'Text message content cannot be empty.' });
        }
        if (['image', 'video', 'audio', 'file'].includes(messageType) && !fileUrl) {
            logger.warn(`User ${username} (Socket: ${socket.id}) 'sendMessage' of type ${messageType} without fileUrl for chat ${chatId}.`);
            return socket.emit('messageError', { chatId, message: 'File URL is required for file messages.' });
        }

        try {
            // Verify user is part of the chat
            const chat = await Chat.findOne({ _id: chatId, participants: userId }).lean();
            if (!chat) {
                logger.warn(`User ${username} (Socket: ${socket.id}) 'sendMessage' to unauthorized/non-existent chat ${chatId}.`);
                return socket.emit('messageError', { chatId, message: 'Cannot send message to this chat. Access denied or chat not found.' });
            }

            let messageToSave = {
                chat: chatId,
                sender: userId,
                messageType: messageType,
                status: 'sent',
            };

            if (messageType === 'text') {
                messageToSave.content = encrypt(content.trim()); // Encrypt text content
            } else if (['image', 'video', 'audio', 'file'].includes(messageType)) {
                messageToSave.fileUrl = fileUrl;
                if (fileName) messageToSave.fileName = fileName;
                if (fileType) messageToSave.fileType = fileType;
                if (fileSize) messageToSave.fileSize = fileSize;
                if (content && content.trim() !== '') messageToSave.content = encrypt(content.trim()); // Optional: caption for files, also encrypted
            } else if (['system', 'notification'].includes(messageType)) {
                messageToSave.content = content;
            } else {
                logger.warn(`User ${username} (Socket: ${socket.id}) 'sendMessage' with unknown messageType: ${messageType} for chat ${chatId}.`);
                return socket.emit('messageError', { chatId, message: `Unsupported message type: ${messageType}` });
            }

            const newMessage = new Message(messageToSave);
            await newMessage.save(); // This will trigger the post-save hook in Message.js

            let populatedMessage = await Message.findById(newMessage._id)
                                              .populate('sender', 'username avatar')
                                              .lean();

            // Decrypt text content for broadcasting to clients
            if (populatedMessage.messageType === 'text' && populatedMessage.content) {
                try {
                    populatedMessage.content = decrypt(populatedMessage.content);
                } catch (e) {
                    logger.error(`Error decrypting message ${populatedMessage._id} for broadcast: ${e.message}`);
                    // Decide how to handle: send encrypted, or a placeholder
                    populatedMessage.content = "[Unable to display message content]";
                }
            } else if (['image', 'video', 'audio', 'file'].includes(populatedMessage.messageType) && populatedMessage.content) {
                // Decrypt caption if it exists
                
                try {
                    populatedMessage.content = decrypt(populatedMessage.content);
                } catch (e) {
                    logger.error(`Error decrypting caption for message ${populatedMessage._id} for broadcast: ${e.message}`);
                    populatedMessage.content = null; // Or some placeholder for caption
                }
            }


            // Broadcast the new message to everyone in the chat room
            io.to(chatId).emit('newMessage', populatedMessage);
            logger.info(`Message ${newMessage._id} (type: ${messageType}) by ${username} sent to chat ${chatId} and broadcasted.`);

            // Acknowledge to the sender that the message was processed
            socket.emit('messageSentAck', { tempId: tempId, finalMessage: populatedMessage });

            // Invalidate chat cache for all participants since latestMessage/order changed
            if (chat.participants) {
                await invalidateChatCache(chat.participants.map(p => p.toString()));
            }

        } catch (error) {
            logger.error(`Error during 'sendMessage' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('messageError', { chatId, message: 'Failed to send message due to a server error.' });
        }
    });
};
