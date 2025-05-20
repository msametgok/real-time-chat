const express = require('express');
const { 
    createOneOnOneChat,
    createGroupChat,
    getChatMessages,
    getUserChats,
    deleteOrLeaveChat,
    getChatDetails,
} = require('../controllers/chatController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.use(verifyToken);

router.post('/one-on-one', createOneOnOneChat);
router.post('/group', createGroupChat);
router.get('/', getUserChats);
router.get('/:chatId/messages', getChatMessages);
router.get('/:chatId', getChatDetails);
router.delete('/:chatId', deleteOrLeaveChat)



module.exports = router;