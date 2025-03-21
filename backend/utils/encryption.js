const crypto = require('crypto');
require('dotenv').config();

const algorithm = 'aes-256-cbc'; // Encryption algorithm
const secretKey = process.env.SECRET_KEY || crypto.randomBytes(32); 
const ivLength = 16; // Initialization vector length

exports.encrypt = (text) => {
    const iv = crypto.randomBytes(ivLength); // Generate a random IV
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(secretKey), iv); // Create cipher
    let encrypted = cipher.update(text, 'utf8', 'hex'); // Encrypt the text
    encrypted += cipher.final('hex'); // Finalize the encryption
    return `${iv.toString('hex')}:${encrypted}`; // Return IV and encrypted text
}

exports.decrypt = (encryptedData) => {
    const [ivHex, encryptedText] = encryptedData.split(':'); // Split IV and encrypted text
    const iv = Buffer.from(ivHex, 'hex'); // Convert IV from hex to buffer
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(secretKey), iv); // Create decipher
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8'); // Decrypt the text
    decrypted += decipher.final('utf8'); // Finalize the decryption
    return decrypted;
}

exports.generateKey = () => {
    return crypto.randomBytes(32).toString('hex'); // Generate a random key
}

module.exports = { encrypt, decrypt, generateKey}