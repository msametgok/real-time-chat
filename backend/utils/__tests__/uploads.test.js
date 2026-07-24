jest.mock('../../config/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));

const { messageTypeForMime, isInlineFile, decodeOriginalName } = require('../uploads');

describe('messageTypeForMime', () => {
    it('maps media mimetypes to their message type', () => {
        expect(messageTypeForMime('image/png')).toBe('image');
        expect(messageTypeForMime('image/jpeg')).toBe('image');
        expect(messageTypeForMime('video/mp4')).toBe('video');
        expect(messageTypeForMime('audio/mpeg')).toBe('audio');
    });

    it('maps everything else to file', () => {
        expect(messageTypeForMime('application/pdf')).toBe('file');
        expect(messageTypeForMime('text/html')).toBe('file');
        expect(messageTypeForMime('application/octet-stream')).toBe('file');
        expect(messageTypeForMime(undefined)).toBe('file');
    });

    // SVG can carry <script>, so it must never be classified as an inline
    // image even though its mimetype starts with image/.
    it('treats SVG as a file, not an image', () => {
        expect(messageTypeForMime('image/svg+xml')).toBe('file');
    });
});

describe('isInlineFile', () => {
    it('allows common media inline', () => {
        expect(isInlineFile('C:/uploads/abc.png')).toBe(true);
        expect(isInlineFile('/uploads/abc.mp4')).toBe(true);
        expect(isInlineFile('/uploads/ABC.JPG')).toBe(true); // case-insensitive
    });

    it('forces script-capable and unknown types to download', () => {
        expect(isInlineFile('/uploads/abc.svg')).toBe(false);
        expect(isInlineFile('/uploads/abc.html')).toBe(false);
        expect(isInlineFile('/uploads/abc.exe')).toBe(false);
        expect(isInlineFile('/uploads/no-extension')).toBe(false);
    });
});

describe('decodeOriginalName', () => {
    // Multer hands originalname over latin1-decoded; without the round-trip a
    // Turkish filename arrives as mojibake.
    it('recovers non-ASCII filenames', () => {
        const original = 'değişiklik özeti.pdf';
        const asLatin1 = Buffer.from(original, 'utf8').toString('latin1');
        expect(decodeOriginalName(asLatin1)).toBe(original);
    });

    it('leaves plain ASCII untouched', () => {
        expect(decodeOriginalName('report.pdf')).toBe('report.pdf');
    });

    it('tolerates a missing name', () => {
        expect(decodeOriginalName(undefined)).toBe('');
    });
});
