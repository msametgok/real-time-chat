// Deleting a 1-on-1 chat used to remove the chat AND every message for BOTH
// participants: one person tidying their sidebar destroyed the other person's
// history, irreversibly and with no warning. It is now a per-user soft delete.

jest.mock('../../config/redis', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('../../config/socket', () => ({ getIO: () => null }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../../models/Message', () => ({ deleteMany: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../models/Chat', () => ({ findById: jest.fn(), findByIdAndDelete: jest.fn() }));
jest.mock('../../models/User', () => ({}));
jest.mock('../../utils/chatCache', () => ({ invalidateChatCache: jest.fn() }));

const mongoose = require('mongoose');
const Chat = require('../../models/Chat');
const Message = require('../../models/Message');
const { invalidateChatCache } = require('../../utils/chatCache');
const chatController = require('../chatController');

// The export is a validator array; the request handler is the last entry.
const handler = chatController.deleteOrLeaveChat[chatController.deleteOrLeaveChat.length - 1];

const ME = new mongoose.Types.ObjectId();
const THEM = new mongoose.Types.ObjectId();
const CHAT_ID = new mongoose.Types.ObjectId().toString();

const buildRes = () => {
    const res = {
        statusCode: null,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; }
    };
    return res;
};

// A stand-in for the hydrated Mongoose doc the handler mutates and saves.
const buildChat = ({ isGroupChat = false, deletedFor = [], participants = [ME, THEM] } = {}) => ({
    _id: CHAT_ID,
    isGroupChat,
    participants,
    deletedFor: [...deletedFor],
    groupAdmin: null,
    save: jest.fn().mockResolvedValue(true)
});

const run = chat => {
    Chat.findById.mockResolvedValue(chat);
    const res = buildRes();
    return handler({ params: { chatId: CHAT_ID }, user: { userId: ME.toString() } }, res)
        .then(() => res);
};

beforeEach(() => jest.clearAllMocks());

describe('deleteOrLeaveChat - 1-on-1', () => {
    it('hides the chat for the caller instead of deleting anything', async () => {
        const chat = buildChat();

        const res = await run(chat);

        expect(Message.deleteMany).not.toHaveBeenCalled();
        expect(Chat.findByIdAndDelete).not.toHaveBeenCalled();
        expect(chat.save).toHaveBeenCalled();
        expect(chat.deletedFor.map(String)).toEqual([ME.toString()]);
        expect(res.statusCode).toBe(200);
    });

    // The other participant's view is untouched, so only the caller's cached
    // chat list is stale.
    it('invalidates only the caller\'s chat cache', async () => {
        await run(buildChat());

        expect(invalidateChatCache).toHaveBeenCalledWith([ME.toString()]);
    });

    it('is idempotent - deleting twice does not duplicate the entry', async () => {
        const chat = buildChat({ deletedFor: [ME] });

        await run(chat);

        expect(chat.deletedFor.map(String)).toEqual([ME.toString()]);
        expect(Chat.findByIdAndDelete).not.toHaveBeenCalled();
    });

    // Once nobody can reach it, keeping the rows serves no one.
    it('hard-deletes once every participant has hidden it', async () => {
        const chat = buildChat({ deletedFor: [THEM] });

        const res = await run(chat);

        expect(Message.deleteMany).toHaveBeenCalledWith({ chat: CHAT_ID });
        expect(Chat.findByIdAndDelete).toHaveBeenCalledWith(CHAT_ID);
        expect(res.body.message).toMatch(/all participants/i);
    });

    it('refuses a chat the caller is not part of', async () => {
        const stranger = new mongoose.Types.ObjectId();
        const chat = buildChat({ participants: [THEM, stranger] });

        const res = await run(chat);

        expect(res.statusCode).toBe(403);
        expect(chat.save).not.toHaveBeenCalled();
    });

    it('404s on a chat that does not exist', async () => {
        const res = await run(null);

        expect(res.statusCode).toBe(404);
        expect(Message.deleteMany).not.toHaveBeenCalled();
    });
});

describe('deleteOrLeaveChat - group', () => {
    // Leaving a group is a real removal, not a soft delete: the others need to
    // stop seeing you as a member.
    it('removes the caller from participants rather than hiding', async () => {
        const third = new mongoose.Types.ObjectId();
        const chat = buildChat({ isGroupChat: true, participants: [ME, THEM, third] });
        chat.participants = chat.participants.map(id => ({
            equals: other => id.toString() === other.toString(),
            toString: () => id.toString()
        }));

        const res = await run(chat);

        expect(chat.participants).toHaveLength(2);
        expect(chat.deletedFor).toHaveLength(0);
        expect(res.body.message).toMatch(/left the group/i);
    });
});
