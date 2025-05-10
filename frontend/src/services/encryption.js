import CryptoJS from 'crypto-js';

const ENCRYPTION_KEY = import.meta.env.VITE_ENCRYPTION_KEY;

if (!ENCRYPTION_KEY) {
    throw new Error('VITE_ENCRYPTION_KEY is not defined');
}

export const decrypt = (encryptedData) => {
    try {
        const [ivBase64, encryptedText] = encryptedData.split(':');
        const iv = CryptoJS.enc.Base64.parse(ivBase64);
        const decrypted = CryptoJS.AES.decrypt(
            { ciphertext: CryptoJS.enc.Base64.parse(encryptedText) },
            CryptoJS.enc.Utf8.parse(ENCRYPTION_KEY),
            { iv }
        );
        const result = decrypted.toString(CryptoJS.enc.Utf8);
        if (!result) {
            throw new Error('Decryption failed');
        }
        return result;
    } catch (error) {
        console.error('Decryption error:', error);
        return '[Decryption failed]';
    }
};