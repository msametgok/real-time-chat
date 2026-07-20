// The unread badge used to be client-only: ChatContext incremented it on a
// `newMessage` socket event. Messages that arrived while the recipient was
// offline fired no event, so they appeared in the sidebar with no count.
// attachUnreadCounts is the server-side starting number.

// chatController pulls in the shared ioredis client and the Socket.IO
// singleton at require time; neither belongs in a unit test.
jest.mock('../../config/redis', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('../../config/socket', () => ({ getIO: () => null }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../../models/Message', () => ({ aggregate: jest.fn() }));

const mongoose = require('mongoose');
const Message = require('../../models/Message');
const { attachUnreadCounts } = require('../chatController');

const oid = () => new mongoose.Types.ObjectId().toString();

const USER = oid();
const CHAT_A = oid();
const CHAT_B = oid();

const chat = id => ({ _id: id, displayChatName: 'someone', latestMessage: { content: 'hi' } });

beforeEach(() => {
    jest.clearAllMocks();
});

describe('attachUnreadCounts', () => {
    it('attaches the per-chat count returned by the aggregate', async () => {
        Message.aggregate.mockResolvedValue([
            { _id: new mongoose.Types.ObjectId(CHAT_A), count: 3 }
        ]);

        const result = await attachUnreadCounts([chat(CHAT_A), chat(CHAT_B)], USER);

        expect(result.find(c => c._id === CHAT_A).unreadCount).toBe(3);
        // A chat with nothing unread must be 0, not undefined - the badge
        // renders NaN otherwise.
        expect(result.find(c => c._id === CHAT_B).unreadCount).toBe(0);
    });

    it('preserves the existing chat fields', async () => {
        Message.aggregate.mockResolvedValue([]);

        const [result] = await attachUnreadCounts([chat(CHAT_A)], USER);

        expect(result.displayChatName).toBe('someone');
        expect(result.latestMessage).toEqual({ content: 'hi' });
    });

    // The whole point: only messages someone else sent, and only ones this
    // user has not read. Counting your own sends would badge every chat you
    // ever spoke in.
    it('excludes the user\'s own messages and anything already read', async () => {
        Message.aggregate.mockResolvedValue([]);

        await attachUnreadCounts([chat(CHAT_A)], USER);

        const [[stage]] = Message.aggregate.mock.calls;
        const match = stage[0].$match;

        expect(match.sender).toEqual({ $ne: expect.anything() });
        expect(match.sender.$ne.toString()).toBe(USER);
        // $ne on an array field matches docs whose array lacks the value.
        expect(match.readBy.$ne.toString()).toBe(USER);
        expect(match.chat.$in.map(String)).toEqual([CHAT_A]);
    });

    it('does not query at all for an empty chat list', async () => {
        const result = await attachUnreadCounts([], USER);

        expect(result).toEqual([]);
        expect(Message.aggregate).not.toHaveBeenCalled();
    });

    it('counts each chat independently', async () => {
        Message.aggregate.mockResolvedValue([
            { _id: new mongoose.Types.ObjectId(CHAT_A), count: 1 },
            { _id: new mongoose.Types.ObjectId(CHAT_B), count: 12 }
        ]);

        const result = await attachUnreadCounts([chat(CHAT_A), chat(CHAT_B)], USER);

        expect(result.map(c => c.unreadCount)).toEqual([1, 12]);
    });
});
