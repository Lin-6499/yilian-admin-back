const express = require('express');
const router = express.Router();
const pool = require('../db');

const allowedStatuses = new Set(['pending', 'assigned', 'in_progress', 'completed', 'cancelled']);
const allowedDisputeStatuses = new Set(['pending', 'resolved', 'rejected']);

const allowedTaskActions = new Set(['no_change', 'cancel', 'reset_pending', 'complete']);

router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;

    let query = `
      SELECT
        t.id,
        t.title,
        t.description,
        t.status,
        p.username AS publisher_name,
        v.username AS volunteer_name,
        t.location,
        t.scheduled_time,
        t.points_reward,
        t.created_at
      FROM tasks t
      LEFT JOIN users p ON t.publisher_id = p.id
      LEFT JOIN users v ON t.volunteer_id = v.id
      WHERE 1=1
    `;

    let countQuery = `
      SELECT COUNT(*) AS total
      FROM tasks t
      LEFT JOIN users p ON t.publisher_id = p.id
      LEFT JOIN users v ON t.volunteer_id = v.id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      if (!allowedStatuses.has(status)) {
        return res.status(400).json({ message: 'Invalid status' });
      }
      query += ' AND t.status = ?';
      countQuery += ' AND t.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (t.title LIKE ? OR t.description LIKE ? OR p.username LIKE ? OR v.username LIKE ?)';
      countQuery += ' AND (t.title LIKE ? OR t.description LIKE ? OR p.username LIKE ? OR v.username LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    const countParams = [...params];
    params.push(limit, offset);

    const [rows] = await pool.query(query, params);
    const [totalRes] = await pool.query(countQuery, countParams);
    const total = totalRes[0].total;

    res.json({ data: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: '获取任务列表失败' });
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!/^\d+$/.test(id)) return next();
    const [rows] = await pool.query(
      `
        SELECT
          t.*,
          p.username AS publisher_name,
          p.phone AS publisher_phone,
          v.username AS volunteer_name,
          v.phone AS volunteer_phone
        FROM tasks t
        LEFT JOIN users p ON t.publisher_id = p.id
        LEFT JOIN users v ON t.volunteer_id = v.id
        WHERE t.id = ?
      `,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ data: rows[0] });
  } catch (error) {
    console.error('Error fetching task detail:', error);
    res.status(500).json({ message: '获取任务详情失败' });
  }
});

router.put('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!status || !allowedStatuses.has(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }
    const [r] = await pool.query('UPDATE tasks SET status = ? WHERE id = ?', [status, id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Updated' });
  } catch (error) {
    console.error('Error updating task status:', error);
    res.status(500).json({ message: '更新任务状态失败' });
  }
});

router.post('/:id/unassign', async (req, res) => {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      'UPDATE tasks SET volunteer_id = NULL, status = ? WHERE id = ?',
      ['pending', id]
    );
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ message: 'Unassigned' });
  } catch (error) {
    console.error('Error unassigning task:', error);
    res.status(500).json({ message: '取消指派失败' });
  }
});

router.get('/disputes', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const search = req.query.search;

    let query = `
      SELECT
        d.id,
        d.task_id,
        d.reason,
        d.status,
        d.created_at,
        d.updated_at,
        t.title AS task_title,
        t.status AS task_status,
        reporter.username AS reporter_name,
        publisher.username AS publisher_name,
        volunteer.username AS volunteer_name
      FROM task_disputes d
      JOIN tasks t ON d.task_id = t.id
      LEFT JOIN users reporter ON d.reporter_id = reporter.id
      LEFT JOIN users publisher ON t.publisher_id = publisher.id
      LEFT JOIN users volunteer ON t.volunteer_id = volunteer.id
      WHERE 1=1
    `;

    let countQuery = `
      SELECT COUNT(*) AS total
      FROM task_disputes d
      JOIN tasks t ON d.task_id = t.id
      LEFT JOIN users reporter ON d.reporter_id = reporter.id
      WHERE 1=1
    `;

    const params = [];

    if (status) {
      if (!allowedDisputeStatuses.has(status)) return res.status(400).json({ message: 'Invalid status' });
      query += ' AND d.status = ?';
      countQuery += ' AND d.status = ?';
      params.push(status);
    }

    if (search) {
      query += ' AND (t.title LIKE ? OR d.reason LIKE ? OR reporter.username LIKE ?)';
      countQuery += ' AND (t.title LIKE ? OR d.reason LIKE ? OR reporter.username LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY d.created_at DESC LIMIT ? OFFSET ?';
    const countParams = [...params];
    params.push(limit, offset);

    const [rows] = await pool.query(query, params);
    const [totalRes] = await pool.query(countQuery, countParams);
    const total = totalRes[0].total;
    res.json({ data: rows, total, page, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Error fetching disputes:', error);
    res.status(500).json({ message: '获取纠纷列表失败' });
  }
});

router.get('/disputes/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `
        SELECT
          d.*,
          t.title AS task_title,
          t.description AS task_description,
          t.status AS task_status,
          t.location AS task_location,
          t.scheduled_time AS task_scheduled_time,
          t.points_reward AS task_points_reward,
          reporter.username AS reporter_name,
          reporter.phone AS reporter_phone,
          publisher.username AS publisher_name,
          publisher.phone AS publisher_phone,
          volunteer.username AS volunteer_name,
          volunteer.phone AS volunteer_phone,
          admin.username AS admin_name
        FROM task_disputes d
        JOIN tasks t ON d.task_id = t.id
        LEFT JOIN users reporter ON d.reporter_id = reporter.id
        LEFT JOIN users publisher ON t.publisher_id = publisher.id
        LEFT JOIN users volunteer ON t.volunteer_id = volunteer.id
        LEFT JOIN users admin ON d.admin_id = admin.id
        WHERE d.id = ?
      `,
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json({ data: rows[0] });
  } catch (error) {
    console.error('Error fetching dispute detail:', error);
    res.status(500).json({ message: '获取纠纷详情失败' });
  }
});

router.post('/disputes/:id/resolve', async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { resolution, task_action } = req.body || {};

    const action = task_action || 'no_change';
    if (!allowedTaskActions.has(action)) return res.status(400).json({ message: 'Invalid action' });

    await connection.beginTransaction();

    const [disputeRows] = await connection.query('SELECT * FROM task_disputes WHERE id = ? FOR UPDATE', [id]);
    if (disputeRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: 'Not found' });
    }

    const dispute = disputeRows[0];
    if (dispute.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ message: 'Dispute already processed' });
    }

    if (action === 'cancel') {
      await connection.query('UPDATE tasks SET status = ?, volunteer_id = NULL WHERE id = ?', ['cancelled', dispute.task_id]);
    } else if (action === 'reset_pending') {
      await connection.query('UPDATE tasks SET status = ?, volunteer_id = NULL WHERE id = ?', ['pending', dispute.task_id]);
    } else if (action === 'complete') {
      await connection.query('UPDATE tasks SET status = ? WHERE id = ?', ['completed', dispute.task_id]);
    }

    await connection.query(
      'UPDATE task_disputes SET status = ?, resolution = ?, admin_id = ? WHERE id = ?',
      ['resolved', resolution || null, req.user?.id || null, id]
    );

    await connection.commit();
    res.json({ message: 'Resolved' });
  } catch (error) {
    await connection.rollback();
    console.error('Error resolving dispute:', error);
    res.status(500).json({ message: '处理纠纷失败' });
  } finally {
    connection.release();
  }
});

router.post('/disputes/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body || {};

    const [r] = await pool.query(
      'UPDATE task_disputes SET status = ?, resolution = ?, admin_id = ? WHERE id = ? AND status = ?',
      ['rejected', resolution || null, req.user?.id || null, id, 'pending']
    );
    if (r.affectedRows === 0) return res.status(400).json({ message: 'Not found or already processed' });
    res.json({ message: 'Rejected' });
  } catch (error) {
    console.error('Error rejecting dispute:', error);
    res.status(500).json({ message: '拒绝纠纷失败' });
  }
});

module.exports = router;
