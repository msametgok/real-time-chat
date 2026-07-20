/**
 * Delivery/read status computation.
 *
 * "Has everyone else seen this?" was written out by hand at five call sites in
 * two idioms - some comparing raw ObjectIds, some stringifying - which is the
 * kind of thing that fails silently rather than throwing (see gotcha 9 in
 * CLAUDE.md). This is the single implementation.
 *
 * The sender is always excluded: a message is delivered/read by its author by
 * definition, and counting them would mean a 1-on-1 chat never reaches
 * "delivered to all".
 */

/**
 * True when every participant other than `senderId` appears in `statusArray`.
 * Compares as strings throughout - callers mix ObjectIds and strings freely.
 */
const areAllOtherInArray = (statusArray = [], participants = [], senderId) => {
    if (!senderId) return false;

    const statusIds = (statusArray || []).map(id => id.toString());
    const others = (participants || [])
        .map(id => id.toString())
        .filter(pid => pid !== senderId.toString());

    // A solo chat has no "others", so the condition holds vacuously - every()
    // on an empty array is true, which is the behaviour we want.
    return others.every(pid => statusIds.includes(pid));
};

/**
 * `msg` needs `sender` and `deliveredTo`. Returns false for a null/absent
 * message rather than throwing - callers reach here with the result of a
 * guarded findOneAndUpdate, which is null whenever nothing changed.
 */
const computeDeliveredToAll = (msg, participants) =>
    !!msg && areAllOtherInArray(msg.deliveredTo, participants, msg.sender);

/** Same, for read receipts. `msg` needs `sender` and `readBy`. */
const computeReadByAll = (msg, participants) =>
    !!msg && areAllOtherInArray(msg.readBy, participants, msg.sender);

module.exports = { areAllOtherInArray, computeDeliveredToAll, computeReadByAll };
