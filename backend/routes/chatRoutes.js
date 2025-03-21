const express = require('express');
const { createChat, getChatMessages } = require('../controllers/chatController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.post('/create', verifyToken, createChat);
router.get('/:chatId/messages', verifyToken, getChatMessages);

module.exports = router;