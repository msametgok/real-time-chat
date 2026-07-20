const crypto = require('crypto');
const logger = require('../config/logger');
require('dotenv').config();

const algorithm = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const ivLength = 16;

/**
 * Shown in place of content we could not decrypt. Kept short because it has to
 * read sensibly both in a message bubble and in the sidebar preview.
 */
const MESSAGE_UNAVAILABLE = '[Message unavailable]';

exports.encrypt = (text) => {
    try {
        const iv = crypto.randomBytes(ivLength);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        return `${iv.toString('base64')}:${encrypted}`;
    } catch (error) {
        // winston, not console - see CLAUDE.md. Never log `text` itself.
        logger.error(`Encryption error: ${error.message}`);
        throw error;
    }
};

exports.decrypt = (encryptedData) => {
    try {
        const [ivBase64, encryptedText] = encryptedData.split(':');
        const iv = Buffer.from(ivBase64, 'base64');
        const decipher = crypto.createDecipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let decrypted = decipher.update(encryptedText, 'base64', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        logger.error(`Backend decryption error: ${error.message}`);
        throw error;
    }
};

/**
 * Return a copy of `msg` with its content decrypted, or with a placeholder if
 * that fails. Never throws - callers are serialising a response and a single
 * unreadable message must not take the whole payload down with it.
 *
 * Replaces three copies that disagreed on the failure case:
 *   chatEvents         "[Unable to display message content]", captions -> null
 *   getChatMessages    "[Content decryption failed]"
 *   formatChatResponse logged a warning and left the CIPHERTEXT in place,
 *                      so a chat whose latest message failed to decrypt showed
 *                      a base64 blob as its sidebar preview.
 *
 * Also decrypts captions on non-text messages. Two of the three copies only
 * handled messageType 'text', so an encrypted caption would have leaked as
 * ciphertext the same way. No live impact yet - uploads aren't implemented -
 * but the shared version shouldn't carry the gap forward.
 */
const decryptMessageDoc = (msg) => {
    if (!msg || !msg.content) return msg;

    try {
        return { ...msg, content: exports.decrypt(msg.content) };
    } catch (error) {
        // Never log the content itself, encrypted or otherwise.
        logger.warn(`Failed to decrypt content for message ${msg._id}: ${error.message}`);
        return { ...msg, content: MESSAGE_UNAVAILABLE };
    }
};

exports.decryptMessageDoc = decryptMessageDoc;
exports.MESSAGE_UNAVAILABLE = MESSAGE_UNAVAILABLE;