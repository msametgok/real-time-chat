const initializeStatusEventHandlers = require('../statusEvents');

/**
 * Builds a fake `deps` object matching what config/socket.js passes in,
 * plus helpers to grab the registered handlers and inspect emits.
 */
const buildHarness = ({ userId = 'user-1', username = 'alice' } = {}) => {
    const handlers = {};
    const roomEmits = [];
    const socketEmits = [];

    const io = {
        to: jest.fn(room => ({
            emit: (event, payload) => roomEmits.push({ room, event, payload })
        }))
    };

    const socket = {
        id: 'socket-1',
        user: { userId, username },
        on: (event, fn) => { handlers[event] = fn; },
        // Real socket.emit returns the socket, not a number - don't leak
        // Array.push's return value into the handler's `return socket.emit(...)`.
        emit: (event, payload) => { socketEmits.push({ event, payload }); return socket; }
    };

    const redis = { set: jest.fn().mockResolvedValue('OK') };

    const Message = {
        findOneAndUpdate: jest.fn(),
        updateMany: jest.fn(),
        find: jest.fn()
    };

    // findById: still used directly by messageDeliveredToClient.
    // findOne: used by findChatForParticipant, which gates markMessagesAsRead.
    const Chat = { findById: jest.fn(), findOne: jest.fn() };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const deps = { io, socket, logger, redis, Message, Chat };
    initializeStatusEventHandlers(deps);

    return { handlers, roomEmits, socketEmits, io, socket, redis, Message, Chat, logger };
};

// Mongoose chaining helpers: .select(...).lean() and .lean()
const lean = value => ({ lean: jest.fn().mockResolvedValue(value) });
const selectLean = value => ({ select: jest.fn().mockReturnValue(lean(value)) });

describe('statusEvents module shape', () => {
    // Regression guard: a nested `module.exports` inside the first one meant
    // this module silently registered only ONE of its two handlers. The file
    // parsed fine and threw nothing - the bug was invisible at runtime.
    it('registers every handler, not just the first', () => {
        const { handlers } = buildHarness();

        expect(Object.keys(handlers).sort()).toEqual([
            'markChatAsRead',
            'markMessagesAsRead',
            'messageDeliveredToClient'
        ]);
    });

    it('exports a single function that does not reassign module.exports when called', () => {
        const before = require('../statusEvents');
        buildHarness();
        const after = require('../statusEvents');

        expect(typeof before).toBe('function');
        expect(after).toBe(before);
    });
});

describe('messageDeliveredToClient', () => {
    const chatId = 'chat-1';
    const messageId = 'msg-1';

    it('claims the delivery in Redis BEFORE writing to Mongo', async () => {
        const h = buildHarness();
        const callOrder = [];

        h.redis.set.mockImplementation(async () => { callOrder.push('redis'); return 'OK'; });
        h.Message.findOneAndUpdate.mockImplementation(() => {
            callOrder.push('mongo');
            return lean({ sender: 'user-2', deliveredTo: ['user-1'] });
        });
        h.Chat.findById.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));

        await h.handlers.messageDeliveredToClient({ chatId, messageId });

        expect(callOrder).toEqual(['redis', 'mongo']);
        expect(h.redis.set).toHaveBeenCalledWith(
            `delivery:${messageId}:user-1`, '1', 'NX', 'EX', 30
        );
    });

    it('skips the DB write entirely when Redis reports a duplicate', async () => {
        const h = buildHarness();
        h.redis.set.mockResolvedValue(null); // NX failed - already claimed

        await h.handlers.messageDeliveredToClient({ chatId, messageId });

        expect(h.Message.findOneAndUpdate).not.toHaveBeenCalled();
        expect(h.roomEmits).toHaveLength(0);
    });

    it('does not broadcast when the user was already in deliveredTo', async () => {
        const h = buildHarness();
        // The $ne guard means Mongo returns null when nothing changed.
        h.Message.findOneAndUpdate.mockReturnValue(lean(null));

        await h.handlers.messageDeliveredToClient({ chatId, messageId });

        expect(h.roomEmits).toHaveLength(0);
        expect(h.logger.error).not.toHaveBeenCalled(); // must not throw on null
    });

    it('emits deliveredToAll=false while another participant is still missing', async () => {
        const h = buildHarness();
        h.Message.findOneAndUpdate.mockReturnValue(
            lean({ sender: 'user-3', deliveredTo: ['user-1'] })
        );
        h.Chat.findById.mockReturnValue(
            selectLean({ participants: ['user-1', 'user-2', 'user-3'] })
        );

        await h.handlers.messageDeliveredToClient({ chatId, messageId });

        expect(h.roomEmits).toEqual([{
            room: chatId,
            event: 'messageDeliveryUpdate',
            payload: { chatId, messageId, deliveredToUserId: 'user-1', deliveredToAll: false }
        }]);
    });

    it('emits deliveredToAll=true once every non-sender has it', async () => {
        const h = buildHarness();
        h.Message.findOneAndUpdate.mockReturnValue(
            lean({ sender: 'user-3', deliveredTo: ['user-1', 'user-2'] })
        );
        h.Chat.findById.mockReturnValue(
            selectLean({ participants: ['user-1', 'user-2', 'user-3'] })
        );

        await h.handlers.messageDeliveredToClient({ chatId, messageId });

        expect(h.roomEmits[0].payload.deliveredToAll).toBe(true);
    });

    it('compares ObjectId-like values by string, not identity', async () => {
        const h = buildHarness();
        const oid = v => ({ toString: () => v }); // stand-in for ObjectId

        h.Message.findOneAndUpdate.mockReturnValue(
            lean({ sender: oid('user-3'), deliveredTo: [oid('user-1'), oid('user-2')] })
        );
        h.Chat.findById.mockReturnValue(
            selectLean({ participants: [oid('user-1'), oid('user-2'), oid('user-3')] })
        );

        await h.handlers.messageDeliveredToClient({ chatId, messageId });

        expect(h.roomEmits[0].payload.deliveredToAll).toBe(true);
    });

    it('rejects a payload missing chatId or messageId', async () => {
        const h = buildHarness();

        await h.handlers.messageDeliveredToClient({ chatId });
        await h.handlers.messageDeliveredToClient({ messageId });
        await h.handlers.messageDeliveredToClient({});

        expect(h.socketEmits).toHaveLength(3);
        expect(h.socketEmits[0].event).toBe('statusError');
        expect(h.redis.set).not.toHaveBeenCalled();
    });

    it('survives an undefined payload without throwing', async () => {
        const h = buildHarness();

        await expect(h.handlers.messageDeliveredToClient()).resolves.not.toThrow();

        expect(h.socketEmits[0].event).toBe('statusError');
        expect(h.logger.error).not.toHaveBeenCalled(); // handled, not crashed
    });

    it('logs and swallows a DB failure instead of crashing the socket', async () => {
        const h = buildHarness();
        h.Message.findOneAndUpdate.mockImplementation(() => {
            throw new Error('mongo is down');
        });

        await expect(
            h.handlers.messageDeliveredToClient({ chatId, messageId })
        ).resolves.toBeUndefined();

        expect(h.logger.error).toHaveBeenCalled();
        // The catch block must not reference variables scoped inside the try -
        // if it did, this assertion would fail with a ReferenceError instead.
        expect(h.logger.error.mock.calls[0][0]).toContain(messageId);
    });
});

describe('markMessagesAsRead', () => {
    const chatId = 'chat-1';

    // The participant filter is now part of the query, so a non-participant
    // gets null back rather than a chat they then fail a check against.
    it('rejects a non-participant', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean(null));

        await h.handlers.markMessagesAsRead({ chatId, messageIds: ['m1'] });

        expect(h.socketEmits[0].event).toBe('statusError');
        expect(h.Message.updateMany).not.toHaveBeenCalled();
    });

    it('scopes the lookup to the reader, not just the chat id', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean(null));

        await h.handlers.markMessagesAsRead({ chatId, messageIds: ['m1'] });

        expect(h.Chat.findOne).toHaveBeenCalledWith({
            _id: chatId,
            participants: 'user-1'
        });
    });

    it('rejects an empty or malformed messageIds array', async () => {
        const h = buildHarness();

        await h.handlers.markMessagesAsRead({ chatId, messageIds: [] });
        await h.handlers.markMessagesAsRead({ chatId, messageIds: 'nope' });
        await h.handlers.markMessagesAsRead({ messageIds: ['m1'] });

        expect(h.socketEmits).toHaveLength(3);
        h.socketEmits.forEach(e => expect(e.event).toBe('statusError'));
    });

    it('broadcasts messagesReadUpdate when messages were updated', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));
        h.Message.updateMany.mockResolvedValue({ modifiedCount: 2 });
        h.Message.find.mockReturnValue(selectLean([
            { _id: 'm1', sender: 'user-2', readBy: ['user-1'] },
            { _id: 'm2', sender: 'user-2', readBy: ['user-1'] }
        ]));

        await h.handlers.markMessagesAsRead({ chatId, messageIds: ['m1', 'm2'] });

        const readUpdate = h.roomEmits.find(e => e.event === 'messagesReadUpdate');
        expect(readUpdate.payload.messagesReadByAll).toEqual(['m1', 'm2']);
        expect(readUpdate.payload.reader).toEqual({ userId: 'user-1', username: 'alice' });

        // Success is silent: the ack this used to emit had no listener.
        expect(h.socketEmits).toHaveLength(0);
    });

    it('stays quiet when nothing needed updating', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));
        h.Message.updateMany.mockResolvedValue({ modifiedCount: 0 });

        await h.handlers.markMessagesAsRead({ chatId, messageIds: ['m1'] });

        expect(h.roomEmits.filter(e => e.event === 'messagesReadUpdate')).toHaveLength(0);
        expect(h.socketEmits).toHaveLength(0);
    });
});

describe('markChatAsRead', () => {
    const chatId = 'chat-1';

    // The bug this handler exists for: markMessagesAsRead only covers the ids
    // the client passes, which is the single page it has loaded. Messages
    // older than that page stayed unread forever, so a long chat showed a
    // sidebar badge that opening it could not clear.
    it('marks messages the client never loaded, not just a passed-in page', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));
        h.Message.find.mockReturnValue(selectLean([
            { _id: 'old-msg', sender: 'user-2', readBy: [] },
            { _id: 'older-msg', sender: 'user-2', readBy: [] }
        ]));
        h.Message.updateMany.mockResolvedValue({ modifiedCount: 2 });

        await h.handlers.markChatAsRead({ chatId });

        // No message ids were supplied - the handler found them itself.
        const [filter] = h.Message.find.mock.calls[0];
        expect(filter.chat).toBe(chatId);
        expect(filter.sender).toEqual({ $ne: 'user-1' });
        expect(filter.readBy).toEqual({ $ne: 'user-1' });

        const [updateFilter, update] = h.Message.updateMany.mock.calls[0];
        expect(updateFilter._id.$in).toEqual(['old-msg', 'older-msg']);
        expect(update).toEqual({ $addToSet: { readBy: 'user-1' } });
    });

    it('broadcasts a read receipt in the same shape as markMessagesAsRead', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));
        h.Message.find.mockReturnValue(selectLean([
            { _id: 'msg-1', sender: 'user-2', readBy: [] }
        ]));
        h.Message.updateMany.mockResolvedValue({ modifiedCount: 1 });

        await h.handlers.markChatAsRead({ chatId });

        const broadcast = h.roomEmits.find(e => e.event === 'messagesReadUpdate');
        expect(broadcast.room).toBe(chatId);
        expect(broadcast.payload.messageIds).toEqual(['msg-1']);
        expect(broadcast.payload.reader).toEqual({ userId: 'user-1', username: 'alice' });
    });

    // readBy is read BEFORE the update here, unlike markMessagesAsRead which
    // re-reads after. Forgetting to add this reader in means nothing is ever
    // reported as read-by-all and the sender's ticks never complete.
    it('counts this reader when deciding read-by-all', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));
        h.Message.find.mockReturnValue(selectLean([
            { _id: 'msg-1', sender: 'user-2', readBy: [] }
        ]));
        h.Message.updateMany.mockResolvedValue({ modifiedCount: 1 });

        await h.handlers.markChatAsRead({ chatId });

        const broadcast = h.roomEmits.find(e => e.event === 'messagesReadUpdate');
        expect(broadcast.payload.messagesReadByAll).toEqual(['msg-1']);
    });

    it('does not write or broadcast when nothing is unread', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean({ participants: ['user-1', 'user-2'] }));
        h.Message.find.mockReturnValue(selectLean([]));

        await h.handlers.markChatAsRead({ chatId });

        expect(h.Message.updateMany).not.toHaveBeenCalled();
        expect(h.roomEmits).toHaveLength(0);
        // Nothing to say - and no ack, since no client listens for one.
        expect(h.socketEmits).toHaveLength(0);
    });

    it('refuses a chat the user does not participate in', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(selectLean(null));

        await h.handlers.markChatAsRead({ chatId });

        expect(h.Message.updateMany).not.toHaveBeenCalled();
        expect(h.socketEmits[0].event).toBe('statusError');
    });

    it('rejects a missing chatId and survives an undefined payload', async () => {
        const h = buildHarness();

        await expect(h.handlers.markChatAsRead()).resolves.not.toThrow();
        await h.handlers.markChatAsRead({});

        expect(h.socketEmits).toHaveLength(2);
        expect(h.socketEmits[0].event).toBe('statusError');
        expect(h.logger.error).not.toHaveBeenCalled(); // handled, not crashed
    });

    // Gotcha 1: a catch that reads a const declared inside the try throws
    // ReferenceError and masks the real error.
    it('logs a DB failure with the chatId still in scope', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockImplementation(() => { throw new Error('mongo is down'); });

        await expect(h.handlers.markChatAsRead({ chatId })).resolves.toBeUndefined();

        expect(h.logger.error).toHaveBeenCalled();
        expect(h.logger.error.mock.calls[0][0]).toContain(chatId);
    });
});
