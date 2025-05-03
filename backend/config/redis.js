const Redis = require('ioredis');
const logger = require('./logger');
require('dotenv').config();

const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
})

redis.on('connect', () => logger.info('Connected to Redis'));
redis.on('error', (err) => logger.error(`Redis error: ${err.message}`));

module.exports = redis;