import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A fake socket.io client: records handlers so tests can fire connect /
// connect_error by hand.
const { ioFactory, lastSocket } = vi.hoisted(() => {
    const lastSocket = { current: null };
    const ioFactory = vi.fn(() => {
        const handlers = {};
        const socket = {
            connected: false,
            handlers,
            on: vi.fn((event, fn) => { handlers[event] = fn; }),
            off: vi.fn(),
            emit: vi.fn(),
            disconnect: vi.fn(),
            removeAllListeners: vi.fn(),
            fire: (event, arg) => handlers[event]?.(arg)
        };
        lastSocket.current = socket;
        return socket;
    });
    return { ioFactory, lastSocket };
});

vi.mock('socket.io-client', () => ({ default: ioFactory }));

import socketService, { CONNECT_TIMEOUT_MS } from '../socket';

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    socketService.socket = null;
    socketService.isConnected = false;
});

afterEach(() => vi.useRealTimers());

describe('connect() always settles', () => {
    it('resolves when the socket connects', async () => {
        const promise = socketService.connect('tok');
        lastSocket.current.fire('connect');

        await expect(promise).resolves.toBeUndefined();
    });

    it('rejects immediately on an auth error, without waiting out the timeout', async () => {
        const promise = socketService.connect('bad-token');
        lastSocket.current.fire('connect_error', new Error('Authentication Error: Invalid token.'));

        await expect(promise).rejects.toThrow('Authentication Error: Invalid token.');
    });

    // The bug: connect_error rejected only on two exact strings. Any other
    // failure left the promise pending forever, so the caller's .then never
    // ran and the app looked idle rather than broken.
    it('rejects on a transport error instead of hanging forever', async () => {
        const promise = socketService.connect('tok');
        const assertion = expect(promise).rejects.toThrow(/Could not reach the server/);

        lastSocket.current.fire('connect_error', new Error('xhr poll error'));
        // Still pending here on purpose - the retry loop may yet succeed.
        await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10);

        await assertion;
    });

    it('rejects on an auth error whose wording changed', async () => {
        const promise = socketService.connect('tok');
        lastSocket.current.fire('connect_error', new Error('Authentication Error: user not found.'));

        await expect(promise).rejects.toThrow(/Authentication Error/);
    });

    it('rejects when nothing happens at all', async () => {
        const promise = socketService.connect('tok');
        const assertion = expect(promise).rejects.toThrow(/Could not reach the server/);

        await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10);

        await assertion;
    });
});

describe('connect() transient failures still recover', () => {
    // Rejecting on every connect_error would turn a momentary blip into a hard
    // failure, even though socket.io retries underneath and may succeed.
    it('still resolves if a retry connects after a non-auth error', async () => {
        const promise = socketService.connect('tok');

        lastSocket.current.fire('connect_error', new Error('xhr poll error'));
        await vi.advanceTimersByTimeAsync(3000);
        lastSocket.current.fire('connect');

        await expect(promise).resolves.toBeUndefined();
    });

    it('does not reject after it has already resolved', async () => {
        const promise = socketService.connect('tok');
        lastSocket.current.fire('connect');
        await expect(promise).resolves.toBeUndefined();

        // A later drop must not retroactively fail the settled promise.
        lastSocket.current.fire('connect_error', new Error('Authentication Error: Invalid token.'));
        await vi.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS + 10);

        await expect(promise).resolves.toBeUndefined();
    });

    it('clears the timeout once connected', async () => {
        const clearSpy = vi.spyOn(globalThis, 'clearTimeout');

        const promise = socketService.connect('tok');
        lastSocket.current.fire('connect');
        await promise;

        expect(clearSpy).toHaveBeenCalled();
    });
});
