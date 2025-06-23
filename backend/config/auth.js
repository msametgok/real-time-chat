const jwt = require('jsonwebtoken');
const logger = require('../config/logger');
module.exports = function (req, res, next) {
    try {
        const authHeader = req.header('Authorization');

        if (!authHeader) {
            logger.warn('Authorization header missing');
            return res.status(401).json({ error: 'Authorization header missing' });
        }

        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            logger.warn('Invalid Authorization header format');
            return res.status(401).json({ error: 'Invalid Authorization header format' });
        }
        const token = parts[1];

        if(!token) {
            return res.status(401).json({message: 'Access Denied: No token provided'})
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        logger.error('Invalid token', error);
        res.status(401).json({ message: 'Invalid token' });
    }
}