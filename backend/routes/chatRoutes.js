const express = require('express');
const { createChat, getChatMessages, getUserChats } = require('../controllers/chatController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.post('/create', verifyToken, createChat);
router.get('/:chatId/messages', verifyToken, getChatMessages);
router.get('/', verifyToken, getUserChats);

module.exports = router;