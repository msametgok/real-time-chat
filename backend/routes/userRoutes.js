const express = require('express');
const {getUserProfile, updateUserProfile, searchUsers} = require('../controllers/userController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.get('/profile', verifyToken, getUserProfile);
router.put('/profile', verifyToken, updateUserProfile);
router.get('/', verifyToken, searchUsers);

module.exports = router;