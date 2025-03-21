const jwt = require('jsonwebtoken');
require('dotenv').config();

const verifyToken = (req, res, next) => {
    try {
        const token = req.header('Authorization').split(' ')[1];;

        if(!token) {
            return res.status(401).json({message: 'Access Denied: No token provided'})
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ message: 'Invalid token' });
    }
}

module.exports = verifyToken;