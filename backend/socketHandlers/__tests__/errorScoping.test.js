const initializeChatEventHandlers = require('../chatEvents');
const initializeTypingEventHandlers = require('../typingEvents');
const initializeStatusEventHandlers = require('../statusEvents');

/**
 * Every socket handler used to declare `chatId`/`username` with `const` INSIDE
 * its try block, then reference them from the catch. The catch is a sibling
 * scope, so it threw `ReferenceError: chatId is not defined` - masking the real
 * error and skipping the socket.emit that tells the client something failed.
 *
 * These tests force a throw inside each handler and assert the catch survives:
 * it must log, and (where applicable) emit an error event back to the client.
 */
const buildHarness = (initializer, { failWith = new Error('boom') } = {}) => {
    const handlers = {};
    const socketEmits = [];

    const socket = {
        id: 'socket-1',
        user: { userId: 'user-1', username: 'alice' },
        // In chat-1's room: the typing handlers authorize by room membership,
        // and these tests need to reach the throwing Redis call beyond it.
        rooms: new Set(['socket-1', 'user-user-1', 'chat-1']),
        on: (event, fn) => { handlers[event] = fn; },
        emit: (event, payload) => { socketEmits.push({ event, payload }); return socket; },
        join: jest.fn(),
        leave: jest.fn(),
        to: jest.fn(() => ({ emit: jest.fn() }))
    };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    const io = { to: jest.fn(() => ({ emit: jest.fn() })) };

    // Every DB/Redis touchpoint throws, so each handler enters its catch.
    const thrower = () => { throw failWith; };
    const Chat = { findOne: thrower, findById: thrower };
    const Message = { findOneAndUpdate: thrower, updateMany: thrower, find: thrower };
    const redis = { set: thrower, del: thrower };

    initializer({
        io, socket, logger, redis, Chat, Message,
        encrypt: v => v,
        decryptMessageDoc: msg => msg,
        invalidateChatCache: jest.fn()
    });

    return { handlers, socketEmits, logger };
};

describe('catch blocks can read their handler-scoped variables', () => {
    const cases = [
        { name: 'joinChat', init: initializeChatEventHandlers, payload: { chatId: 'chat-1' }, errorEvent: 'chatError' },
        { name: 'sendMessage', init: initializeChatEventHandlers, payload: { chatId: 'chat-1', messageType: 'text', content: 'hi', tempId: 't-1' }, errorEvent: 'messageError' },
        { name: 'typingStart', init: initializeTypingEventHandlers, payload: { chatId: 'chat-1' }, errorEvent: null },
        { name: 'typingStop', init: initializeTypingEventHandlers, payload: { chatId: 'chat-1' }, errorEvent: null },
        { name: 'markMessagesAsRead', init: initializeStatusEventHandlers, payload: { chatId: 'chat-1', messageIds: ['m1'] }, errorEvent: 'statusError' }
    ];

    cases.forEach(({ name, init, payload, errorEvent }) => {
        describe(name, () => {
            it('does not throw out of the handler when the body fails', async () => {
                const h = buildHarness(init);
                await expect(h.handlers[name](payload)).resolves.not.toThrow();
            });

            it('logs the ORIGINAL error, not a ReferenceError', async () => {
                const h = buildHarness(init);
                await h.handlers[name](payload);

                expect(h.logger.error).toHaveBeenCalled();
                const logged = h.logger.error.mock.calls[0].join(' ');

                expect(logged).toContain('boom');
                expect(logged).not.toContain('ReferenceError');
                expect(logged).not.toContain('is not defined');
            });

            it('interpolates the real chatId and username into the log', async () => {
                const h = buildHarness(init);
                await h.handlers[name](payload);

                const logged = h.logger.error.mock.calls[0][0];
                expect(logged).toContain('chat-1');   // not "undefined"
                expect(logged).toContain('alice');
            });

            if (errorEvent) {
                it(`still emits ${errorEvent} to the client`, async () => {
                    const h = buildHarness(init);
                    await h.handlers[name](payload);

                    const emitted = h.socketEmits.find(e => e.event === errorEvent);
                    expect(emitted).toBeDefined();
                });
            }
        });
    });
});

describe('sendMessage error payloads carry tempId', () => {
    // Without tempId the client cannot identify which optimistic bubble to
    // fail, so it spins forever even though the server reported the error.
    const tempId = 'temp-abc';

    it('includes tempId when the send throws', async () => {
        const h = buildHarness(initializeChatEventHandlers);
        await h.handlers.sendMessage({ chatId: 'chat-1', messageType: 'text', content: 'hi', tempId });

        const err = h.socketEmits.find(e => e.event === 'messageError');
        expect(err.payload.tempId).toBe(tempId);
    });

    it('includes tempId when required fields are missing', async () => {
        const h = buildHarness(initializeChatEventHandlers);
        await h.handlers.sendMessage({ tempId });

        const err = h.socketEmits.find(e => e.event === 'messageError');
        expect(err.payload.tempId).toBe(tempId);
    });

    it('includes tempId when the user is not a participant', async () => {
        const h = buildHarness(initializeChatEventHandlers);
        // findOne resolving to null (not throwing) = access denied path
        const handlers = {};
        const socketEmits = [];
        const socket = {
            id: 's', user: { userId: 'user-1', username: 'alice' },
            on: (e, fn) => { handlers[e] = fn; },
            emit: (event, payload) => { socketEmits.push({ event, payload }); return socket; },
            join: jest.fn(), to: jest.fn(() => ({ emit: jest.fn() }))
        };
        initializeChatEventHandlers({
            io: { to: jest.fn(() => ({ emit: jest.fn() })) },
            socket,
            logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            redis: {},
            // findChatForParticipant chains .select(...).lean()
            Chat: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
            Message: {},
            encrypt: v => v, decryptMessageDoc: msg => msg,
            invalidateChatCache: jest.fn()
        });

        await handlers.sendMessage({ chatId: 'chat-1', messageType: 'text', content: 'hi', tempId });

        const err = socketEmits.find(e => e.event === 'messageError');
        expect(err.payload.tempId).toBe(tempId);
        expect(err.payload.message).toMatch(/denied/i);
    });
});
