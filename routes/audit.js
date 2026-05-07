const express = require('express');
const router = express.Router();
const pool = require('../db');

// Get audit list (users with status 'pending')
router.get('/', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const role = req.query.role; // filter by role (e.g., volunteer)

        let query = 'SELECT id, username, role, phone, real_name, created_at, status, id_card, avatar FROM users WHERE status = "pending"';
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE status = "pending"';
        const params = [];

        if (role) {
            query += ' AND role = ?';
            countQuery += ' AND role = ?';
            params.push(role);
        }

        query += ' ORDER BY created_at ASC LIMIT ? OFFSET ?';
        
        const countParams = [...params];
        params.push(limit, offset);

        const [users] = await pool.query(query, params);
        const [totalResult] = await pool.query(countQuery, countParams);
        const total = totalResult[0].total;

        res.json({
            users,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Approve user
router.post('/:id/approve', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query('UPDATE users SET status = "active" WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User approved successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Reject user
router.post('/:id/reject', async (req, res) => {
    const { id } = req.params;

    try {
        const [result] = await pool.query('UPDATE users SET status = "rejected" WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json({ message: 'User rejected successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
