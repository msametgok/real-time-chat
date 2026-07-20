/**
 * One-time migration: populate `pairKey` on existing 1-on-1 chats.
 *
 *   node scripts/backfillChatPairKey.js          # report only
 *   node scripts/backfillChatPairKey.js --apply  # write
 *
 * pairKey is the canonical identity of a 1-on-1 chat (both ids sorted, joined
 * by a colon) and carries the unique index that stops duplicate chats being
 * created. Chats that predate the field have none, so:
 *
 *   - createOneOnOneChat upserts on { pairKey }, and would MISS them - creating
 *     a second chat for a pair that already had one.
 *   - they aren't covered by the unique index, so nothing else stops that.
 *
 * Refuses to write if the data already contains duplicate pairs, since the
 * unique index could not be built over them anyway. Resolve those first.
 *
 * Safe to re-run: only touches 1-on-1 chats whose pairKey is missing or null.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Chat = require('../models/Chat');

const APPLY = process.argv.includes('--apply');

(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const pending = await Chat.find({
        isGroupChat: false,
        $or: [{ pairKey: null }, { pairKey: { $exists: false } }]
    }).select('_id participants').lean();

    console.log(`1-on-1 chats needing a pairKey: ${pending.length}`);

    // Group by the key we're about to assign - a collision here means the
    // unique index would reject one of them.
    const byKey = new Map();
    const skipped = [];

    for (const chat of pending) {
        const key = Chat.buildPairKey(chat.participants);
        if (!key) {
            skipped.push(chat._id);           // not exactly two participants
            continue;
        }
        byKey.set(key, [...(byKey.get(key) || []), chat._id]);
    }

    if (skipped.length) {
        console.log(`SKIPPED (participants != 2): ${skipped.join(', ')}`);
    }

    const collisions = [...byKey.entries()].filter(([, ids]) => ids.length > 1);
    if (collisions.length) {
        console.error('\nDuplicate pairs found - the unique index cannot be built.');
        collisions.forEach(([key, ids]) => console.error(`   ${key} -> ${ids.join(', ')}`));
        console.error('\nMerge or delete the duplicates, then re-run. Nothing was written.');
        process.exitCode = 1;
        return mongoose.disconnect();
    }

    // Also check the keys we're about to write don't collide with chats that
    // already have one.
    for (const key of byKey.keys()) {
        const existing = await Chat.findOne({ pairKey: key }).select('_id').lean();
        if (existing) {
            console.error(`\nChat ${existing._id} already holds pairKey ${key}. Nothing was written.`);
            process.exitCode = 1;
            return mongoose.disconnect();
        }
    }

    if (!APPLY) {
        console.log('\nDry run. Would set:');
        byKey.forEach((ids, key) => console.log(`   ${ids[0]} -> ${key}`));
        console.log('\nRe-run with --apply to write.');
        return mongoose.disconnect();
    }

    let written = 0;
    for (const [key, ids] of byKey) {
        await Chat.updateOne({ _id: ids[0] }, { $set: { pairKey: key } });
        written++;
    }

    console.log(`\nUpdated ${written} chat(s).`);
    console.log('Mongoose builds the unique index on next model init; verify with');
    console.log('   db.chats.getIndexes()');

    await mongoose.disconnect();
})().catch(async err => {
    console.error('Error:', err.message);
    process.exitCode = 1;
    await mongoose.disconnect().catch(() => {});
});
