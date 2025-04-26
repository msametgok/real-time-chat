const express = require('express');
const { createChat, getChatMessages, getUserChats, deleteChat, getChatDetails, createGroupChat } = require('../controllers/chatController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.post('/create', verifyToken, createChat);
router.get('/:chatId/messages', verifyToken, getChatMessages);
router.get('/', verifyToken, getUserChats);
router.delete('/:chatId', verifyToken, deleteChat)
router.get('/:chatId', verifyToken, getChatDetails);
router.post('/group', verifyToken, createGroupChat);

module.exports = router;