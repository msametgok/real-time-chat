const jwt = require('jsonwebtoken');
require('dotenv').config();

const authenticateUser = (req, res, next) => {
    const token = req.header('Authorization');

    if(!token) {
        return res.staus(401).json({message: 'Access Denied: No token provided'})
    }

    try {
        const decoded = jwt.verify(token.replace('Bearer',''), process.env.JWT_SECRET)
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ message: 'Invalid token' });
    }
}

module.exports = authenticateUser;