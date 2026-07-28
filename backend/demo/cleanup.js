/**
 * Guest disposal.
 *
 * The public demo hands out a throwaway account on every visit, so without
 * this the users, chats and messages collections grow for as long as the demo
 * is linked from anywhere. Atlas M0 is 512 MB.
 *
 * There are two routes in, and BOTH are needed:
 *
 *  - Logging out deletes the guest immediately (endDemoSession).
 *  - The sweeper deletes whatever logging out never caught.
 *
 * The sweeper is not the fallback, it is the main path. Almost nobody clicks
 * "log out" on a demo they were curious about - they close the tab, which
 * fires no request we can act on. (A beforeunload beacon cannot help either:
 * sendBeacon has no way to set an Authorization header.) Deleting on logout is
 * still worth having because it is instant and exact; the sweeper is what
 * actually bounds the collection size.
 */

const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const logger = require('../config/logger');
const { removeUploadedFile } = require('../utils/uploads');
const { invalidateChatCache } = require('../utils/chatCache');
const { isDemoMode, GUEST_EMAIL_PREFIX } = require('./companions');

/**
 * How long an abandoned guest survives. Generous on purpose - a visitor may
 * leave the tab open and come back to it - but far short of anything that
 * would let the collection grow without bound.
 */
const GUEST_TTL_MS = 24 * 60 * 60 * 1000;

/** How often the sweeper runs once the server is up. */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Guests only. Companions share `isDemo: true` and must never be touched. */
const guestFilter = {
    isDemo: true,
    email: { $regex: `^${GUEST_EMAIL_PREFIX}` }
};

let sweepTimer = null;

/**
 * Delete one guest and everything that existed only for them.
 *
 * Deliberately re-checks that the id really is a guest rather than trusting
 * the caller. `isDemo` alone is not enough: the companions carry it too, and
 * deleting one of those would cascade into every live visitor's chats, since
 * every seeded conversation has a companion as the other participant. The
 * email prefix is the thing that separates them.
 *
 * @returns {Promise<boolean>} whether anything was deleted
 */
const deleteGuest = async (userId) => {
    if (!userId) return false;

    const guest = await User.findOne({ _id: userId, ...guestFilter })
        .select('_id username').lean();
    if (!guest) return false;

    const chats = await Chat.find({ participants: userId })
        .select('_id participants').lean();
    const chatIds = chats.map(c => c._id);

    if (chatIds.length) {
        // Uploads live on disk, not in Mongo, so dropping the messages would
        // otherwise orphan the files forever - and on a host with an ephemeral
        // disk they are invisible until the disk fills.
        const withFiles = await Message
            .find({ chat: { $in: chatIds }, fileUrl: { $nin: [null, ''] } })
            .select('fileUrl').lean();
        withFiles.forEach(m => removeUploadedFile(m.fileUrl));

        await Message.deleteMany({ chat: { $in: chatIds } });
        await Chat.deleteMany({ _id: { $in: chatIds } });

        // The companions' cached chat lists still name these chats.
        const affected = new Set();
        for (const chat of chats) {
            for (const p of chat.participants || []) affected.add(p.toString());
        }
        await invalidateChatCache([...affected]);
    }

    await User.deleteOne({ _id: userId });
    logger.info(`Demo: removed guest ${guest.username} (${chatIds.length} chat(s))`);
    return true;
};

/**
 * Delete every guest older than the TTL.
 *
 * Ages on `createdAt` rather than any notion of last activity: a guest session
 * is a single sitting, and there is no field tracking their last request. The
 * cost of getting it wrong is a visitor who left a tab open for a day being
 * handed a fresh demo, which is the same thing the button does anyway.
 */
const sweepStaleGuests = async () => {
    const cutoff = new Date(Date.now() - GUEST_TTL_MS);
    const stale = await User
        .find({ ...guestFilter, createdAt: { $lt: cutoff } })
        .select('_id').lean();

    if (stale.length === 0) return 0;

    let removed = 0;
    for (const user of stale) {
        try {
            if (await deleteGuest(user._id)) removed++;
        } catch (error) {
            // One bad guest must not abort the whole sweep.
            logger.error(`Demo: failed to sweep guest ${user._id}: ${error.message}`);
        }
    }

    logger.info(`Demo: swept ${removed} stale guest(s)`);
    return removed;
};

/**
 * Sweep now, then hourly. The immediate pass matters more than the interval:
 * a free-tier instance is restarted or woken far more often than it stays up
 * for an hour, so on that host the startup sweep is usually the only one that
 * ever runs.
 */
const startGuestSweeper = () => {
    if (!isDemoMode() || sweepTimer) return;

    sweepStaleGuests().catch(error =>
        logger.error(`Demo: initial guest sweep failed: ${error.message}`));

    sweepTimer = setInterval(() => {
        sweepStaleGuests().catch(error =>
            logger.error(`Demo: guest sweep failed: ${error.message}`));
    }, SWEEP_INTERVAL_MS);

    // Do not hold the process open on its own account.
    if (typeof sweepTimer.unref === 'function') sweepTimer.unref();
};

const stopGuestSweeper = () => {
    if (sweepTimer) clearInterval(sweepTimer);
    sweepTimer = null;
};

module.exports = {
    deleteGuest,
    sweepStaleGuests,
    startGuestSweeper,
    stopGuestSweeper,
    GUEST_TTL_MS
};
