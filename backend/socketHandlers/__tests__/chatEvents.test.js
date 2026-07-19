const initializeChatEventHandlers = require('../chatEvents');

/**
 * Fake `deps` matching what config/socket.js passes in.
 *
 * `timeline` records every emit across all three channels in call order, so
 * tests can assert *sequencing* (ack before broadcast) and not just presence.
 */
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

    // `new Message(msg).save()` in the handler, plus a static findById.
    const savedDoc = { _id: 'msg-1' };
    const Message = jest.fn().mockImplementation(() => ({
        save: jest.fn().mockResolvedValue(savedDoc)
    }));
    Message.findById = jest.fn();
    Message.findOneAndUpdate = jest.fn();

    const encrypt = jest.fn(v => `enc(${v})`);
    const decrypt = jest.fn(v => v.replace(/^enc\((.*)\)$/, '$1'));
    const invalidateChatCache = jest.fn().mockResolvedValue(undefined);

    initializeChatEventHandlers({
        io, socket, logger, redis, Chat, Message, encrypt, decrypt, invalidateChatCache
    });

    const events = () => timeline.map(t => t.event);
    const find = event => timeline.filter(t => t.event === event);

    return {
        handlers, timeline, events, find,
        io, socket, logger, Chat, Message, encrypt, decrypt, invalidateChatCache
    };
};

const lean = value => ({ lean: jest.fn().mockResolvedValue(value) });
const populateLean = value => ({
    populate: jest.fn().mockReturnValue(lean(value))
});

const chatId = 'chat-1';

// A chat the sender is a participant of, with one other member.
const participantChat = { _id: chatId, participants: ['user-1', 'user-2'] };

const populatedMessage = {
    _id: 'msg-1',
    chat: chatId,
    sender: { _id: 'user-1', username: 'alice' },
    messageType: 'text',
    content: 'enc(hello)',
    deliveredTo: [],
    createdAt: '2026-07-19T00:00:00.000Z'
};

const primeSuccessfulSend = h => {
    h.Chat.findOne.mockReturnValue(lean(participantChat));
    h.Message.findById.mockReturnValue(populateLean({ ...populatedMessage }));
};

describe('sendMessage broadcast ordering', () => {
    // The ack is the only payload carrying tempId. If newMessage reaches the
    // sender first, the client cannot match it to the optimistic bubble and
    // falls back to guessing by content - which renders two identical messages
    // sent in a row permanently reversed.
    it('emits messageSentAck to the sender BEFORE broadcasting newMessage', async () => {
        const h = buildHarness();
        primeSuccessfulSend(h);

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const seq = h.events();
        const ackAt = seq.indexOf('messageSentAck');
        const newAt = seq.indexOf('newMessage');

        expect(ackAt).toBeGreaterThanOrEqual(0);
        expect(newAt).toBeGreaterThanOrEqual(0);
        expect(ackAt).toBeLessThan(newAt);
    });

    it('carries the tempId back on the ack so the client can reconcile', async () => {
        const h = buildHarness();
        primeSuccessfulSend(h);

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const [ack] = h.find('messageSentAck');
        expect(ack.payload.tempId).toBe('temp-abc');
        expect(ack.payload.message._id).toBe('msg-1');
    });

    // io.to() includes the sender; socket.to() excludes them. Using io.to()
    // delivered the message to the sender twice - once via the ack and once
    // via the broadcast - appending a duplicate bubble.
    it('broadcasts newMessage with socket.to (excludes sender), not io.to', async () => {
        const h = buildHarness();
        primeSuccessfulSend(h);

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const broadcasts = h.find('newMessage');
        expect(broadcasts).toHaveLength(1);
        expect(broadcasts[0].via).toBe('socket.to');
        expect(broadcasts[0].room).toBe(chatId);
    });

    it('does not deliver newMessage back to the sender', async () => {
        const h = buildHarness();
        primeSuccessfulSend(h);

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const toSender = h.timeline.filter(
            t => t.via === 'socket.emit' && t.event === 'newMessage'
        );
        expect(toSender).toHaveLength(0);
    });
});

describe('chatListUpdate removal', () => {
    // Everyone auto-joins all their chat rooms on connect, so the newMessage
    // broadcast already reaches every online participant. chatListUpdate was
    // emitted to the chat room AND each user-<id> room, so participants got it
    // twice on top of newMessage - three unread increments per message.
    it('emits no chatListUpdate anywhere on a successful send', async () => {
        const h = buildHarness();
        primeSuccessfulSend(h);

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        expect(h.events()).not.toContain('chatListUpdate');
    });

    it('does not fan out to per-user rooms for sidebar updates', async () => {
        const h = buildHarness();
        primeSuccessfulSend(h);

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const userRoomEmits = h.timeline.filter(t => String(t.room || '').startsWith('user-'));
        expect(userRoomEmits).toEqual([]);
    });
});

describe('sendMessage failure paths still reach the sender', () => {
    it('emits messageError with tempId when the chat is not the user\'s', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(lean(null));

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const [err] = h.find('messageError');
        expect(err.payload.tempId).toBe('temp-abc');
        expect(h.events()).not.toContain('newMessage');
    });

    it('emits messageError with tempId when the DB write throws', async () => {
        const h = buildHarness();
        h.Chat.findOne.mockReturnValue(lean(participantChat));
        h.Message.mockImplementation(() => ({
            save: jest.fn().mockRejectedValue(new Error('mongo down'))
        }));

        await h.handlers.sendMessage({
            chatId, messageType: 'text', content: 'hello', tempId: 'temp-abc'
        });

        const [err] = h.find('messageError');
        expect(err.payload.tempId).toBe('temp-abc');
        expect(err.payload.chatId).toBe(chatId);
    });
});
