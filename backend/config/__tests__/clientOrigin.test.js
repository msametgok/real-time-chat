/**
 * These guard a failure with no runtime symptom on the server side at all: a
 * wrong CLIENT_URL produces a perfectly healthy backend that every browser is
 * blocked from talking to. Nothing throws, so only asserting the resolved value
 * and the warning will catch a regression.
 *
 * The resolver takes its env and logger as arguments, so nothing here touches
 * process.env - a leaked NODE_ENV would silently change other suites.
 */
const {
    resolveClientOrigin,
    DEV_FALLBACK_ORIGIN
} = require('../clientOrigin');

describe('resolveClientOrigin', () => {
    let log;

    beforeEach(() => {
        log = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    });

    it('uses CLIENT_URL when it is set', () => {
        const env = { NODE_ENV: 'production', CLIENT_URL: 'https://chat.vercel.app' };

        expect(resolveClientOrigin(env, log)).toBe('https://chat.vercel.app');
        expect(log.error).not.toHaveBeenCalled();
    });

    // A browser's Origin header is scheme+host+port with no trailing slash, so
    // an unstripped one matches nothing - and the address bar hands you one.
    it('strips a trailing slash so the value can match an Origin header', () => {
        const env = { CLIENT_URL: 'https://chat.vercel.app/' };

        expect(resolveClientOrigin(env, log)).toBe('https://chat.vercel.app');
    });

    it('strips repeated trailing slashes and surrounding whitespace', () => {
        const env = { CLIENT_URL: '  https://chat.vercel.app//  ' };

        expect(resolveClientOrigin(env, log)).toBe('https://chat.vercel.app');
    });

    it('falls back to the dev origin when CLIENT_URL is absent', () => {
        expect(resolveClientOrigin({}, log)).toBe(DEV_FALLBACK_ORIGIN);
    });

    // The actual 2026-07-29 outage: unset on the host, so the deployed API
    // advertised localhost:5173 to every browser and said nothing about it.
    it('logs an actionable error when production falls back', () => {
        resolveClientOrigin({ NODE_ENV: 'production' }, log);

        expect(log.error).toHaveBeenCalledTimes(1);
        const [message] = log.error.mock.calls[0];
        expect(message).toContain('CLIENT_URL is not set');
        expect(message).toContain(DEV_FALLBACK_ORIGIN);
    });

    // Present-but-empty is the more confusing shape: the dashboard row exists,
    // so it reads as configured, but '' is falsy and takes the same branch.
    it('distinguishes an empty CLIENT_URL from a missing one', () => {
        resolveClientOrigin({ NODE_ENV: 'production', CLIENT_URL: '' }, log);

        expect(log.error).toHaveBeenCalledTimes(1);
        expect(log.error.mock.calls[0][0]).toContain('CLIENT_URL is set but empty');
    });

    it('stays quiet outside production, where the dev origin is the right answer', () => {
        expect(resolveClientOrigin({ NODE_ENV: 'development' }, log)).toBe(DEV_FALLBACK_ORIGIN);
        expect(resolveClientOrigin({}, log)).toBe(DEV_FALLBACK_ORIGIN);
        expect(log.error).not.toHaveBeenCalled();
    });
});
