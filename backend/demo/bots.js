/**
 * The demo companions' clients.
 *
 * These are ordinary socket.io-clients, connecting over loopback to the server
 * that started them and authenticating with a normal signed token. That is the
 * point: the demo's delivery states come out of the real handlers, so nothing
 * here has to agree with chatEvents.js about what "delivered" means - it just
 * connects, and the server works it out from live presence exactly as it does
 * for a browser.
 *
 * The whole module is inert unless DEMO_MODE=true.
 *
 * ---------------------------------------------------------------------------
 * DO NOT give the offline companion a client. Its single grey tick is the only
 * "not delivered" state in the demo, and it is a property of having no socket
 * at all. Worse, connecting her once is not undoable: the replay in
 * config/socket.js marks every message waiting for her as delivered the moment
 * it connects, so every visitor's Offline User chat - past and future - jumps to two
 * ticks and stays there.
 * ---------------------------------------------------------------------------
 */

const { io: ioClient } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
const Chat = require('../models/Chat');
const { isDemoMode } = require('./companions');
const { ensureCompanions } = require('./seed');

/** Pause before the read receipt, so the ticks visibly change rather than
 *  arriving in the same frame as the message and looking pre-baked. */
const READ_DELAY_MS = 700;
/**
 * Group read timings are per-companion (`groupReadDelayMs` in companions.js),
 * because they carry meaning: one of them is the ten seconds the seeded group
 * intro promises, and the others exist to space several readers apart so the
 * ticks change where the visitor can see it happen.
 */

/** How long the typing indicator shows before the reply lands. */
const TYPING_MS = 1800;
/** How long after a guest is provisioned the idle companion nudges them. */
const NUDGE_DELAY_MS = 35 * 1000;

/** key -> { socket, user, companion }. Empty unless startDemoBots ran. */
const bots = new Map();
/** Companion user ids, so bots never answer each other. */
const companionIds = new Set();
/** Chats with a reply already in flight - see the throttle in handleMessage. */
const pendingReplies = new Set();
/** chatId -> next index into replies_pool. Rotated, not random. */
const replyCursors = new Map();
/** Outstanding timers, cleared on shutdown so a stopped bot cannot still fire. */
const timers = new Set();

const later = (fn, ms) => {
    const timer = setTimeout(() => {
        timers.delete(timer);
        fn();
    }, ms);
    timers.add(timer);
    return timer;
};

const idOf = value => (value?._id || value || '').toString();

/**
 * A companion's own token. Signed with the same payload shape the HTTP login
 * issues - `userId`, not `id`, which is the detail that silently fails the
 * socket handshake if you get it wrong.
 */
const tokenFor = user => jwt.sign(
    { userId: user._id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '30d' }
);

const nextReply = (key, pool) => {
    const cursor = replyCursors.get(key) || 0;
    replyCursors.set(key, (cursor + 1) % pool.length);
    return pool[cursor];
};

/**
 * React to a message addressed to this companion.
 *
 * Behaviour is decided per CHAT, not per user, which is the whole trick behind
 * the group demo: Online User 1 must never read a one-on-one (that is what
 * keeps those ticks grey) while still reading in the group after a pause, so
 * the visitor can watch grey turn red. One flag, two behaviours, chosen here.
 *
 * Replying is throttled per bot per chat. Keying the throttle on chatId alone
 * would let whichever bot happened to arrive first suppress every other bot's
 * reply in a shared group - a race deciding who speaks.
 */
const handleMessage = async (bot, message) => {
    const chatId = idOf(message?.chat);
    const senderId = idOf(message?.sender);

    if (!chatId) return;
    // Never answer another companion. Two replying bots in one group would
    // talk to each other until the process died.
    if (companionIds.has(senderId)) return;

    const { companion } = bot;

    let isGroup = false;
    try {
        const chat = await Chat.findById(chatId).select('isGroupChat').lean();
        isGroup = !!chat?.isGroupChat;
    } catch (error) {
        logger.error(`Demo: could not classify chat ${chatId}: ${error.message}`);
        return;
    }

    // The late reader only wakes up in a group.
    const lateRead = isGroup && !!companion.groupDelayedRead;
    if (!companion.readsMessages && !lateRead) return;

    // Per-companion in a group, so several bots in one room read at visibly
    // different moments instead of all at once. In a one-on-one there is only
    // ever one reader, so the short default is right.
    const readDelay = (isGroup && companion.groupReadDelayMs) || READ_DELAY_MS;

    later(() => {
        bot.socket.emit('markChatAsRead', { chatId });
    }, readDelay);

    if (!companion.replies && !lateRead) return;

    // A group gets its own lines where they exist: what is true of the ticks
    // in a one-on-one is not true in a group, where one reader is not enough.
    const pool = (isGroup && companion.groupRepliesPool) || companion.replies_pool;
    if (!pool?.length) return;

    const throttleKey = `${companion.key}:${chatId}`;
    if (pendingReplies.has(throttleKey)) return;
    pendingReplies.add(throttleKey);

    // Always after the read, so the reply reads as a consequence of it.
    later(() => {
        bot.socket.emit('typingStart', { chatId });

        later(() => {
            bot.socket.emit('typingStop', { chatId });
            bot.socket.emit('sendMessage', {
                chatId,
                messageType: 'text',
                content: nextReply(throttleKey, pool),
                // Server requires the field; nothing consumes the ack here.
                tempId: `demo-${Date.now()}`
            });
            pendingReplies.delete(throttleKey);
        }, TYPING_MS);
    }, readDelay + 200);
};

const connectBot = (companion) => {
    const url = `http://127.0.0.1:${process.env.PORT || 5000}`;
    const socket = ioClient(url, {
        auth: { token: tokenFor(companion.user) },
        transports: ['websocket'],
        reconnection: true,
        reconnectionDelay: 3000
    });

    const bot = { socket, companion, user: companion.user };

    socket.on('connect', () =>
        logger.info(`Demo bot online: ${companion.username}`));
    socket.on('connect_error', err =>
        logger.error(`Demo bot ${companion.username} connect error: ${err.message}`));
    socket.on('disconnect', reason =>
        logger.warn(`Demo bot ${companion.username} disconnected: ${reason}`));

    // Join rooms for chats created after this bot connected - which is every
    // chat a visitor makes from the + button.
    //
    // The browser does exactly this: emitNewChatToParticipants only fans a
    // `newChat` out to personal rooms, it never socketsJoin's, so each client
    // is expected to join for itself. Without this a group the visitor creates
    // would look completely dead: the bots are participants in Mongo, so the
    // message saves and shows two ticks from presence, but they are not in the
    // room, never receive it, and never read or answer.
    socket.on('newChat', chat => {
        const chatId = idOf(chat?._id);
        if (chatId) socket.emit('joinChat', { chatId });
    });

    // Registered unless this companion is purely a presence prop. The idle
    // one still needs it: it reads nothing in a one-on-one, but it is the
    // late reader in the group.
    if (companion.readsMessages || companion.replies || companion.groupDelayedRead) {
        socket.on('newMessage', message => {
            handleMessage(bot, message).catch(error =>
                logger.error(`Demo bot ${companion.username} failed on newMessage: ${error.message}`));
        });
    }

    bots.set(companion.key, bot);
    return bot;
};

/**
 * Connect every companion marked online. Call once, after the HTTP server is
 * listening - the bots dial back into it over loopback, so starting them any
 * earlier just produces a round of connection errors and a retry wait.
 */
const startDemoBots = async () => {
    if (!isDemoMode()) return;

    try {
        const companions = await ensureCompanions();
        companions.forEach(c => companionIds.add(c.user._id.toString()));

        for (const companion of companions.filter(c => c.online)) {
            connectBot(companion);
        }

        logger.info(`Demo mode: ${bots.size} companion bot(s) starting`);
    } catch (error) {
        // A broken demo must not take the server down with it - the app itself
        // is perfectly usable without companions.
        logger.error(`Demo: failed to start bots: ${error.message}`, error);
    }
};

/**
 * The idle companion sends one unprompted line a little after a guest arrives,
 * so the unread badge is seen *appearing* rather than just being there on load.
 * Silently does nothing when demo mode is off or the bot never connected.
 */
const scheduleIdleNudge = (chatId) => {
    const bot = bots.get('online-idle');
    if (!bot || !bot.companion.nudge) return;

    later(() => {
        if (!bot.socket.connected) return;
        bot.socket.emit('sendMessage', {
            chatId: chatId.toString(),
            messageType: 'text',
            content: bot.companion.nudge,
            tempId: `demo-nudge-${Date.now()}`
        });
    }, NUDGE_DELAY_MS);
};

/** Used by the graceful shutdown in server.js. */
const stopDemoBots = () => {
    timers.forEach(clearTimeout);
    timers.clear();
    bots.forEach(bot => bot.socket.disconnect());
    bots.clear();
    pendingReplies.clear();
    replyCursors.clear();
};

module.exports = { startDemoBots, scheduleIdleNudge, stopDemoBots };
