const express = require('express');
const pool = require('../db');

const router = express.Router();

const isValidHttpUrl = (value) => {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
};

// Ensure video tables exist
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS video_courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL COMMENT '课程标题',
        category ENUM('yangsheng', 'xiqu', 'legal') NOT NULL COMMENT '课程分类',
        description TEXT COMMENT '课程简介',
        video_url TEXT NOT NULL COMMENT '视频地址',
        cover_url TEXT COMMENT '封面地址',
        tags TEXT COMMENT '标签(JSON字符串或逗号分隔)',
        status ENUM('published', 'hidden') NOT NULL DEFAULT 'published' COMMENT '状态',
        sort_order INT NOT NULL DEFAULT 0 COMMENT '排序值',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    // Ensure existing column types can hold long URLs (handle migrations on existing DB)
    try {
      await pool.query(`ALTER TABLE video_courses MODIFY video_url TEXT NOT NULL`);
      await pool.query(`ALTER TABLE video_courses MODIFY cover_url TEXT NULL`);
    } catch (alterErr) {
      // Ignore errors from ALTER (might already be TEXT or table not present yet)
    }
  } catch (error) {
    console.error('Failed to ensure video_courses table:', error.message || error);
  }
})();

const parseTags = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(value)
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
};

// GET /api/admin/videos
router.get('/', async (req, res) => {
  const { search = '', category = '', status = '', page = 1, limit = 20 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);
  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(title LIKE ? OR description LIKE ? OR tags LIKE ?)');
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (category) {
    conditions.push('category = ?');
    params.push(category);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM video_courses ${where}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM video_courses ${where} ORDER BY sort_order DESC, created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({
      data: rows.map((row) => ({ ...row, tags: parseTags(row.tags) })),
      total: countRows[0]?.total || 0,
      page: Number(page),
      limit: Number(limit)
    });
  } catch (error) {
    console.error('GET /api/admin/videos error:', error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/videos
router.post('/', async (req, res) => {
  const {
    title,
    category,
    description,
    video_url,
    cover_url,
    tags = [],
    status = 'published',
    sort_order = 0
  } = req.body;

  if (!title || !category || !video_url) {
    return res.status(400).json({ message: 'title, category, video_url are required' });
  }
  if (!isValidHttpUrl(video_url)) {
    return res.status(400).json({ message: 'video_url 必须是有效的 http/https 地址' });
  }
  if (cover_url && !isValidHttpUrl(cover_url)) {
    return res.status(400).json({ message: 'cover_url 必须是有效的 http/https 地址' });
  }

  try {
    // Debugging: log incoming request headers and payload for troubleshooting 500 errors
    try {
      console.log('POST /api/admin/videos headers:', JSON.stringify(req.headers));
    } catch (hErr) {
      console.log('POST /api/admin/videos headers (raw):', req.headers);
    }
    console.log('POST /api/admin/videos body:', req.body);

    const [result] = await pool.query(
      'INSERT INTO video_courses (title, category, description, video_url, cover_url, tags, status, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, category, description || null, video_url, cover_url || null, JSON.stringify(parseTags(tags)), status, Number(sort_order) || 0]
    );

    const [rows] = await pool.query('SELECT * FROM video_courses WHERE id = ?', [result.insertId]);
    res.json({ data: { ...rows[0], tags: parseTags(rows[0].tags) } });
  } catch (error) {
    console.error('POST /api/admin/videos error:', error.stack || error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/admin/videos/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    title,
    category,
    description,
    video_url,
    cover_url,
    tags = [],
    status = 'published',
    sort_order = 0
  } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM video_courses WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ message: '课程不存在' });
    }

    if (video_url && !isValidHttpUrl(video_url)) {
      return res.status(400).json({ message: 'video_url 必须是有效的 http/https 地址' });
    }
    if (cover_url && !isValidHttpUrl(cover_url)) {
      return res.status(400).json({ message: 'cover_url 必须是有效的 http/https 地址' });
    }

    await pool.query(
      'UPDATE video_courses SET title = ?, category = ?, description = ?, video_url = ?, cover_url = ?, tags = ?, status = ?, sort_order = ? WHERE id = ?',
      [
        title || rows[0].title,
        category || rows[0].category,
        description ?? rows[0].description,
        video_url || rows[0].video_url,
        cover_url ?? rows[0].cover_url,
        JSON.stringify(parseTags(tags.length ? tags : rows[0].tags)),
        status || rows[0].status,
        Number(sort_order) || 0,
        id
      ]
    );

    const [updated] = await pool.query('SELECT * FROM video_courses WHERE id = ?', [id]);
    res.json({ data: { ...updated[0], tags: parseTags(updated[0].tags) } });
  } catch (error) {
    console.error('PUT /api/admin/videos/:id error:', error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/admin/videos/:id/status
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['published', 'hidden'].includes(status)) {
    return res.status(400).json({ message: '状态不合法' });
  }

  try {
    const [result] = await pool.query('UPDATE video_courses SET status = ? WHERE id = ?', [status, id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ message: '课程不存在' });
    }

    res.json({ message: '状态已更新' });
  } catch (error) {
    console.error('PATCH /api/admin/videos/:id/status error:', error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/admin/videos/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query('DELETE FROM video_courses WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('DELETE /api/admin/videos/:id error:', error.message || error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
