const logger = require('./logger');
// Loaded here rather than relied on from the caller: app.js reads this value at
// require time and does NOT load dotenv itself, so whether .env had been parsed
// by then depended on the require order of unrelated controllers.
require('dotenv').config();

// The dev-server origin. Only ever correct on a developer's machine - in a
// deployed environment it is a guaranteed-wrong answer, which is why reaching
// for it in production is logged loudly below.
const DEV_FALLBACK_ORIGIN = 'http://localhost:5173';

/**
 * Resolves the one browser origin allowed to talk to this backend, shared by
 * the Express CORS layer (app.js) and the Socket.IO handshake (config/socket.js).
 * Both used to inline `process.env.CLIENT_URL || 'http://localhost:5173'`, which
 * cost a live outage on 2026-07-29: CLIENT_URL was never set on the host, so the
 * deployed API answered every request with `Access-Control-Allow-Origin:
 * http://localhost:5173`.
 *
 * That failure is close to unreadable from the outside. The browser blocks the
 * response, so axios reports a bare "Network Error" with no status - identical
 * to the backend being down - while the static frontend still loads fine and
 * curl (which enforces nothing) sees a perfectly healthy 200. The server logs
 * said nothing at all.
 *
 * Deliberately a warning and not a fatal exit: DEPLOY.md's ordering requires the
 * backend to boot *before* the frontend URL exists (step 3 deploys with
 * CLIENT_URL unset, step 5 fills it in), so refusing to start would break the
 * documented first deploy.
 *
 * `log` is injectable for the same reason the socket handlers take their deps
 * that way - so a test can assert the warning without a winston transport.
 */
const resolveClientOrigin = (env = process.env, log = logger) => {
    // Trailing slashes are stripped because the value is compared against a
    // browser's Origin header, which is scheme+host+port and never carries a
    // path or a trailing slash. `https://x.vercel.app/` therefore matches
    // nothing, failing exactly as silently as being unset - and it is the
    // natural thing to paste, since that is what the address bar shows.
    const configured = (env.CLIENT_URL || '').trim().replace(/\/+$/, '');

    if (configured) {
        return configured;
    }

    if (env.NODE_ENV === 'production') {
        // Empty-but-present is worth distinguishing: the dashboard row exists,
        // so it looks configured, but '' is falsy and takes the same branch.
        const cause = env.CLIENT_URL === undefined
            ? 'CLIENT_URL is not set'
            : 'CLIENT_URL is set but empty';

        log.error(
            `${cause} while NODE_ENV=production. Falling back to ${DEV_FALLBACK_ORIGIN}, ` +
            'which no deployed browser can match: every cross-origin API call and ' +
            'every Socket.IO handshake will be blocked, and the client sees only an ' +
            'unexplained network error. Set CLIENT_URL to the exact frontend origin ' +
            '(scheme included, no trailing slash) and redeploy.'
        );
    }

    return DEV_FALLBACK_ORIGIN;
};

module.exports = {
    DEV_FALLBACK_ORIGIN,
    resolveClientOrigin,
    // Resolved once at require time so the warning lands during boot, next to
    // the other startup lines, instead of on the first request that fails.
    clientOrigin: resolveClientOrigin()
};
