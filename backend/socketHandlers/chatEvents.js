const { computeDeliveredToAll } = require('../utils/messageStatus');
const { findChatForParticipant } = require('../utils/chatAuth');

// How long after sending a message may still be edited. Enforced HERE - the
// client hides the Edit option after this long, but that is cosmetic.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

// Destructure dependencies passed from main socket.js.
// decryptMessageDoc arrives through deps rather than a direct require so the
// handler stays testable with a fake - same reason `decrypt` used to. `decrypt`
// itself is no longer used here now that the helper owns the fallback.
module.exports = ({ io, socket, logger, redis, Chat, Message, encrypt, decryptMessageDoc, invalidateChatCache, removeUploadedFile }) => {

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
            const chat = await findChatForParticipant(Chat, chatId, userId);

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

            // Verify user is part of the chat.
            //
            // deletedFor is selected because the Message post-save hook CLEARS
            // it - a new message un-hides the chat for everyone who had soft
            // deleted it. Whoever that was has to be told, so read it before
            // saving or the information is gone.
            const chat = await findChatForParticipant(
                Chat, chatId, userId, 'participants deletedFor'
            );
            if (!chat) {
                logger.warn(`Unauthorized sendMessage by ${username} to ${chatId}`);
                return socket.emit('messageError', { chatId, tempId, message: 'Access denied.' });
            }

            // Captured before the save clears it. The sender cannot be in here
            // - they could not have sent to a chat they cannot see - but filter
            // anyway rather than rely on that.
            const restoredFor = (chat.deletedFor || [])
                .map(id => id.toString())
                .filter(id => id !== userId.toString());

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

            // Decrypt for broadcast. Clients never see ciphertext.
            const populated = decryptMessageDoc(
                await Message.findById(newMessage._id)
                    .populate('sender', 'username avatar').lean()
            );

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

            // Anyone who had soft-deleted this chat is NOT in the room - they
            // left it on delete - so the broadcast above cannot reach them and
            // their sidebar would stay empty until a manual reload.
            //
            // Sent to the personal room, which every user joins on connect and
            // never leaves. Carries only the id: the client refetches, which
            // gets it a per-viewer formatted chat and a server-computed unread
            // count without duplicating either here.
            for (const restoredUserId of restoredFor) {
                io.to(`user-${restoredUserId}`).emit('chatRestored', { chatId });
                logger.info(`Chat ${chatId} restored for user ${restoredUserId} by a new message.`);
            }

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

                    // The $ne guard means this returns NULL when the participant
                    // is already in deliveredTo - i.e. nothing changed, so there
                    // is nothing to broadcast. Dereferencing it threw, the catch
                    // threw again on the hoisted vars, and invalidateChatCache
                    // below never ran - leaving every participant's sidebar stale
                    // for the full 300s TTL.
                    if (!updatedMsg) continue;

                    // Compute whether *all* other participants have now received it
                    const deliveredToAll = computeDeliveredToAll(updatedMsg, chat.participants);

                    // Broadcast exactly the same update your React client expects
                    io.to(chatId).emit('messageDeliveryUpdate', {
                        chatId,
                        messageId: populated._id.toString(),
                        deliveredToUserId: participantId,
                        deliveredToAll
                    });
                }
            }

            // No invalidateChatCache here: Message's post-save hook already
            // updates Chat.latestMessage and invalidates the cache for every
            // participant. Doing it again just paid for a second round of
            // Redis deletes on the same keys.
            logger.info(`Message ${newMessage._id} by ${username} in chat ${chatId}`);

        } catch (error) {
            logger.error(`Error during 'sendMessage' for user ${username} (Socket: ${socket.id}), chat ${chatId}: ${error.message}`, error);
            socket.emit('messageError', { chatId, tempId, message: 'Failed to send message.' });
        }
    });

    // All three handlers below use updateOne/findOneAndUpdate, never save():
    // the Message post-save hook would overwrite Chat.latestMessage with this
    // (possibly old) message and un-hide the chat for everyone who had soft
    // deleted it. The flip side is that the hook's cache invalidation does not
    // run either, so the handlers that change what the sidebar may be showing
    // call invalidateChatCache themselves.

    socket.on('editMessage', async (data) => {
        let chatId;
        let messageId;
        const { userId, username } = socket.user;

        try {
            let content;
            ({ chatId, messageId, content } = data || {});

            if (!chatId || !messageId || !content?.trim()) {
                return socket.emit('messageError', { chatId, message: 'chatId, messageId and content are required to edit.' });
            }

            const chat = await findChatForParticipant(Chat, chatId, userId);
            if (!chat) {
                logger.warn(`Unauthorized editMessage by ${username} in ${chatId}`);
                return socket.emit('messageError', { chatId, message: 'Access denied.' });
            }

            const message = await Message.findOne({ _id: messageId, chat: chatId })
                .select('sender messageType createdAt isDeletedForEveryone').lean();
            if (!message || message.isDeletedForEveryone) {
                return socket.emit('messageError', { chatId, message: 'Message not found.' });
            }
            if (message.sender.toString() !== userId.toString()) {
                logger.warn(`User ${username} tried to edit someone else's message ${messageId}`);
                return socket.emit('messageError', { chatId, message: 'You can only edit your own messages.' });
            }
            if (message.messageType !== 'text') {
                return socket.emit('messageError', { chatId, message: 'Only text messages can be edited.' });
            }
            if (Date.now() - new Date(message.createdAt).getTime() > EDIT_WINDOW_MS) {
                return socket.emit('messageError', { chatId, message: 'Messages can only be edited within 15 minutes of sending.' });
            }

            const trimmed = content.trim();
            const editedAt = new Date();
            await Message.updateOne(
                { _id: messageId },
                { $set: { content: encrypt(trimmed), editedAt } }
            );

            // io.to, not socket.to: the sender applies the edit from this same
            // event - there is no optimistic apply to reconcile.
            io.to(chatId).emit('messageEdited', {
                chatId,
                messageId,
                content: trimmed,
                editedAt: editedAt.toISOString()
            });

            // The edited message may be the sidebar preview.
            await invalidateChatCache(chat.participants.map(p => p.toString()));
            logger.info(`Message ${messageId} edited by ${username} in chat ${chatId}`);
        } catch (error) {
            logger.error(`Error during 'editMessage' for user ${username} (Socket: ${socket.id}), chat ${chatId}, message ${messageId}: ${error.message}`, error);
            socket.emit('messageError', { chatId, message: 'Failed to edit message.' });
        }
    });

    socket.on('deleteMessageForMe', async (data) => {
        let chatId;
        let messageId;
        const { userId, username } = socket.user;

        try {
            ({ chatId, messageId } = data || {});

            if (!chatId || !messageId) {
                return socket.emit('messageError', { chatId, message: 'chatId and messageId are required to delete.' });
            }

            const chat = await findChatForParticipant(Chat, chatId, userId);
            if (!chat) {
                logger.warn(`Unauthorized deleteMessageForMe by ${username} in ${chatId}`);
                return socket.emit('messageError', { chatId, message: 'Access denied.' });
            }

            // readBy is added too: the unread badge counts messages whose
            // readBy lacks you, and a hidden message can never be read - it
            // would keep the chat badged forever. Deliberately no read
            // receipt broadcast: deleting unseen is not reading.
            const updated = await Message.findOneAndUpdate(
                { _id: messageId, chat: chatId, deletedFor: { $ne: userId } },
                { $addToSet: { deletedFor: userId, readBy: userId } },
                { new: true, select: '_id' }
            ).lean();

            // Null when already hidden (the $ne guard, gotcha 2): idempotent,
            // nothing changed, nothing to emit.
            if (!updated) return;

            // Personal room, not the chat room: this delete is invisible to
            // everyone else, but the user's other open tabs must follow.
            io.to(`user-${userId}`).emit('messageDeletedForMe', { chatId, messageId });
            logger.info(`Message ${messageId} hidden for ${username} in chat ${chatId}`);
        } catch (error) {
            logger.error(`Error during 'deleteMessageForMe' for user ${username} (Socket: ${socket.id}), chat ${chatId}, message ${messageId}: ${error.message}`, error);
            socket.emit('messageError', { chatId, message: 'Failed to delete message.' });
        }
    });

    socket.on('deleteMessageForEveryone', async (data) => {
        let chatId;
        let messageId;
        const { userId, username } = socket.user;

        try {
            ({ chatId, messageId } = data || {});

            if (!chatId || !messageId) {
                return socket.emit('messageError', { chatId, message: 'chatId and messageId are required to delete.' });
            }

            const chat = await findChatForParticipant(Chat, chatId, userId);
            if (!chat) {
                logger.warn(`Unauthorized deleteMessageForEveryone by ${username} in ${chatId}`);
                return socket.emit('messageError', { chatId, message: 'Access denied.' });
            }

            const message = await Message.findOne({ _id: messageId, chat: chatId })
                .select('sender fileUrl isDeletedForEveryone').lean();
            if (!message) {
                return socket.emit('messageError', { chatId, message: 'Message not found.' });
            }
            if (message.sender.toString() !== userId.toString()) {
                logger.warn(`User ${username} tried to delete someone else's message ${messageId} for everyone`);
                return socket.emit('messageError', { chatId, message: 'You can only delete your own messages for everyone.' });
            }
            if (message.isDeletedForEveryone) return; // idempotent

            // The tombstone keeps no payload: content and file metadata are
            // gone from the document, not merely hidden.
            await Message.updateOne(
                { _id: messageId },
                {
                    $set: { isDeletedForEveryone: true },
                    $unset: { content: '', fileUrl: '', fileName: '', fileType: '', fileSize: '' }
                }
            );

            // Best-effort: the file on disk serves nobody once the URL is gone.
            if (message.fileUrl) removeUploadedFile(message.fileUrl);

            // io.to includes the sender - same single event for everyone.
            io.to(chatId).emit('messageDeletedForEveryone', { chatId, messageId });

            // The deleted message may be the sidebar preview.
            await invalidateChatCache(chat.participants.map(p => p.toString()));
            logger.info(`Message ${messageId} deleted for everyone by ${username} in chat ${chatId}`);
        } catch (error) {
            logger.error(`Error during 'deleteMessageForEveryone' for user ${username} (Socket: ${socket.id}), chat ${chatId}, message ${messageId}: ${error.message}`, error);
            socket.emit('messageError', { chatId, message: 'Failed to delete message.' });
        }
    });
};
