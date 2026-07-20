/**
 * "Is this user allowed to touch this chat?" - written six times in three
 * idioms: a `findOne` with a participants filter, a `findById` followed by
 * `.map(String).includes()`, and a `findById` followed by `.some(p.equals())`.
 * Same question, three different ways to get it subtly wrong.
 *
 * Two entry points, because the call sites genuinely need different things:
 *
 *   findChatForParticipant - the common case. One query that both fetches and
 *   authorizes, returning null when the chat is missing OR the user isn't in
 *   it. Deliberately does not distinguish the two: telling a stranger that a
 *   chat exists but isn't theirs leaks more than it helps.
 *
 *   isParticipant - a pure predicate, for callers that must load the document
 *   themselves. deleteOrLeaveChat needs a hydrated Mongoose doc to mutate and
 *   save, so it can't use a lean helper.
 *
 * Error shape stays with the caller. Sockets emit chatError/messageError/
 * statusError with different payloads (messageError needs tempId), and the
 * controllers answer 403 or 404. A wrapper owning that would need the event
 * name and extra payload passed in - as much code as the call site it replaced.
 */

/**
 * True when `userId` is among `chat.participants`. Handles raw ObjectIds,
 * strings, and populated participant documents, comparing as strings
 * throughout - mixing the two forms in `.includes()` fails silently.
 */
const isParticipant = (chat, userId) => {
    if (!chat || !userId || !Array.isArray(chat.participants)) return false;

    const target = userId.toString();
    return chat.participants.some(p => {
        if (!p) return false;
        // Populated participants arrive as documents, not ids.
        const id = p._id ? p._id : p;
        return id.toString() === target;
    });
};

/**
 * Fetch a chat only if `userId` participates in it. Returns null otherwise -
 * missing and forbidden are indistinguishable by design.
 *
 * `Chat` is passed in rather than required here: socket handlers receive their
 * models through the injected `deps` object, which is what makes them testable
 * without a live Mongo.
 *
 * Throws whatever Mongoose throws on a malformed id (CastError); every call
 * site already runs inside a try/catch that reports it.
 */
const findChatForParticipant = async (Chat, chatId, userId, select = 'participants') => {
    if (!chatId || !userId) return null;

    const query = Chat.findOne({ _id: chatId, participants: userId });
    const chat = await (select ? query.select(select) : query).lean();
    return chat || null;
};

module.exports = { isParticipant, findChatForParticipant };
