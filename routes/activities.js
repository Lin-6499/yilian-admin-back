const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search;
    let query = `
      SELECT
        a.id,
        a.title,
        a.description,
        a.location,
        a.start_time,
        a.end_time,
        a.max_participants,
        a.image_url,
        a.created_at,
        COALESCE(p.signup_count, 0) AS signup_count
      FROM activities a
      LEFT JOIN (
        SELECT activity_id, COUNT(*) AS signup_count
        FROM activity_participants
        GROUP BY activity_id
      ) p ON p.activity_id = a.id
      WHERE 1=1
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM activities a WHERE 1=1';
    const params = [];
    if (search) {
      query += ' AND title LIKE ?';
      countQuery += ' AND title LIKE ?';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY start_time DESC LIMIT ? OFFSET ?';
    const countParams = [...params];
    params.push(limit, offset);
    const [rows] = await pool.query(query, params);
    const [totalRes] = await pool.query(countQuery, countParams);
    const total = totalRes[0].total;
    res.json({ activities: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id/participants', async (req, res) => {
  try {
    const { id } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10000;
    const offset = (page - 1) * limit;

    const [exists] = await pool.query('SELECT id FROM activities WHERE id=?', [id]);
    if (exists.length === 0) return res.status(404).json({ message: 'Not found' });

    const [rows] = await pool.query(
      `
        SELECT
          ap.id,
          ap.activity_id,
          ap.user_id,
          ap.joined_at,
          u.username,
          u.real_name,
          u.phone,
          u.role
        FROM activity_participants ap
        JOIN users u ON ap.user_id = u.id
        WHERE ap.activity_id = ?
        ORDER BY ap.joined_at DESC
        LIMIT ? OFFSET ?
      `,
      [id, limit, offset]
    );

    const [totalRes] = await pool.query(
      'SELECT COUNT(*) AS total FROM activity_participants WHERE activity_id = ?',
      [id]
    );
    const total = totalRes[0].total;
    res.json({ data: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, description, location, start_time, end_time, max_participants, image_url } = req.body;
    if (!title || !location || !start_time || !end_time) {
      return res.status(400).json({ message: '缺少必填字段' });
    }
    await pool.query(
      'INSERT INTO activities (title,description,location,start_time,end_time,max_participants,image_url) VALUES (?,?,?,?,?,?,?)',
      [title, description || null, location, start_time, end_time, max_participants || 0, image_url || null]
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
    const { title, description, location, start_time, end_time, max_participants, image_url } = req.body;
    const [exists] = await pool.query('SELECT id FROM activities WHERE id=?', [id]);
    if (exists.length === 0) return res.status(404).json({ message: 'Not found' });
    await pool.query(
      'UPDATE activities SET title=?, description=?, location=?, start_time=?, end_time=?, max_participants=?, image_url=? WHERE id=?',
      [title, description || null, location, start_time, end_time, max_participants || 0, image_url || null, id]
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
    await pool.query('DELETE FROM activity_signups WHERE activity_id=?', [id]);
    await pool.query('DELETE FROM activity_participants WHERE activity_id=?', [id]);
    const [r] = await pool.query('DELETE FROM activities WHERE id=?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
