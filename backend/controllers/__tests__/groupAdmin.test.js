// Group admin actions: rename/avatar, add members, remove a member. All three
// are admin-gated and answer through cache invalidation plus a payload-free
// 'groupUpdated' broadcast that clients respond to by refetching.

let mockIO = null;

jest.mock('../../config/redis', () => ({ get: jest.fn(), set: jest.fn(), del: jest.fn() }));
jest.mock('../../config/socket', () => ({ getIO: () => mockIO }));
jest.mock('../../config/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../../models/Message', () => ({ deleteMany: jest.fn(), aggregate: jest.fn() }));
jest.mock('../../models/Chat', () => ({ findById: jest.fn() }));
jest.mock('../../models/User', () => ({ find: jest.fn() }));
jest.mock('../../utils/chatCache', () => ({ invalidateChatCache: jest.fn() }));
jest.mock('../../utils/encryption', () => ({ decryptMessageDoc: jest.fn(m => m) }));

const mongoose = require('mongoose');
const Chat = require('../../models/Chat');
const User = require('../../models/User');
const { invalidateChatCache } = require('../../utils/chatCache');
const chatController = require('../chatController');

const last = arr => arr[arr.length - 1];
const updateHandler = last(chatController.updateGroupChatDetails);
const addHandler = last(chatController.addGroupParticipants);
const removeHandler = last(chatController.removeGroupParticipant);

const ADMIN = new mongoose.Types.ObjectId();
const MEMBER = new mongoose.Types.ObjectId();
const THIRD = new mongoose.Types.ObjectId();
const OUTSIDER = new mongoose.Types.ObjectId();
const CHAT_ID = new mongoose.Types.ObjectId().toString();

const buildRes = () => ({
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
});

// Records every socket-layer call in order, so tests can assert the removed
// user's sockets LEAVE the room before the room-wide broadcast goes out.
const buildIO = () => {
    const calls = [];
    return {
        calls,
        to: jest.fn(room => ({
            emit: (event, payload) => calls.push({ type: 'emit', room, event, payload })
        })),
        in: jest.fn(room => ({
            socketsJoin: target => calls.push({ type: 'join', room, target }),
            socketsLeave: target => calls.push({ type: 'leave', room, target })
        }))
    };
};

const buildChat = ({ participants = [ADMIN, MEMBER, THIRD], groupAdmin = ADMIN, isGroupChat = true } = {}) => ({
    _id: CHAT_ID,
    isGroupChat,
    chatName: 'Old name',
    groupAvatarUrl: null,
    participants: [...participants],
    groupAdmin,
    save: jest.fn().mockResolvedValue(true)
});

// The populated .lean() chain addGroupParticipants uses for the newChat payload.
const populateChain = value => {
    const chain = {
        populate: jest.fn(() => chain),
        lean: jest.fn().mockResolvedValue(value)
    };
    return chain;
};

const req = ({ userId = ADMIN.toString(), body = {}, targetId } = {}) => ({
    params: { chatId: CHAT_ID, ...(targetId && { userId: targetId }) },
    user: { userId },
    body
});

beforeEach(() => {
    jest.clearAllMocks();
    mockIO = buildIO();
});

describe('updateGroupChatDetails', () => {
    it('lets the admin rename and broadcasts groupUpdated to the room', async () => {
        const chat = buildChat();
        Chat.findById.mockResolvedValue(chat);
        const res = buildRes();

        await updateHandler(req({ body: { chatName: 'New name' } }), res);

        expect(chat.chatName).toBe('New name');
        expect(chat.save).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);
        expect(invalidateChatCache).toHaveBeenCalledWith(
            [ADMIN, MEMBER, THIRD].map(String)
        );
        expect(mockIO.calls).toContainEqual(
            { type: 'emit', room: CHAT_ID, event: 'groupUpdated', payload: { chatId: CHAT_ID } }
        );
    });

    it('treats an empty avatar as removal', async () => {
        const chat = buildChat();
        chat.groupAvatarUrl = 'https://old/avatar.png';
        Chat.findById.mockResolvedValue(chat);

        await updateHandler(req({ body: { groupAvatarUrl: '' } }), buildRes());

        expect(chat.groupAvatarUrl).toBeNull();
        expect(chat.save).toHaveBeenCalled();
    });

    it('refuses a non-admin with 403', async () => {
        const chat = buildChat();
        Chat.findById.mockResolvedValue(chat);
        const res = buildRes();

        await updateHandler(req({ userId: MEMBER.toString(), body: { chatName: 'Hijack' } }), res);

        expect(res.statusCode).toBe(403);
        expect(chat.save).not.toHaveBeenCalled();
    });

    it('refuses a 1-on-1 chat with 400', async () => {
        Chat.findById.mockResolvedValue(buildChat({ isGroupChat: false, groupAdmin: null }));
        const res = buildRes();

        await updateHandler(req({ body: { chatName: 'Nope' } }), res);

        expect(res.statusCode).toBe(400);
    });

    it('refuses an empty update with 400', async () => {
        const res = buildRes();

        await updateHandler(req({ body: {} }), res);

        expect(res.statusCode).toBe(400);
        expect(Chat.findById).not.toHaveBeenCalled();
    });

    it('answers 404 to a non-participant, indistinguishable from missing', async () => {
        Chat.findById.mockResolvedValue(buildChat());
        const res = buildRes();

        await updateHandler(req({ userId: OUTSIDER.toString(), body: { chatName: 'X' } }), res);

        expect(res.statusCode).toBe(404);
    });
});

describe('addGroupParticipants', () => {
    const primeAdd = (chat, existingUsers) => {
        Chat.findById
            .mockResolvedValueOnce(chat)                       // hydrated doc
            .mockReturnValueOnce(populateChain({               // populated payload
                _id: CHAT_ID, isGroupChat: true, chatName: chat.chatName,
                participants: [], groupAdmin: null, latestMessage: null
            }));
        User.find.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(existingUsers)
            })
        });
    };

    it('adds the newcomer, joins their sockets to the room, and sends them the chat', async () => {
        const chat = buildChat({ participants: [ADMIN, MEMBER] });
        primeAdd(chat, [{ _id: OUTSIDER }]);
        const res = buildRes();

        await addHandler(req({ body: { userIds: [OUTSIDER.toString()] } }), res);

        expect(chat.participants.map(String)).toContain(OUTSIDER.toString());
        expect(chat.save).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);

        // Server-side room join: their client cannot join a chat it does not know.
        expect(mockIO.calls).toContainEqual(
            { type: 'join', room: `user-${OUTSIDER}`, target: CHAT_ID }
        );
        // The newcomer gets the chat itself; the room gets the change signal.
        const newChat = mockIO.calls.find(c => c.event === 'newChat');
        expect(newChat.room).toBe(`user-${OUTSIDER}`);
        expect(mockIO.calls).toContainEqual(
            { type: 'emit', room: CHAT_ID, event: 'groupUpdated', payload: { chatId: CHAT_ID } }
        );
    });

    it('rejects a list of people who are all already members', async () => {
        const chat = buildChat({ participants: [ADMIN, MEMBER] });
        Chat.findById.mockResolvedValue(chat);
        const res = buildRes();

        await addHandler(req({ body: { userIds: [MEMBER.toString()] } }), res);

        expect(res.statusCode).toBe(400);
        expect(chat.save).not.toHaveBeenCalled();
    });

    // A typo'd id must not become a ghost participant that breaks every
    // later .username access.
    it('answers 404 when none of the ids exist', async () => {
        const chat = buildChat({ participants: [ADMIN, MEMBER] });
        // Not primeAdd: this path never reaches the populated refetch, and a
        // queued -Once value would leak into the next test's findById.
        Chat.findById.mockResolvedValue(chat);
        User.find.mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue([])
            })
        });
        const res = buildRes();

        await addHandler(req({ body: { userIds: [OUTSIDER.toString()] } }), res);

        expect(res.statusCode).toBe(404);
        expect(chat.save).not.toHaveBeenCalled();
    });

    it('refuses a non-admin with 403', async () => {
        Chat.findById.mockResolvedValue(buildChat());
        const res = buildRes();

        await addHandler(req({ userId: MEMBER.toString(), body: { userIds: [OUTSIDER.toString()] } }), res);

        expect(res.statusCode).toBe(403);
    });
});

describe('removeGroupParticipant', () => {
    it('removes the member, pulls their sockets from the room BEFORE broadcasting', async () => {
        const chat = buildChat();
        Chat.findById.mockResolvedValue(chat);
        const res = buildRes();

        await removeHandler(req({ targetId: THIRD.toString() }), res);

        expect(chat.participants.map(String)).not.toContain(THIRD.toString());
        expect(chat.save).toHaveBeenCalled();
        expect(res.statusCode).toBe(200);

        const types = mockIO.calls.map(c => c.type === 'emit' ? c.event : c.type);
        const leaveAt = types.indexOf('leave');
        const removedAt = types.indexOf('removedFromGroup');
        const updatedAt = types.indexOf('groupUpdated');
        // Leave first, or the room-wide groupUpdated still reaches the
        // removed user's sockets.
        expect(leaveAt).toBeGreaterThanOrEqual(0);
        expect(leaveAt).toBeLessThan(updatedAt);
        // And they are told on the personal room they never leave.
        expect(mockIO.calls[removedAt].room).toBe(`user-${THIRD}`);

        expect(invalidateChatCache).toHaveBeenCalledWith(
            [THIRD.toString(), ADMIN.toString(), MEMBER.toString()]
        );
    });

    it('refuses to remove the admin themselves', async () => {
        Chat.findById.mockResolvedValue(buildChat());
        const res = buildRes();

        await removeHandler(req({ targetId: ADMIN.toString() }), res);

        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/leave/i);
    });

    it('answers 404 for someone who is not a member', async () => {
        Chat.findById.mockResolvedValue(buildChat());
        const res = buildRes();

        await removeHandler(req({ targetId: OUTSIDER.toString() }), res);

        expect(res.statusCode).toBe(404);
    });

    // The schema also enforces the floor on save; the handler answers with a
    // usable message instead of a validation error.
    it('refuses to shrink a group below 2 members', async () => {
        const chat = buildChat({ participants: [ADMIN, MEMBER] });
        Chat.findById.mockResolvedValue(chat);
        const res = buildRes();

        await removeHandler(req({ targetId: MEMBER.toString() }), res);

        expect(res.statusCode).toBe(400);
        expect(chat.save).not.toHaveBeenCalled();
    });

    it('refuses a non-admin with 403', async () => {
        Chat.findById.mockResolvedValue(buildChat());
        const res = buildRes();

        await removeHandler(req({ userId: MEMBER.toString(), targetId: THIRD.toString() }), res);

        expect(res.statusCode).toBe(403);
    });
});
