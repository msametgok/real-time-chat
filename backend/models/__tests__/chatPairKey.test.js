const Chat = require('../Chat');

// Stand-in for an ObjectId.
const oid = value => ({ toString: () => value });

describe('Chat.buildPairKey', () => {
    // Sorting is the whole point: without it [a,b] and [b,a] are different
    // keys and the unique index would not stop a duplicate chat.
    it('is order-independent', () => {
        expect(Chat.buildPairKey(['bbb', 'aaa'])).toBe(Chat.buildPairKey(['aaa', 'bbb']));
    });

    it('joins the sorted ids with a colon', () => {
        expect(Chat.buildPairKey(['bbb', 'aaa'])).toBe('aaa:bbb');
    });

    it('handles ObjectId-like values', () => {
        expect(Chat.buildPairKey([oid('bbb'), oid('aaa')])).toBe('aaa:bbb');
    });

    it('handles populated participant documents', () => {
        expect(Chat.buildPairKey([
            { _id: oid('bbb'), username: 'bob' },
            { _id: oid('aaa'), username: 'alice' }
        ])).toBe('aaa:bbb');
    });

    // Group chats must not get a key - the unique index is partial on
    // { pairKey: { $type: 'string' } }, so a non-null value would make every
    // group chat compete for uniqueness.
    it('returns null for anything that is not a pair', () => {
        expect(Chat.buildPairKey(['a', 'b', 'c'])).toBeNull();
        expect(Chat.buildPairKey(['a'])).toBeNull();
        expect(Chat.buildPairKey([])).toBeNull();
        expect(Chat.buildPairKey()).toBeNull();
    });
});

describe('Chat schema wiring', () => {
    // Must be castable to ObjectId - an uncastable value leaves `participants`
    // empty and the hook has nothing to derive from.
    const ID_A = '6845057e478556f0ed971c8f';
    const ID_B = '685b2719c184304ba30c0dca';
    const ID_C = '6a5bba8db8c7ac6af3f93087';

    it('derives pairKey on validate for a 1-on-1 chat', async () => {
        const chat = new Chat({ isGroupChat: false, participants: [ID_B, ID_A] });

        await chat.validate().catch(() => {});

        expect(chat.pairKey).toBe(`${ID_A}:${ID_B}`);
    });

    it('leaves pairKey null for a group chat', async () => {
        const chat = new Chat({
            isGroupChat: true,
            chatName: 'group',
            participants: [ID_A, ID_B, ID_C],
            groupAdmin: ID_A
        });

        await chat.validate().catch(() => {});

        expect(chat.pairKey).toBeNull();
    });

    it('declares a unique partial index on pairKey', () => {
        const found = Chat.schema.indexes().find(([fields]) => fields.pairKey === 1);

        expect(found).toBeDefined();
        const [, options] = found;
        expect(options.unique).toBe(true);
        // Partial, so group chats (pairKey null) aren't indexed and don't
        // collide with one another.
        expect(options.partialFilterExpression).toEqual({ pairKey: { $type: 'string' } });
    });
});
