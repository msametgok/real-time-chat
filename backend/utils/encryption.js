const crypto = require('crypto');
require('dotenv').config();

const algorithm = 'aes-256-cbc';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '12345678901234567890123456789012';
const ivLength = 16;

exports.encrypt = (text) => {
    try {
        const iv = crypto.randomBytes(ivLength);
        const cipher = crypto.createCipheriv(algorithm, Buffer.from(ENCRYPTION_KEY), iv);
        let encrypted = cipher.update(text, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        console.log('Encrypting:', { iv: iv.toString('base64'), encrypted });
        return `${iv.toString('base64')}:${encrypted}`;
    } catch (error) {
        console.error('Encryption error:', error);
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
        console.error('Backend decryption error:', error);
        throw error;
    }
};