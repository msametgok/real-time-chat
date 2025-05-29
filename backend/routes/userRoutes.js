const express = require('express');
const {
    getCurrentUserProfile,
    updateCurrentUserProfile,
    searchUsers,
    getUserPublicProfile
} = require('../controllers/userController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.use(verifyToken);

router.get('/profile', getCurrentUserProfile);
router.put('/profile', updateCurrentUserProfile);
router.get('/', searchUsers);
router.get('/:userId/profile', getUserPublicProfile);

module.exports = router;