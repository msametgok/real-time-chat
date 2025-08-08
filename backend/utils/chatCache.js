const redis = require('../config/redis');
const logger = require('../config/logger');

exports.invalidateChatCache = async (userIds) => {
    if (!Array.isArray(userIds)) {
        userIds = [userIds];
    }
    const ids = userIds.filter(Boolean).map(id => id.toString());
    if (!ids.length) return;
    try {
        await Promise.all(ids.map(id => redis.del(`user:${id}:chats`)));
        logger.info(`Chat cache invalidated for users: ${ids.join(', ')}`);
    } catch (error) {
        logger.error(`Error invalidating chat cache for users ${ids.join(', ')}: ${error.message}`, error);
    }
};