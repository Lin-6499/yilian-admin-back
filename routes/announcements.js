const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search;
    const status = req.query.status;

    let query = 'SELECT id, title, content, status, is_pinned, created_at, updated_at FROM announcements WHERE 1=1';
    let countQuery = 'SELECT COUNT(*) as total FROM announcements WHERE 1=1';
    const params = [];

    if (status) {
      query += ' AND status = ?';
      countQuery += ' AND status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND title LIKE ?';
      countQuery += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }

    query += ' ORDER BY is_pinned DESC, updated_at DESC LIMIT ? OFFSET ?';
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

router.post('/', async (req, res) => {
  try {
    const { title, content, status, is_pinned } = req.body || {};
    if (!title || !content) return res.status(400).json({ message: '缺少必填字段' });
    const s = status || 'published';
    const pinned = is_pinned ? 1 : 0;
    await pool.query(
      'INSERT INTO announcements (title, content, status, is_pinned) VALUES (?,?,?,?)',
      [title, content, s, pinned]
    );
    res.status(201).json({ message: 'Created' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, status, is_pinned } = req.body || {};
    const [exists] = await pool.query('SELECT id FROM announcements WHERE id=?', [id]);
    if (exists.length === 0) return res.status(404).json({ message: 'Not found' });
    const pinned = is_pinned ? 1 : 0;
    await pool.query(
      'UPDATE announcements SET title=?, content=?, status=?, is_pinned=? WHERE id=?',
      [title, content, status, pinned, id]
    );
    res.json({ message: 'Updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [r] = await pool.query('DELETE FROM announcements WHERE id=?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
