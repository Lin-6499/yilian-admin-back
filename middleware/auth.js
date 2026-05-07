const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const { getJwtSecret } = require('../../../shared/jwt-secret');

dotenv.config();

const authMiddleware = (req, res, next) => {
    // Get token from header
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, getJwtSecret());
        if (decoded.role !== 'admin') {
            return res.status(403).json({ message: 'Admin access required' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        if (err.message === 'JWT_SECRET is not configured') {
            return res.status(500).json({ message: 'Server misconfigured' });
        }

        res.status(401).json({ message: 'Token is not valid' });
    }
};

module.exports = authMiddleware;
