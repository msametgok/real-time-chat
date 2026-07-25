const express = require('express');
const {
    createOneOnOneChat,
    createGroupChat,
    getChatMessages,
    getUserChats,
    deleteOrLeaveChat,
    getChatDetails,
    updateGroupChatDetails,
    addGroupParticipants,
    removeGroupParticipant,
} = require('../controllers/chatController');
const verifyToken = require('../config/auth');
const { requireChatParticipant, uploadChatFile } = require('../controllers/uploadController');
const { uploadSingleFile } = require('../utils/uploads');

const router = express.Router();

router.use(verifyToken);

router.post('/one-on-one', createOneOnOneChat);
router.post('/group', createGroupChat);
router.get('/', getUserChats);
router.get('/:chatId/messages', getChatMessages);
router.get('/:chatId', getChatDetails);
router.delete('/:chatId', deleteOrLeaveChat)
// Participant check runs before multer so a denied upload never touches disk.
router.post('/:chatId/upload', requireChatParticipant, uploadSingleFile, uploadChatFile);
// Group admin actions - the controllers gate on groupAdmin themselves.
router.put('/:chatId/group', updateGroupChatDetails);
router.post('/:chatId/participants', addGroupParticipants);
router.delete('/:chatId/participants/:userId', removeGroupParticipant);



module.exports = router;