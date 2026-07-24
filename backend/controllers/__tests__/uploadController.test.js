jest.mock('../../config/logger', () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn()
}));
// The model itself is never queried directly - it is only handed to
// findChatForParticipant, which is mocked below.
jest.mock('../../models/Chat', () => ({}));
jest.mock('../../utils/chatAuth', () => ({
    findChatForParticipant: jest.fn()
}));

const { findChatForParticipant } = require('../../utils/chatAuth');
const { requireChatParticipant, uploadChatFile } = require('../uploadController');

const VALID_CHAT_ID = '0123456789abcdef01234567';

const buildRes = () => ({
    status: jest.fn().mockReturnThis(),
    json: jest.fn()
});

beforeEach(() => jest.clearAllMocks());

describe('requireChatParticipant', () => {
    const buildReq = (chatId = VALID_CHAT_ID) => ({
        params: { chatId },
        user: { userId: 'user-1' }
    });

    it('lets a participant through', async () => {
        findChatForParticipant.mockResolvedValue({ _id: VALID_CHAT_ID });
        const res = buildRes();
        const next = jest.fn();

        await requireChatParticipant(buildReq(), res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    // The whole point of running before multer: a non-participant's upload
    // must be rejected before a byte reaches disk.
    it('rejects a non-participant with 403 and does not call next', async () => {
        findChatForParticipant.mockResolvedValue(null);
        const res = buildRes();
        const next = jest.fn();

        await requireChatParticipant(buildReq(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(403);
    });

    // findChatForParticipant throws a CastError on a malformed id, which the
    // catch would turn into a 500 - validate first and answer 400 instead.
    it('rejects a malformed chat id with 400 before querying', async () => {
        const res = buildRes();
        const next = jest.fn();

        await requireChatParticipant(buildReq('not-an-object-id'), res, next);

        expect(findChatForParticipant).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('answers 500 when the lookup itself fails', async () => {
        findChatForParticipant.mockRejectedValue(new Error('db down'));
        const res = buildRes();
        const next = jest.fn();

        await requireChatParticipant(buildReq(), res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('uploadChatFile', () => {
    const buildReq = (file) => ({
        params: { chatId: VALID_CHAT_ID },
        user: { userId: 'user-1' },
        file
    });

    it('answers 400 when multer produced no file', () => {
        const res = buildRes();

        uploadChatFile(buildReq(undefined), res);

        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('returns the stored file with a server-decided messageType', () => {
        const res = buildRes();

        uploadChatFile(buildReq({
            filename: 'abc123.png',
            originalname: 'holiday photo.png',
            mimetype: 'image/png',
            size: 2048
        }), res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith({
            fileUrl: '/uploads/abc123.png',
            fileName: 'holiday photo.png',
            fileType: 'image/png',
            fileSize: 2048,
            messageType: 'image'
        });
    });

    // The client never chooses the messageType - a renamed executable with an
    // application mimetype must come back as 'file', not whatever the client
    // would have claimed.
    it('classifies non-media uploads as plain files', () => {
        const res = buildRes();

        uploadChatFile(buildReq({
            filename: 'abc123.bin',
            originalname: 'setup.exe',
            mimetype: 'application/octet-stream',
            size: 4096
        }), res);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ messageType: 'file' })
        );
    });
});
