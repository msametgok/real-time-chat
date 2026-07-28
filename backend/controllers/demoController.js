const logger = require('../config/logger');
const { isDemoMode } = require('../demo/companions');
const { provisionGuestSession } = require('../demo/seed');
const { scheduleIdleNudge } = require('../demo/bots');
const { deleteGuest } = require('../demo/cleanup');
const { issueAuthResponse } = require('./authController');

/**
 * Hand a visitor a throwaway account with the demo chats already in it.
 *
 * Answers with the same envelope as login and register, so the client can
 * reuse the existing token handling rather than growing a second auth path.
 *
 * A 404 rather than a 403 when demo mode is off: an endpoint that exists but
 * refuses is an invitation to find out why, and this one creates users.
 */
exports.startDemoSession = async (req, res) => {
    if (!isDemoMode()) {
        return res.status(404).json({ message: 'Not found' });
    }

    try {
        const { guest, chats } = await provisionGuestSession();

        // Fire-and-forget: the nudge is a nice-to-have and its timer must not
        // hold up the response.
        if (chats['online-idle']) {
            scheduleIdleNudge(chats['online-idle']._id);
        }

        return res.status(201).json({
            message: 'Demo session started.',
            ...issueAuthResponse(guest)
        });
    } catch (error) {
        logger.error(`Demo session provisioning failed: ${error.message}`, error);
        return res.status(500).json({ message: 'Could not start the demo. Please try again.' });
    }
};

/**
 * Delete the calling guest and everything seeded for them. Called on logout.
 *
 * Acts on `req.user.userId` from the verified token and nothing from the body,
 * so this cannot be pointed at another account. deleteGuest re-checks that the
 * id really is a guest, so a real user calling this is a no-op rather than a
 * way to delete yourself.
 *
 * Always answers 200. The client fires this while tearing down its session and
 * cannot do anything useful with a failure - the sweeper will collect the guest
 * within the day regardless.
 */
exports.endDemoSession = async (req, res) => {
    if (!isDemoMode()) {
        return res.status(404).json({ message: 'Not found' });
    }

    try {
        const removed = await deleteGuest(req.user?.userId);
        return res.status(200).json({ removed });
    } catch (error) {
        logger.error(`Demo session cleanup failed: ${error.message}`, error);
        return res.status(200).json({ removed: false });
    }
};
