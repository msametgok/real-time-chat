/**
 * The demo companions, and the whole point of demo mode.
 *
 * A visitor arriving from a portfolio link has maybe a minute and will not open
 * a second browser profile, so every realtime behaviour has to be legible from
 * one window. These accounts exist to put the delivery states side by side:
 *
 *   offline            -> one grey tick   (sent, nobody received it)
 *   online, not looking -> two grey ticks (delivered, not read)
 *   online, reading     -> two red ticks (read receipt came back)
 *
 * None of it is faked. The states fall out of the real code paths:
 * chatEvents.js decides `deliveredTo` from live socket presence
 * (`io.in('user-<id>').allSockets()`), and `readBy` only moves when the
 * recipient emits markChatAsRead. "Offline" therefore means genuinely no
 * socket, and "online but not reading" means a connected client that ignores
 * its inbox. The clients in bots.js are ordinary socket.io-clients - the same
 * library the browser runs.
 *
 * Names are functional rather than human on purpose. A visitor should not have
 * to remember that "Ayşe" is the offline one while also learning what a tick
 * means; the name carries the lesson.
 *
 * Every chat is seeded with an opening message that explains its own
 * behaviour. One grey tick versus two is far too subtle to notice unless
 * something says so, and a seeded message costs nothing and disappears with
 * the rest of the demo data.
 */

/** Demo accounts get their own domain, so cleanup can find them by email too. */
const DEMO_EMAIL_DOMAIN = 'chat.demo';

/**
 * Guest emails start with this; companion emails never do.
 *
 * It is the safety catch in cleanup.js. Both kinds carry `isDemo: true`, so
 * that flag alone cannot tell a throwaway visitor from a shared companion -
 * and deleting a companion would take every live visitor's chats with it,
 * since their conversations are with that account.
 */
const GUEST_EMAIL_PREFIX = 'guest-';

const COMPANIONS = [
    {
        key: 'offline',
        username: 'Offline User',
        email: `offline@${DEMO_EMAIL_DOMAIN}`,
        /** No socket, ever. See the warning at the top of bots.js. */
        online: false,
        readsMessages: false,
        replies: false,
        /** Deliberately left out of the group - a permanently-absent member
         *  would mean group ticks could never turn red. */
        inGroup: false,
        seedDirectChat: true,
        intro: [
            'Hi — I am the offline one here, and I stay offline for the whole demo.',
            'Send me anything and look at the tick underneath your message. You will get a single grey tick: the server accepted your message and saved it, but it has not reached me, because I have no connection open.',
            'It will sit at one tick for as long as I am away — the same thing you see texting someone whose phone is switched off.'
        ]
    },
    {
        key: 'online-idle',
        username: 'Online User 1',
        email: `online1@${DEMO_EMAIL_DOMAIN}`,
        online: true,
        /** Never reads a one-on-one: that is what keeps the ticks grey. */
        readsMessages: false,
        replies: false,
        /**
         * ...but in a GROUP this one reads after a pause, which is the only
         * way to show grey ticks turning red while the visitor watches.
         * Handled per-chat in bots.js, not per-user.
         */
        groupDelayedRead: true,
        /** The seeded group intro promises "about ten seconds". Change one,
         *  change the other. */
        groupReadDelayMs: 10 * 1000,
        inGroup: true,
        seedDirectChat: true,
        /** Sent live, a little after the visitor arrives - see bots.js. */
        nudge: 'Still here, still not reading this chat. Your ticks stay grey.',
        intro: [
            'Hey — I am online right now, but I am not looking at this conversation.',
            'Send me something and you will get two grey ticks. Two ticks means delivered: your message reached my device the instant you pressed send. They stay grey because I have not opened the chat, so nothing has been read yet.',
            'Put this next to the Offline User chat — one tick against two is exactly the difference between "sent" and "delivered".'
        ],
        /**
         * Seeded after the intro, carrying real edit and delete state. Both
         * features are only visible on messages that already exist, so a
         * visitor who never sends anything would otherwise never see them.
         */
        extras: [
            { text: 'While you are here — messages can be edited for 15 minutes after sending. This one was, so it carries an "edited" label.', edited: true },
            { text: 'And this one is about to be deleted for everyone.', tombstone: true },
            { text: 'That is the tombstone a "delete for everyone" leaves behind. Hover any of your own messages to try both.' }
        ],
        /** Used only for the group reply that follows the delayed read. */
        replies_pool: [
            'Just opened the group — I got your message. That is what turned your ticks red.',
            'I am here now, and I have read it. Check your ticks: they changed colour the moment I did.'
        ]
    },
    {
        key: 'online-reading',
        username: 'Online User 2',
        email: `online2@${DEMO_EMAIL_DOMAIN}`,
        online: true,
        readsMessages: true,
        replies: true,
        inGroup: true,
        seedDirectChat: true,
        intro: [
            'Hi — I am online and I have this chat open in front of me.',
            'Send me a message and watch three things happen in order: two grey ticks as it arrives, then both ticks turn red the moment I read it, then "typing…" appears just before my reply lands.',
            'Nothing on this page reloads to do any of that. Every step arrives over the same websocket connection.'
        ],
        /**
         * Rotated rather than random: Math.random() in a demo means two
         * visitors see different things and neither can be reproduced when one
         * of them reports something odd.
         */
        replies_pool: [
            'Got it — and notice your ticks just turned red. That is a real read receipt, not an animation.',
            'Reading you loud and clear. The "typing…" you saw is the same indicator any two users get.',
            'Still here. Try sending the Offline User the same thing and compare the ticks.',
            'That came through instantly over the websocket — no polling, no refresh.',
            'Received. Everything in this chat went through the same handlers a normal account uses.'
        ],
        /**
         * A group needs its own copy. The one-on-one lines above say the ticks
         * have just turned red, which is true there and flatly wrong here -
         * this reply lands seconds before Online User 1 reads, while the ticks
         * are still deliberately grey. Saying otherwise would contradict the
         * intro at the exact moment the visitor is looking at them.
         */
        groupRepliesPool: [
            'Read it — but look at your ticks: still grey. I am only one of two people here, and Online User 1 has not opened the group yet.',
            'Got it. Your ticks stay grey until Online User 1 reads it too — a few more seconds and you will see them change.'
        ]
    },
    // The spare pair. They exist so "create a group" is something the visitor
    // can actually try, with people who answer. No seeded one-on-one chat:
    // they are found through the + button and the user search, which is the
    // flow being demonstrated.
    {
        key: 'extra-1',
        username: 'Online User 3',
        email: `online3@${DEMO_EMAIL_DOMAIN}`,
        online: true,
        readsMessages: true,
        replies: true,
        inGroup: false,
        seedDirectChat: false,
        /**
         * Staggered against Online User 4 below.
         *
         * Both spares used to read on the default 700ms, so a group the
         * visitor built themselves went from sent to fully read almost
         * instantly and both replies landed in the same second - the ticks
         * were red before there was anything to watch. Spacing the reads
         * three seconds apart gives the sequence room: grey, one reader,
         * a reply, the second reader, red.
         */
        groupReadDelayMs: 3 * 1000,
        replies_pool: [
            'Hey — I am online, so this reached me straight away.',
            'Got it. Nothing about this chat is special: same handlers, same ticks.'
        ],
        groupRepliesPool: [
            'Hey — thanks for the invite. I am online and I have read it, so I am not the one holding your ticks up.',
            'Got it. You built this group yourself and it behaves exactly like the seeded one.'
        ]
    },
    {
        key: 'extra-2',
        username: 'Online User 4',
        email: `online4@${DEMO_EMAIL_DOMAIN}`,
        online: true,
        readsMessages: true,
        replies: true,
        inGroup: false,
        seedDirectChat: false,
        /** Second of the staggered pair - this is the read that completes the
         *  set and turns the ticks red. */
        groupReadDelayMs: 6 * 1000,
        replies_pool: [
            'Here too, and reading. Your ticks should have gone red just now.',
            'Reading along. Everything here runs on the same socket handlers.'
        ],
        groupRepliesPool: [
            'Here too. Remember your ticks only turn red once every one of us has read it.',
            'Reading along. Try renaming this group or removing someone from the header menu — you are the admin.'
        ]
    }
];

/**
 * The seeded group's opening messages, in order.
 *
 * Kept here rather than in seed.js because it is copy, not logic, and because
 * it has to stay consistent with the behaviour flags above - the ten-second
 * promise below is only true while `groupDelayedRead` is set on Online User 1.
 */
const DEMO_GROUP_NAME = 'Demo Group';

const GROUP_INTRO = [
    {
        from: 'online-reading',
        text: 'Welcome to the group — you created it, so you are the admin here.'
    },
    {
        from: 'online-reading',
        text: 'Ticks work differently in a group, and this is the part worth watching. Two grey ticks mean every member has received your message. They only turn red once every member has also read it — one person reading is not enough.'
    },
    {
        from: 'online-reading',
        text: 'Try it now. Send something here and I will read it straight away and reply — but your ticks will stay grey, because Online User 1 still has the group closed.'
    },
    {
        from: 'online-idle',
        text: 'That is me. I will open the group about ten seconds after you send, and read it then. Watch your ticks at that moment: the instant I read it, the last member is accounted for and they turn red. Look out for "typing…" before each of our replies too.'
    },
    {
        from: 'online-reading',
        text: 'One more thing: this group is yours. Open the menu in the header to rename it, add someone, or remove a member — do not hesitate, nothing here is precious. Online User 3 and Online User 4 are around as well if you want to start a second group from the + button.'
    }
];

const isDemoMode = () => process.env.DEMO_MODE === 'true';

const companionByKey = (key) => COMPANIONS.find(c => c.key === key);

module.exports = {
    COMPANIONS,
    GROUP_INTRO,
    DEMO_EMAIL_DOMAIN,
    GUEST_EMAIL_PREFIX,
    DEMO_GROUP_NAME,
    isDemoMode,
    companionByKey
};
