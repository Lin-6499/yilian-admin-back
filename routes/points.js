const express = require('express');
const router = express.Router();
const pool = require('../db');

const allowedTypes = new Set(['task_reward', 'task_payment', 'mall_exchange', 'system_grant', 'donation']);

router.get('/logs', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const userId = req.query.user_id;
    const type = req.query.type;
    const search = req.query.search;
    const direction = req.query.direction;

    let query = `
      SELECT
        pl.id,
        pl.user_id,
        u.username,
        u.role,
        u.phone,
        pl.amount,
        pl.type,
        pl.description,
        pl.related_id,
        pl.created_at
      FROM points_log pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE 1=1
    `;

    let countQuery = `
      SELECT COUNT(*) AS total
      FROM points_log pl
      LEFT JOIN users u ON pl.user_id = u.id
      WHERE 1=1
    `;

    const params = [];

    if (userId) {
      query += ' AND pl.user_id = ?';
      countQuery += ' AND pl.user_id = ?';
      params.push(userId);
    }

    if (type) {
      if (!allowedTypes.has(type)) return res.status(400).json({ message: 'Invalid type' });
      query += ' AND pl.type = ?';
      countQuery += ' AND pl.type = ?';
      params.push(type);
    }

    if (direction === 'in') {
      query += ' AND pl.amount > 0';
      countQuery += ' AND pl.amount > 0';
    } else if (direction === 'out') {
      query += ' AND pl.amount < 0';
      countQuery += ' AND pl.amount < 0';
    }

    if (search) {
      query += ' AND (u.username LIKE ? OR pl.description LIKE ?)';
      countQuery += ' AND (u.username LIKE ? OR pl.description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY pl.created_at DESC LIMIT ? OFFSET ?';
    const countParams = [...params];
    params.push(limit, offset);

    const [rows] = await pool.query(query, params);
    const [totalRes] = await pool.query(countQuery, countParams);
    const total = totalRes[0].total;

    res.json({ data: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/adjust', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { user_id, amount, description } = req.body || {};
    const delta = parseInt(amount);
    const uid = parseInt(user_id);

    if (!uid || !Number.isInteger(delta) || delta === 0) {
      return res.status(400).json({ message: '参数不合法' });
    }

    await connection.beginTransaction();

    const [users] = await connection.query('SELECT id, points FROM users WHERE id = ? FOR UPDATE', [uid]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: '用户不存在' });
    }

    const currentPoints = users[0].points || 0;
    const nextPoints = currentPoints + delta;
    if (nextPoints < 0) {
      await connection.rollback();
      return res.status(400).json({ message: '积分不足，无法扣减到负数' });
    }

    await connection.query('UPDATE users SET points = ? WHERE id = ?', [nextPoints, uid]);

    const adminName = req.user?.username || 'admin';
    const desc = description ? String(description) : '';
    const fullDesc = desc ? `管理员(${adminName})调整积分: ${desc}` : `管理员(${adminName})调整积分`;

    await connection.query(
      'INSERT INTO points_log (user_id, amount, type, description, related_id) VALUES (?, ?, ?, ?, ?)',
      [uid, delta, 'system_grant', fullDesc, null]
    );

    await connection.commit();
    res.json({ message: 'Adjusted', points: nextPoints });
  } catch (e) {
    await connection.rollback();
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  } finally {
    connection.release();
  }
});

module.exports = router;

