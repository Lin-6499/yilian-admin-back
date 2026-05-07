const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');

function requireAdmin(req, res) {
    if (req.user?.role !== 'admin') {
        res.status(403).json({ message: '无权访问' });
        return false;
    }

    return true;
}

// Get all users (with pagination and filtering)
router.get('/', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;
        const role = req.query.role; // filter by role
        const search = req.query.search; // search by username or real_name

        let query = 'SELECT id, username, role, phone, real_name, emergency_contact, emergency_phone, created_at FROM users WHERE 1=1';
        let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
        const params = [];

        if (role) {
            query += ' AND role = ?';
            countQuery += ' AND role = ?';
            params.push(role);
        }

        if (search) {
            query += ' AND (username LIKE ? OR real_name LIKE ?)';
            countQuery += ' AND (username LIKE ? OR real_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        // params for data query needs limit and offset
        // params for count query does not
        
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

// Create a new user
router.post('/', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { username, password, role, phone, real_name, emergency_contact, emergency_phone } = req.body;

    try {
        // Check if user exists
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Ensure role is valid (default to user if not provided)
        const userRole = role || 'elderly';

        // Admin创建用户：明确设置为active，避免触发器将其置为pending
        await pool.query(
            'INSERT INTO users (username, password, role, phone, real_name, emergency_contact, emergency_phone, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [
                username,
                hashedPassword,
                userRole,
                phone,
                real_name,
                emergency_contact || null,
                emergency_phone || null,
                'active'
            ]
        );

        res.status(201).json({ message: 'User created successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update a user
router.put('/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { id } = req.params;
    const { role, phone, real_name, password, emergency_contact, emergency_phone } = req.body;

    try {
        const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
        if (user.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        let query = 'UPDATE users SET role = ?, phone = ?, real_name = ?, emergency_contact = ?, emergency_phone = ?';
        const params = [role, phone, real_name, emergency_contact || null, emergency_phone || null];

        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            query += ', password = ?';
            params.push(hashedPassword);
        }

        query += ' WHERE id = ?';
        params.push(id);

        await pool.query(query, params);

        res.json({ message: 'User updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete a user
router.delete('/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;

    const { id } = req.params;

    try {
        // Prevent deleting yourself (optional but good practice)
        // This requires req.user to be set by auth middleware
        if (req.user && req.user.id == id) {
             return res.status(400).json({ message: 'Cannot delete yourself' });
        }

        // Check if user exists
        const [userCheck] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
        if (userCheck.length === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Manually delete related records first due to foreign key constraints
        // Or update them to NULL if that's preferred, but usually for user deletion we want to clean up.
        // Assuming we want to delete all related data.
        
        // 1. Delete from family_elderly_bindings
        await pool.query('DELETE FROM family_elderly_bindings WHERE elderly_id = ? OR family_id = ?', [id, id]);
        
        // 2. Delete from health_data
        await pool.query('DELETE FROM health_data WHERE user_id = ?', [id]);
        
        // 3. Delete from tasks (as publisher or volunteer)
        // Use publisher_id instead of creator_id based on schema
        await pool.query('DELETE FROM tasks WHERE publisher_id = ?', [id]);
        // Also delete tasks where user is beneficiary (if applicable)
        await pool.query('DELETE FROM tasks WHERE beneficiary_id = ?', [id]);
        
        // For tasks where user is volunteer, set volunteer_id to NULL
        await pool.query('UPDATE tasks SET volunteer_id = NULL WHERE volunteer_id = ?', [id]);

        // 4. Delete from activity_participants
        await pool.query('DELETE FROM activity_participants WHERE user_id = ?', [id]);
        
        // 5. Delete from messages/notifications
        // (Add more tables here as needed based on your schema)
        await pool.query('DELETE FROM points_log WHERE user_id = ?', [id]);
        
        const [result] = await pool.query('DELETE FROM users WHERE id = ?', [id]);
        
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error: ' + error.message });
    }
});

module.exports = router;
