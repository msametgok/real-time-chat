const { isParticipant, findChatForParticipant } = require('../chatAuth');

// Stand-in for a Mongoose ObjectId.
const oid = value => ({ toString: () => value });

describe('isParticipant', () => {
    it('accepts a participant given as a plain string', () => {
        expect(isParticipant({ participants: ['user-1', 'user-2'] }, 'user-1')).toBe(true);
    });

    it('rejects someone who is not in the chat', () => {
        expect(isParticipant({ participants: ['user-2'] }, 'user-1')).toBe(false);
    });

    // The three original idioms disagreed here: `.includes()` on raw ObjectIds
    // silently never matched a string userId.
    it('matches ObjectId-like participants against a string id', () => {
        expect(isParticipant({ participants: [oid('user-1')] }, 'user-1')).toBe(true);
    });

    it('matches a string participant against an ObjectId-like id', () => {
        expect(isParticipant({ participants: ['user-1'] }, oid('user-1'))).toBe(true);
    });

    // getChatDetails populates participants into full documents.
    it('looks through populated participant documents', () => {
        const chat = { participants: [{ _id: oid('user-1'), username: 'alice' }] };
        expect(isParticipant(chat, 'user-1')).toBe(true);
    });

    it('returns false rather than throwing on missing input', () => {
        expect(isParticipant(null, 'user-1')).toBe(false);
        expect(isParticipant({ participants: ['user-1'] }, undefined)).toBe(false);
        expect(isParticipant({}, 'user-1')).toBe(false);
        expect(isParticipant({ participants: [null] }, 'user-1')).toBe(false);
    });
});

describe('findChatForParticipant', () => {
    const chat = { _id: 'chat-1', participants: ['user-1', 'user-2'] };

    /** Mongoose chain stub: findOne(...).select(...).lean() */
    const mockChatModel = result => ({
        findOne: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
                lean: jest.fn().mockResolvedValue(result)
            })
        })
    });

    it('scopes the query to both the chat and the user', async () => {
        const Chat = mockChatModel(chat);

        await findChatForParticipant(Chat, 'chat-1', 'user-1');

        expect(Chat.findOne).toHaveBeenCalledWith({
            _id: 'chat-1',
            participants: 'user-1'
        });
    });

    it('returns the chat when the user participates', async () => {
        const Chat = mockChatModel(chat);
        await expect(findChatForParticipant(Chat, 'chat-1', 'user-1')).resolves.toEqual(chat);
    });

    // Authorization and existence are deliberately indistinguishable - a
    // non-participant should not learn whether the chat exists.
    it('returns null when the query matches nothing', async () => {
        const Chat = mockChatModel(null);
        await expect(findChatForParticipant(Chat, 'chat-1', 'stranger')).resolves.toBeNull();
    });

    it('selects only participants by default', async () => {
        const Chat = mockChatModel(chat);
        await findChatForParticipant(Chat, 'chat-1', 'user-1');

        const selectArg = Chat.findOne.mock.results[0].value.select.mock.calls[0][0];
        expect(selectArg).toBe('participants');
    });

    it('honours a caller-supplied projection', async () => {
        const Chat = mockChatModel(chat);
        await findChatForParticipant(Chat, 'chat-1', 'user-1', 'participants isGroupChat');

        const selectArg = Chat.findOne.mock.results[0].value.select.mock.calls[0][0];
        expect(selectArg).toBe('participants isGroupChat');
    });

    it('short-circuits without querying when ids are missing', async () => {
        const Chat = mockChatModel(chat);

        await expect(findChatForParticipant(Chat, null, 'user-1')).resolves.toBeNull();
        await expect(findChatForParticipant(Chat, 'chat-1', null)).resolves.toBeNull();

        expect(Chat.findOne).not.toHaveBeenCalled();
    });
});
