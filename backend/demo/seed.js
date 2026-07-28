/**
 * Demo data: the shared companions, and a private set of chats for each
 * visitor.
 *
 * Every visitor gets their OWN guest account and their own copies of the four
 * chats. A single shared demo login was the obvious cheaper option and it is
 * the wrong one here: two visitors at once would be typing into the same
 * conversation, and the tick states - the entire point of the demo - would be
 * moved by someone else's reading. Guests are cheap; confusion is not.
 *
 * Nothing in here goes through the HTTP controllers. Chats are built directly
 * so the seeded history can carry back-dated timestamps and pre-set edit and
 * delete state, which no route would let us do.
 */

const crypto = require('crypto');
const User = require('../models/User');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const logger = require('../config/logger');
const { encrypt } = require('../utils/encryption');
const { getIO } = require('../config/socket');
const {
    COMPANIONS, GROUP_INTRO, DEMO_EMAIL_DOMAIN, DEMO_GROUP_NAME, GUEST_EMAIL_PREFIX
} = require('./companions');

/** Spacing between seeded messages, so they sort predictably. */
const MESSAGE_GAP_MS = 60 * 1000;
/** How far back the seeded history starts. */
const HISTORY_START_MS = 40 * 60 * 1000;

/**
 * Insert one seeded message.
 *
 * `timestamps: false` is what lets us back-date: with it on, Mongoose stamps
 * createdAt at save time and every seeded message lands in the same
 * millisecond, leaving the in-chat order down to whatever the sort happens to
 * do with ties.
 *
 * The post-save hook still runs, which is what we want - it maintains
 * Chat.latestMessage, so seeding in chronological order leaves the sidebar
 * preview correct for free.
 */
const seedMessage = async ({ chatId, senderId, text, createdAt, editedAt = null }) => {
    const doc = new Message({
        chat: chatId,
        sender: senderId,
        messageType: 'text',
        content: encrypt(text),
        status: 'sent',
        // Left empty on purpose. The connect-time replay in config/socket.js
        // marks these delivered the moment the guest's socket comes up, and
        // the empty readBy is what puts an unread badge on the sidebar - both
        // are behaviours worth showing rather than papering over.
        deliveredTo: [],
        readBy: [],
        ...(editedAt ? { editedAt } : {}),
        createdAt,
        updatedAt: createdAt
    });

    await doc.save({ timestamps: false });
    return doc;
};

/**
 * Turn an already-saved message into a "deleted for everyone" tombstone,
 * exactly the way chatEvents.js does it: flag set, payload unset.
 *
 * It has to be a two-step - creating it empty is impossible, because `content`
 * is required for text messages and validation runs on save. updateOne skips
 * validation, which is precisely why the real delete path uses it too.
 */
const tombstone = async (messageId) => {
    await Message.updateOne(
        { _id: messageId },
        { $set: { isDeletedForEveryone: true }, $unset: { content: 1 } }
    );
};

/**
 * Create the companions if they are not already there.
 *
 * Built one at a time through save() rather than a bulk upsert so the User
 * pre-save hook hashes the password. Nobody ever logs in as a companion - the
 * bots authenticate with a signed token - but leaving a plaintext password in
 * the users collection is the kind of thing that gets copied into real code
 * later.
 *
 * Two visitors can hit this concurrently on a cold instance, so a duplicate
 * key from the unique index on email is an expected outcome, not an error:
 * whoever lost the race just re-reads the winner's document.
 */
const ensureCompanions = async () => {
    const resolved = [];

    for (const companion of COMPANIONS) {
        let user = await User.findOne({ email: companion.email });

        if (!user) {
            try {
                user = await new User({
                    username: companion.username,
                    email: companion.email,
                    password: crypto.randomBytes(24).toString('hex'),
                    isDemo: true
                }).save();
                logger.info(`Demo: created companion ${companion.username}`);
            } catch (error) {
                if (error?.code !== 11000) throw error;
                user = await User.findOne({ email: companion.email });
                if (!user) throw error;
            }
        }

        resolved.push({ ...companion, user });
    }

    return resolved;
};

/**
 * Put the companions' live sockets into a room that was created after they
 * connected.
 *
 * Without this the whole demo silently degrades to the read-receipt half.
 * Sockets join every chat room at connect time (config/socket.js) and the bots
 * connect at boot, which is long before any of these chats exist - so the readers
 * would never receive `newMessage` for a room she is not in, and would never
 * reply or mark anything read. The group-admin "add member" path has the same
 * problem and solves it the same way.
 *
 * Tolerates a null io: the seed also runs from the CLI, with no server up.
 */
const joinCompanionSockets = async (chatId, companionUserIds) => {
    const io = getIO();
    if (!io) return;

    for (const userId of companionUserIds) {
        await io.in(`user-${userId.toString()}`).socketsJoin(chatId.toString());
    }
};

/** `Guest-1a2b3c`. Retried on the vanishingly rare unique-index collision. */
const createGuestUser = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
        const suffix = crypto.randomBytes(3).toString('hex');
        try {
            return await new User({
                username: `Guest-${suffix}`,
                // The prefix is load-bearing, not cosmetic: cleanup.js uses it
                // to tell a disposable guest from a shared companion.
                email: `${GUEST_EMAIL_PREFIX}${crypto.randomBytes(8).toString('hex')}@${DEMO_EMAIL_DOMAIN}`,
                password: crypto.randomBytes(24).toString('hex'),
                isDemo: true
            }).save();
        } catch (error) {
            if (error?.code !== 11000) throw error;
        }
    }
    throw new Error('Could not allocate a unique demo guest username.');
};

/**
 * Create a guest and everything they see on arrival.
 *
 * Chats are seeded in reverse sidebar order. The Message post-save hook stamps
 * Chat.updatedAt on every insert, so the chat whose last message was written
 * most recently sorts to the top - meaning the seeding order here IS the
 * sidebar order, bottom-up. Offline User last puts them first, which is the order the
 * intro messages read in: one tick, then two, then red.
 *
 * @returns {Promise<object>} the saved guest User document
 */
const provisionGuestSession = async () => {
    const companions = await ensureCompanions();
    const guest = await createGuestUser();

    const byKey = key => companions.find(c => c.key === key);

    let clock = Date.now() - HISTORY_START_MS;
    const nextTimestamp = () => new Date((clock += MESSAGE_GAP_MS));

    // ---- The group, seeded first so it sits at the bottom ------------------
    //
    // Membership comes from the `inGroup` flag rather than "everybody". The
    // offline companion is deliberately not here: group ticks only turn red
    // once EVERY member has read, so a permanently absent member would mean
    // they could never turn red at all, and the ten-second colour change the
    // intro promises would never happen.
    const groupMembers = companions.filter(c => c.inGroup);

    const group = await new Chat({
        participants: [guest._id, ...groupMembers.map(c => c.user._id)],
        chatName: DEMO_GROUP_NAME,
        isGroupChat: true,
        // The guest is admin, which is the only way the rename / add member /
        // remove member controls are reachable at all.
        groupAdmin: guest._id
    }).save();

    await joinCompanionSockets(group._id, groupMembers.map(c => c.user._id));

    for (const line of GROUP_INTRO) {
        const speaker = byKey(line.from);
        if (!speaker) continue;
        await seedMessage({
            chatId: group._id,
            senderId: speaker.user._id,
            text: line.text,
            createdAt: nextTimestamp()
        });
    }

    // ---- One-on-one chats, bottom of the sidebar upwards -------------------
    //
    // Seeded in reverse sidebar order, so this reads top-down as Offline ->
    // Online 1 -> Online 2 -> Group: one tick, two ticks, two red, then the
    // group. The spare companions get no chat at all - they are there to be
    // found through the + button.
    const directChats = {};
    const directOrder = ['online-reading', 'online-idle', 'offline'];

    for (const key of directOrder) {
        const companion = byKey(key);
        if (!companion || companion.seedDirectChat === false) continue;

        const chat = await new Chat({
            participants: [guest._id, companion.user._id],
            isGroupChat: false
        }).save();

        await joinCompanionSockets(chat._id, [companion.user._id]);

        for (const line of companion.intro) {
            await seedMessage({
                chatId: chat._id,
                senderId: companion.user._id,
                text: line,
                createdAt: nextTimestamp()
            });
        }

        // Messages carrying real edit / delete state. The tombstone is created
        // as an ordinary message and then emptied, because that is the only
        // way to get one - `content` is required for text messages and
        // validation runs on save.
        for (const extra of companion.extras || []) {
            const seeded = await seedMessage({
                chatId: chat._id,
                senderId: companion.user._id,
                text: extra.text,
                createdAt: nextTimestamp(),
                editedAt: extra.edited ? nextTimestamp() : null
            });
            if (extra.tombstone) await tombstone(seeded._id);
        }

        directChats[key] = chat;
    }

    logger.info(`Demo: provisioned guest ${guest.username} with 4 chats`);

    return { guest, chats: { group, ...directChats } };
};

module.exports = {
    ensureCompanions,
    provisionGuestSession,
    joinCompanionSockets
};
