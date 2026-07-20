const {
    areAllOtherInArray,
    computeDeliveredToAll,
    computeReadByAll
} = require('../messageStatus');

// Stands in for a Mongoose ObjectId: not a string, but stringifies to one.
// The old inline copies compared these inconsistently - some stringified both
// sides, some didn't - which fails silently rather than throwing.
const oid = value => ({ toString: () => value });

describe('areAllOtherInArray', () => {
    it('ignores the sender when deciding', () => {
        // Sender is absent from the status array, which is normal.
        expect(areAllOtherInArray(['user-2'], ['user-1', 'user-2'], 'user-1')).toBe(true);
    });

    it('is false while any other participant is missing', () => {
        expect(areAllOtherInArray(['user-2'], ['user-1', 'user-2', 'user-3'], 'user-1')).toBe(false);
    });

    it('is true once every other participant is present', () => {
        expect(areAllOtherInArray(['user-2', 'user-3'], ['user-1', 'user-2', 'user-3'], 'user-1')).toBe(true);
    });

    it('compares ObjectId-like values against strings', () => {
        expect(areAllOtherInArray(
            [oid('user-2')],
            [oid('user-1'), oid('user-2')],
            oid('user-1')
        )).toBe(true);
    });

    it('is true for a solo chat, where there is nobody else to wait for', () => {
        expect(areAllOtherInArray([], ['user-1'], 'user-1')).toBe(true);
    });

    it('tolerates missing arrays', () => {
        expect(areAllOtherInArray(undefined, ['user-1', 'user-2'], 'user-1')).toBe(false);
        expect(areAllOtherInArray(['user-2'], undefined, 'user-1')).toBe(true);
    });

    it('returns false rather than throwing when the sender is unknown', () => {
        expect(areAllOtherInArray(['user-2'], ['user-1', 'user-2'], undefined)).toBe(false);
    });
});

describe('computeDeliveredToAll', () => {
    const participants = ['user-1', 'user-2'];

    it('is true when the only other participant has it', () => {
        expect(computeDeliveredToAll(
            { sender: 'user-1', deliveredTo: ['user-2'] }, participants
        )).toBe(true);
    });

    it('is false when nobody else has it yet', () => {
        expect(computeDeliveredToAll(
            { sender: 'user-1', deliveredTo: [] }, participants
        )).toBe(false);
    });

    // Callers pass the result of a findOneAndUpdate carrying a $ne guard, which
    // is null whenever nothing changed. Reading through it is what threw in
    // chatEvents and silently skipped cache invalidation.
    it('returns false for a null message instead of throwing', () => {
        expect(() => computeDeliveredToAll(null, participants)).not.toThrow();
        expect(computeDeliveredToAll(null, participants)).toBe(false);
        expect(computeDeliveredToAll(undefined, participants)).toBe(false);
    });
});

describe('computeReadByAll', () => {
    const participants = ['user-1', 'user-2', 'user-3'];

    it('reads the readBy field, not deliveredTo', () => {
        const msg = { sender: 'user-1', readBy: ['user-2', 'user-3'], deliveredTo: [] };
        expect(computeReadByAll(msg, participants)).toBe(true);
    });

    it('is false while one participant has not read it', () => {
        const msg = { sender: 'user-1', readBy: ['user-2'], deliveredTo: ['user-2', 'user-3'] };
        expect(computeReadByAll(msg, participants)).toBe(false);
    });

    it('returns false for a null message', () => {
        expect(computeReadByAll(null, participants)).toBe(false);
    });
});
