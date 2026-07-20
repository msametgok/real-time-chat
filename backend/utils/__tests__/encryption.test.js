// A valid 32-byte key, so encrypt/decrypt actually round-trip here.
process.env.ENCRYPTION_KEY = '01234567890123456789012345678901';

jest.mock('../../config/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

const logger = require('../../config/logger');
const { encrypt, decrypt, decryptMessageDoc, MESSAGE_UNAVAILABLE } = require('../encryption');

beforeEach(() => jest.clearAllMocks());

describe('encrypt/decrypt round trip', () => {
    it('recovers the original text', () => {
        expect(decrypt(encrypt('hello there'))).toBe('hello there');
    });

    it('produces a different ciphertext each time (random IV)', () => {
        expect(encrypt('same input')).not.toBe(encrypt('same input'));
    });
});

describe('decryptMessageDoc', () => {
    it('decrypts content and leaves the rest of the message alone', () => {
        const msg = { _id: 'm1', sender: 'user-1', messageType: 'text', content: encrypt('hi') };

        const result = decryptMessageDoc(msg);

        expect(result.content).toBe('hi');
        expect(result._id).toBe('m1');
        expect(result.sender).toBe('user-1');
    });

    it('does not mutate the input document', () => {
        const cipher = encrypt('hi');
        const msg = { _id: 'm1', content: cipher };

        decryptMessageDoc(msg);

        expect(msg.content).toBe(cipher);
    });

    // formatChatResponse used to catch the failure, log, and leave the
    // ciphertext in place - so the sidebar preview showed a base64 blob.
    it('substitutes a placeholder rather than leaking ciphertext', () => {
        const result = decryptMessageDoc({ _id: 'm1', content: 'not-valid-ciphertext' });

        expect(result.content).toBe(MESSAGE_UNAVAILABLE);
        expect(result.content).not.toContain('not-valid-ciphertext');
    });

    it('never throws on undecryptable content', () => {
        expect(() => decryptMessageDoc({ _id: 'm1', content: '!!!' })).not.toThrow();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('does not log the content itself when decryption fails', () => {
        decryptMessageDoc({ _id: 'm1', content: 'sensitive-looking-ciphertext' });

        const logged = logger.warn.mock.calls.map(c => c[0]).join(' ');
        expect(logged).not.toContain('sensitive-looking-ciphertext');
        expect(logged).toContain('m1');
    });

    it('passes through a message with no content', () => {
        const msg = { _id: 'm1', messageType: 'image', fileUrl: 'http://x/y.png' };
        expect(decryptMessageDoc(msg)).toBe(msg);
    });

    it('passes through null and undefined', () => {
        expect(decryptMessageDoc(null)).toBeNull();
        expect(decryptMessageDoc(undefined)).toBeUndefined();
    });

    // Two of the three original copies only handled messageType 'text', so an
    // encrypted caption on a media message would have gone out as ciphertext.
    it('decrypts a caption on a non-text message', () => {
        const msg = { _id: 'm1', messageType: 'image', content: encrypt('a caption') };
        expect(decryptMessageDoc(msg).content).toBe('a caption');
    });

    // It's used as messages.map(decryptMessageDoc), which passes index and array.
    it('ignores the extra arguments Array.map supplies', () => {
        const msgs = [{ _id: 'm1', content: encrypt('one') }, { _id: 'm2', content: encrypt('two') }];
        expect(msgs.map(decryptMessageDoc).map(m => m.content)).toEqual(['one', 'two']);
    });
});
