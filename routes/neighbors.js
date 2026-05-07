const express = require('express');
const router = express.Router();
const pool = require('../db');

function toBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 1 || value === '1') {
    return true;
  }

  if (value === 0 || value === '0') {
    return false;
  }

  return null;
}

function parsePositiveInt(value, defaultValue, maxValue) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return Math.min(parsed, maxValue);
}

router.get('/', async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1, 1000000);
    const limit = parsePositiveInt(req.query.limit, 10, 100);
    const offset = (page - 1) * limit;
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim();

    let query = `
      SELECT
        p.id,
        p.author_id,
        u.username,
        u.real_name,
        u.role,
        p.content,
        p.status,
        p.is_pinned,
        p.like_count,
        p.comment_count,
        p.report_count,
        p.created_at,
        p.updated_at
      FROM neighbor_posts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE 1=1
    `;

    let countQuery = `
      SELECT COUNT(*) AS total
      FROM neighbor_posts p
      LEFT JOIN users u ON u.id = p.author_id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      query += ' AND p.status = ?';
      countQuery += ' AND p.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (p.content LIKE ? OR u.username LIKE ? OR u.real_name LIKE ?)';
      countQuery += ' AND (p.content LIKE ? OR u.username LIKE ? OR u.real_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY p.is_pinned DESC, p.created_at DESC LIMIT ? OFFSET ?';

    const countParams = [...params];
    params.push(limit, offset);

    const [rows] = await pool.query(query, params);
    const [totalRows] = await pool.query(countQuery, countParams);
    const total = totalRows[0].total;

    res.json({ data: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching neighbor posts:', error);
    res.status(500).json({ message: '获取邻里分享列表失败' });
  }
});

router.put('/:id/pin', async (req, res) => {
  try {
    const { id } = req.params;
    const isPinned = toBoolean(req.body?.is_pinned);

    if (isPinned === null) {
      return res.status(400).json({ message: 'is_pinned 参数无效' });
    }

    const [exists] = await pool.query('SELECT id FROM neighbor_posts WHERE id = ?', [id]);
    if (exists.length === 0) {
      return res.status(404).json({ message: '帖子不存在' });
    }

    await pool.query('UPDATE neighbor_posts SET is_pinned = ? WHERE id = ?', [isPinned ? 1 : 0, id]);
    res.json({ message: isPinned ? '已置顶' : '已取消置顶' });
  } catch (error) {
    console.error('Error updating neighbor pin state:', error);
    res.status(500).json({ message: '更新置顶状态失败' });
  }
});

module.exports = router;