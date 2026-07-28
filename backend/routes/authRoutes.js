const express = require('express');
const {register, login, logout} = require('../controllers/authController');
const {startDemoSession, endDemoSession} = require('../controllers/demoController');
const verifyToken = require('../config/auth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
// Public demo only - 404s unless DEMO_MODE=true. Rate limited in app.js.
router.post('/demo', startDemoSession);
// Deletes the calling guest. Authenticated: the token is what identifies who
// to remove, and it is the only thing trusted here.
router.post('/demo/end', verifyToken, endDemoSession);

module.exports = router;