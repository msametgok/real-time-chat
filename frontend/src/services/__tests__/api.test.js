import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock factories are hoisted above module scope, so the stub has to be
// created inside vi.hoisted or the factory closes over a dead binding.
const { request } = vi.hoisted(() => ({ request: vi.fn() }));

// The module builds its client at import time via axios.create.
vi.mock('axios', () => ({
    default: { create: vi.fn(() => request) }
}));

import api from '../api';

const PASSWORD = 'hunter2-should-never-be-logged';
const SECRET_MESSAGE = 'private message text that must not be logged';

let logSpy, errorSpy, warnSpy, infoSpy, debugSpy;

/** Everything written to the console during a call, flattened to one string. */
const consoleOutput = () =>
    [logSpy, errorSpy, warnSpy, infoSpy, debugSpy]
        .flatMap(spy => spy.mock.calls)
        .flat()
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' ');

beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('api does not leak secrets to the console', () => {
    // The request logger printed `data` verbatim. For login and register that
    // object is { email, password } - the token was redacted, the password
    // was not.
    it('never logs the password on login', async () => {
        request.mockResolvedValue({ data: { token: 't', user: {} } });

        await api.login('alice@example.com', PASSWORD);

        expect(consoleOutput()).not.toContain(PASSWORD);
    });

    it('never logs the password on register', async () => {
        request.mockResolvedValue({ data: { token: 't', user: {} } });

        await api.register('alice', 'alice@example.com', PASSWORD);

        expect(consoleOutput()).not.toContain(PASSWORD);
    });

    // Responses were logged wholesale, and message content is decrypted by the
    // time it reaches the client.
    it('never logs decrypted message content from a response', async () => {
        request.mockResolvedValue({
            data: { messages: [{ _id: 'm1', content: SECRET_MESSAGE }] }
        });

        await api.getChatMessages('chat-1', 'token');

        expect(consoleOutput()).not.toContain(SECRET_MESSAGE);
    });

    it('never logs the auth token', async () => {
        request.mockResolvedValue({ data: [] });

        await api.getUserChats('super-secret-jwt');

        expect(consoleOutput()).not.toContain('super-secret-jwt');
    });

    it('does not log the request body when the request fails', async () => {
        request.mockRejectedValue({
            response: { data: { message: 'Invalid credentials' } }
        });

        await expect(api.login('alice@example.com', PASSWORD)).rejects.toThrow();

        expect(consoleOutput()).not.toContain(PASSWORD);
    });
});

describe('api still behaves', () => {
    it('returns the response body', async () => {
        request.mockResolvedValue({ data: { ok: true } });
        await expect(api.getUserChats('t')).resolves.toEqual({ ok: true });
    });

    it('surfaces the server message on failure', async () => {
        request.mockRejectedValue({
            response: { data: { message: 'Invalid Chat ID format.' } }
        });

        await expect(api.getUserChats('t')).rejects.toThrow('Invalid Chat ID format.');
    });

    it('attaches the bearer token when one is given', async () => {
        request.mockResolvedValue({ data: {} });

        await api.getUserChats('my-token');

        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({
                headers: { Authorization: 'Bearer my-token' }
            })
        );
    });
});
