const initializeTypingEventHandlers = require('../typingEvents');

/**
 * Fake `deps` matching what config/socket.js passes in. See
 * statusEvents.test.js for the original of this pattern.
 */
const buildHarness = ({ userId = 'user-1', username = 'alice' } = {}) => {
    const handlers = {};
    const roomEmits = [];

    const socket = {
        id: 'socket-1',
        user: { userId, username },
        rooms: new Set(['socket-1', `user-${userId}`]),
        on: (event, fn) => { handlers[event] = fn; },
        to: jest.fn(room => ({
            emit: (event, payload) => roomEmits.push({ room, event, payload })
        }))
    };

    const io = { to: jest.fn() };
    const redis = {
        set: jest.fn().mockResolvedValue('OK'),
        del: jest.fn().mockResolvedValue(1)
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    initializeTypingEventHandlers({ io, socket, logger, redis });

    return { handlers, roomEmits, socket, redis, logger };
};

describe('typing Redis keys', () => {
    // getTypingKey's signature is (chatId, userId) but both call sites passed
    // (userId, chatId). Consistently swapped, so nothing broke visibly - but
    // the key namespace was inverted, which makes any future per-chat scan
    // (`typing:<chatId>:*`) silently match nothing.
    it('writes typingStart under typing:<chatId>:<userId>', async () => {
        const { handlers, redis } = buildHarness();

        await handlers.typingStart({ chatId: 'chat-9' });

        expect(redis.set).toHaveBeenCalledWith(
            'typing:chat-9:user-1', 'alice', 'EX', 10
        );
    });

    it('deletes the same key on typingStop', async () => {
        const { handlers, redis } = buildHarness();

        await handlers.typingStart({ chatId: 'chat-9' });
        await handlers.typingStop({ chatId: 'chat-9' });

        expect(redis.del).toHaveBeenCalledWith('typing:chat-9:user-1');
        expect(redis.del).toHaveBeenCalledWith(redis.set.mock.calls[0][0]);
    });
});

describe('typing broadcasts', () => {
    it('broadcasts isTyping true/false to the chat room with the chatId', async () => {
        const { handlers, roomEmits } = buildHarness();

        await handlers.typingStart({ chatId: 'chat-9' });
        await handlers.typingStop({ chatId: 'chat-9' });

        expect(roomEmits).toEqual([
            {
                room: 'chat-9',
                event: 'typing',
                payload: { chatId: 'chat-9', userId: 'user-1', username: 'alice', isTyping: true }
            },
            {
                room: 'chat-9',
                event: 'typing',
                payload: { chatId: 'chat-9', userId: 'user-1', username: 'alice', isTyping: false }
            }
        ]);
    });

    it('ignores an event with no chatId instead of throwing', async () => {
        const { handlers, roomEmits, redis, logger } = buildHarness();

        await handlers.typingStart({});
        await handlers.typingStop(undefined);

        expect(roomEmits).toHaveLength(0);
        expect(redis.set).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });
});
