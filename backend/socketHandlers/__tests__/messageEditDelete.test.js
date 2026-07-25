const initializeChatEventHandlers = require('../chatEvents');

// Same fake-deps harness as chatEvents.test.js, extended with the statics the
// edit/delete handlers use (Message.findOne/updateOne, removeUploadedFile).
const buildHarness = ({ userId = 'user-1', username = 'alice' } = {}) => {
    const handlers = {};
    const timeline = [];

    const io = {
        to: jest.fn(room => ({
            emit: (event, payload) => timeline.push({ via: 'io.to', room, event, payload })
        })),
        in: jest.fn(() => ({
            allSockets: jest.fn().mockResolvedValue(new Set())
        }))
    };

    const socket = {
        id: 'socket-1',
        user: { userId, username },
        on: (event, fn) => { handlers[event] = fn; },
        join: jest.fn(),
        leave: jest.fn(),
        emit: (event, payload) => {
            timeline.push({ via: 'socket.emit', event, payload });
            return socket;
        },
        to: jest.fn(room => ({
            emit: (event, payload) => timeline.push({ via: 'socket.to', room, event, payload })
        }))
    };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const redis = { set: jest.fn().mockResolvedValue('OK') };

    const Chat = { findOne: jest.fn() };

    const Message = jest.fn();
    Message.findOne = jest.fn();
    Message.findOneAndUpdate = jest.fn();
    Message.updateOne = jest.fn().mockResolvedValue({ acknowledged: true });

    const encrypt = jest.fn(v => `enc(${v})`);
    const decryptMessageDoc = jest.fn(msg => msg);
    const invalidateChatCache = jest.fn().mockResolvedValue(undefined);
    const removeUploadedFile = jest.fn();

    initializeChatEventHandlers({
        io, socket, logger, redis, Chat, Message, encrypt,
        decryptMessageDoc, invalidateChatCache, removeUploadedFile
    });

    const find = event => timeline.filter(t => t.event === event);

    return {
        handlers, timeline, find,
        io, socket, logger, Chat, Message, encrypt, invalidateChatCache, removeUploadedFile
    };
};

const lean = value => ({ lean: jest.fn().mockResolvedValue(value) });
const selectLean = value => ({ select: jest.fn().mockReturnValue(lean(value)) });

const chatId = 'chat-1';
const messageId = 'msg-1';
const participantChat = { _id: chatId, participants: ['user-1', 'user-2'] };

const minutesAgo = m => new Date(Date.now() - m * 60 * 1000).toISOString();

// A message OWNED by user-1, sent recently enough to edit.
const ownRecentMessage = (overrides = {}) => ({
    _id: messageId,
    sender: 'user-1',
    messageType: 'text',
    createdAt: minutesAgo(1),
    isDeletedForEveryone: false,
    ...overrides
});

const primeChat = h => h.Chat.findOne.mockReturnValue(selectLean(participantChat));

describe('editMessage', () => {
    it('encrypts the new content, stamps editedAt, and broadcasts to the whole room', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean(ownRecentMessage()));

        await h.handlers.editMessage({ chatId, messageId, content: '  fixed typo  ' });

        expect(h.Message.updateOne).toHaveBeenCalledWith(
            { _id: messageId },
            { $set: { content: 'enc(fixed typo)', editedAt: expect.any(Date) } }
        );

        const [edited] = h.find('messageEdited');
        expect(edited.via).toBe('io.to');           // sender applies the same event
        expect(edited.room).toBe(chatId);
        expect(edited.payload).toEqual({
            chatId, messageId, content: 'fixed typo', editedAt: expect.any(String)
        });
        // The edit may be the sidebar preview, and updateOne skipped the
        // post-save hook that normally owns invalidation.
        expect(h.invalidateChatCache).toHaveBeenCalledWith(['user-1', 'user-2']);
    });

    it("rejects editing someone else's message", async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean(ownRecentMessage({ sender: 'user-2' })));

        await h.handlers.editMessage({ chatId, messageId, content: 'hijack' });

        expect(h.Message.updateOne).not.toHaveBeenCalled();
        expect(h.find('messageEdited')).toHaveLength(0);
        expect(h.find('messageError')).toHaveLength(1);
    });

    // The window is enforced server-side; hiding the button client-side is
    // cosmetic and trivially bypassed.
    it('rejects an edit after the 15-minute window', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean(ownRecentMessage({ createdAt: minutesAgo(16) })));

        await h.handlers.editMessage({ chatId, messageId, content: 'too late' });

        expect(h.Message.updateOne).not.toHaveBeenCalled();
        expect(h.find('messageError')[0].payload.message).toMatch(/15 minutes/);
    });

    it('still allows an edit just inside the window', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean(ownRecentMessage({ createdAt: minutesAgo(14) })));

        await h.handlers.editMessage({ chatId, messageId, content: 'just in time' });

        expect(h.find('messageEdited')).toHaveLength(1);
    });

    it('rejects editing a non-text message', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean(ownRecentMessage({ messageType: 'image' })));

        await h.handlers.editMessage({ chatId, messageId, content: 'new caption' });

        expect(h.Message.updateOne).not.toHaveBeenCalled();
        expect(h.find('messageError')).toHaveLength(1);
    });

    it('rejects editing a message already deleted for everyone', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean(ownRecentMessage({ isDeletedForEveryone: true })));

        await h.handlers.editMessage({ chatId, messageId, content: 'necromancy' });

        expect(h.Message.updateOne).not.toHaveBeenCalled();
        expect(h.find('messageError')).toHaveLength(1);
    });

    it('rejects a non-participant outright', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean(null));

        await h.handlers.editMessage({ chatId, messageId, content: 'stranger' });

        expect(h.Message.findOne).not.toHaveBeenCalled();
        expect(h.find('messageError')).toHaveLength(1);
    });
});

describe('deleteMessageForMe', () => {
    it('hides the message for this user only and tells their other tabs', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOneAndUpdate.mockReturnValue(lean({ _id: messageId }));

        await h.handlers.deleteMessageForMe({ chatId, messageId });

        // readBy comes along so an unread hidden message cannot badge forever.
        expect(h.Message.findOneAndUpdate).toHaveBeenCalledWith(
            { _id: messageId, chat: chatId, deletedFor: { $ne: 'user-1' } },
            { $addToSet: { deletedFor: 'user-1', readBy: 'user-1' } },
            { new: true, select: '_id' }
        );

        const [hidden] = h.find('messageDeletedForMe');
        expect(hidden.via).toBe('io.to');
        expect(hidden.room).toBe('user-user-1');     // personal room, not the chat
        expect(hidden.payload).toEqual({ chatId, messageId });
    });

    // The $ne guard makes the update return null when already hidden
    // (gotcha 2) - that is the idempotent no-op, not an error.
    it('does nothing when the message was already hidden', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOneAndUpdate.mockReturnValue(lean(null));

        await h.handlers.deleteMessageForMe({ chatId, messageId });

        expect(h.find('messageDeletedForMe')).toHaveLength(0);
        expect(h.find('messageError')).toHaveLength(0);
    });

    it('rejects a non-participant', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean(null));

        await h.handlers.deleteMessageForMe({ chatId, messageId });

        expect(h.Message.findOneAndUpdate).not.toHaveBeenCalled();
        expect(h.find('messageError')).toHaveLength(1);
    });
});

describe('deleteMessageForEveryone', () => {
    it('blanks the message, removes the stored file, and broadcasts the tombstone', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean({
            _id: messageId, sender: 'user-1', fileUrl: '/uploads/abc.png', isDeletedForEveryone: false
        }));

        await h.handlers.deleteMessageForEveryone({ chatId, messageId });

        expect(h.Message.updateOne).toHaveBeenCalledWith(
            { _id: messageId },
            {
                $set: { isDeletedForEveryone: true },
                $unset: { content: '', fileUrl: '', fileName: '', fileType: '', fileSize: '' }
            }
        );
        expect(h.removeUploadedFile).toHaveBeenCalledWith('/uploads/abc.png');

        const [deleted] = h.find('messageDeletedForEveryone');
        expect(deleted.via).toBe('io.to');
        expect(deleted.room).toBe(chatId);
        expect(deleted.payload).toEqual({ chatId, messageId });
        expect(h.invalidateChatCache).toHaveBeenCalledWith(['user-1', 'user-2']);
    });

    it('leaves the disk alone for a text message', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean({
            _id: messageId, sender: 'user-1', isDeletedForEveryone: false
        }));

        await h.handlers.deleteMessageForEveryone({ chatId, messageId });

        expect(h.removeUploadedFile).not.toHaveBeenCalled();
        expect(h.find('messageDeletedForEveryone')).toHaveLength(1);
    });

    it("rejects deleting someone else's message for everyone", async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean({
            _id: messageId, sender: 'user-2', isDeletedForEveryone: false
        }));

        await h.handlers.deleteMessageForEveryone({ chatId, messageId });

        expect(h.Message.updateOne).not.toHaveBeenCalled();
        expect(h.find('messageDeletedForEveryone')).toHaveLength(0);
        expect(h.find('messageError')).toHaveLength(1);
    });

    it('does nothing when already deleted for everyone', async () => {
        const h = buildHarness();
        primeChat(h);
        h.Message.findOne.mockReturnValue(selectLean({
            _id: messageId, sender: 'user-1', isDeletedForEveryone: true
        }));

        await h.handlers.deleteMessageForEveryone({ chatId, messageId });

        expect(h.Message.updateOne).not.toHaveBeenCalled();
        expect(h.find('messageDeletedForEveryone')).toHaveLength(0);
        expect(h.find('messageError')).toHaveLength(0);
    });
});
