/**
 * Presence bookkeeping. Who is online is derived from Socket.IO room
 * membership - Redis only caches it so other processes can read it without
 * asking the adapter.
 *
 * The same five lines appeared on connect (config/socket.js) and on disconnect
 * (disconnectEvents.js), and they had a race: `del` followed by `sadd` leaves a
 * window where the key does not exist. A concurrent connection running `scard`
 * inside that window reads 0, concludes the user has no sockets, and
 * broadcasts a genuinely-online user as offline. Rare, self-correcting on the
 * next event, and impossible to reproduce on demand - so it read as a random
 * presence flicker. Both writes now go in one MULTI.
 */

/**
 * The socket set is rebuilt from scratch on every connect and disconnect, so a
 * TTL only matters when the process dies with users connected - otherwise the
 * key would claim those sockets forever. Deliberately generous: the cost of it
 * expiring under a still-open connection is showing an online user as offline,
 * which is the bug above. Seven days is far longer than any real session while
 * still bounding the leak.
 */
const SOCKET_SET_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Last-seen outlives sessions, but shouldn't accumulate forever either. */
const LAST_SEEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Re-derive `userSockets:<id>` from live room membership and return how many
 * sockets that user now has open. 0 means they just went offline.
 *
 * @param {object} io      Socket.IO server
 * @param {object} redis   ioredis client
 * @param {string} userId
 * @returns {Promise<number>} open socket count
 */
const syncUserSockets = async (io, redis, userId) => {
    const key = `userSockets:${userId}`;
    const liveSockets = Array.from(await io.in(`user-${userId}`).allSockets());

    // sadd with no members is an error, and there is nothing to expire.
    if (liveSockets.length === 0) {
        await redis.del(key);
        return 0;
    }

    const results = await redis
        .multi()
        .del(key)
        .sadd(key, ...liveSockets)
        .expire(key, SOCKET_SET_TTL_SECONDS)
        .scard(key)
        .exec();

    // ioredis resolves exec() to [[err, result], ...]; scard is the last.
    const scard = results?.[results.length - 1];
    if (scard?.[0]) throw scard[0];

    // Fall back to what we just wrote rather than reporting 0 and declaring a
    // connected user offline.
    return typeof scard?.[1] === 'number' ? scard[1] : liveSockets.length;
};

/** Record when a user went offline. Returns the timestamp that was stored. */
const recordLastSeen = async (redis, userId, when = new Date()) => {
    const timestamp = when.toISOString();
    await redis.set(`userLastSeen:${userId}`, timestamp, 'EX', LAST_SEEN_TTL_SECONDS);
    return timestamp;
};

module.exports = {
    syncUserSockets,
    recordLastSeen,
    SOCKET_SET_TTL_SECONDS,
    LAST_SEEN_TTL_SECONDS
};
