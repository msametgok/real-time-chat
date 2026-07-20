const {
    syncUserSockets,
    recordLastSeen,
    SOCKET_SET_TTL_SECONDS,
    LAST_SEEN_TTL_SECONDS
} = require('../presence');

const buildIo = (socketIds = []) => ({
    in: jest.fn(() => ({ allSockets: jest.fn().mockResolvedValue(new Set(socketIds)) }))
});

/**
 * ioredis multi() builder: records the queued commands in order and resolves
 * exec() to the [err, result] pairs the real client returns.
 */
const buildRedis = ({ scardResult = 0, scardError = null } = {}) => {
    const calls = [];
    const chain = {};
    ['del', 'sadd', 'expire', 'scard'].forEach(cmd => {
        chain[cmd] = jest.fn((...args) => { calls.push([cmd, ...args]); return chain; });
    });
    chain.exec = jest.fn().mockResolvedValue([
        [null, 1],
        [null, 1],
        [null, 1],
        [scardError, scardResult]
    ]);

    return {
        calls,
        chain,
        multi: jest.fn(() => chain),
        del: jest.fn().mockResolvedValue(1),
        set: jest.fn().mockResolvedValue('OK')
    };
};

describe('syncUserSockets', () => {
    it('rebuilds the set from live room membership', async () => {
        const io = buildIo(['s1', 's2']);
        const redis = buildRedis({ scardResult: 2 });

        const count = await syncUserSockets(io, redis, 'user-1');

        expect(io.in).toHaveBeenCalledWith('user-user-1');
        expect(redis.calls).toContainEqual(['sadd', 'userSockets:user-1', 's1', 's2']);
        expect(count).toBe(2);
    });

    // The whole point: del and sadd must not be separately awaited, or a
    // concurrent scard between them reads an empty set and reports a
    // genuinely-online user as offline.
    it('issues del and sadd in a single MULTI, not as separate awaits', async () => {
        const io = buildIo(['s1']);
        const redis = buildRedis({ scardResult: 1 });

        await syncUserSockets(io, redis, 'user-1');

        expect(redis.multi).toHaveBeenCalledTimes(1);
        expect(redis.chain.exec).toHaveBeenCalledTimes(1);
        expect(redis.calls.map(c => c[0])).toEqual(['del', 'sadd', 'expire', 'scard']);
        // The standalone del is only for the no-sockets path.
        expect(redis.del).not.toHaveBeenCalled();
    });

    it('puts a TTL on the set so a crashed process cannot leak it forever', async () => {
        const io = buildIo(['s1']);
        const redis = buildRedis({ scardResult: 1 });

        await syncUserSockets(io, redis, 'user-1');

        expect(redis.calls).toContainEqual(['expire', 'userSockets:user-1', SOCKET_SET_TTL_SECONDS]);
    });

    it('deletes the key and reports 0 when no sockets remain', async () => {
        const io = buildIo([]);
        const redis = buildRedis();

        const count = await syncUserSockets(io, redis, 'user-1');

        expect(count).toBe(0);
        expect(redis.del).toHaveBeenCalledWith('userSockets:user-1');
        // sadd with zero members is an error - the MULTI must be skipped.
        expect(redis.multi).not.toHaveBeenCalled();
    });

    it('surfaces a Redis error rather than reporting the user offline', async () => {
        const io = buildIo(['s1']);
        const redis = buildRedis({ scardError: new Error('redis exploded') });

        await expect(syncUserSockets(io, redis, 'user-1')).rejects.toThrow('redis exploded');
    });

    // Reporting 0 here would broadcast "offline" for someone we just recorded
    // as having open sockets.
    it('falls back to the written count if scard returns nothing usable', async () => {
        const io = buildIo(['s1', 's2']);
        const redis = buildRedis();
        // Overridden directly: buildRedis's default would coerce this to 0,
        // which is the value the assertion is meant to rule out.
        redis.chain.exec.mockResolvedValue([[null, 1], [null, 1], [null, 1], [null, undefined]]);

        await expect(syncUserSockets(io, redis, 'user-1')).resolves.toBe(2);
    });
});

describe('recordLastSeen', () => {
    it('stores an ISO timestamp with a TTL and returns it', async () => {
        const redis = buildRedis();
        const when = new Date('2026-07-20T00:00:00.000Z');

        const result = await recordLastSeen(redis, 'user-1', when);

        expect(result).toBe('2026-07-20T00:00:00.000Z');
        expect(redis.set).toHaveBeenCalledWith(
            'userLastSeen:user-1',
            '2026-07-20T00:00:00.000Z',
            'EX',
            LAST_SEEN_TTL_SECONDS
        );
    });

    it('defaults to now', async () => {
        const redis = buildRedis();
        const before = Date.now();

        const result = await recordLastSeen(redis, 'user-1');

        expect(new Date(result).getTime()).toBeGreaterThanOrEqual(before);
    });
});
