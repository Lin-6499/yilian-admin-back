const express = require('express');
const pool = require('../db');

const router = express.Router();

// Ensure admin logs table exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS order_admin_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        admin_id INT NULL,
        action VARCHAR(50) NOT NULL,
        note TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_order_admin_logs_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        CONSTRAINT fk_order_admin_logs_admin FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Ensure column nullable if older table exists with NOT NULL
    try {
      await pool.query(`ALTER TABLE order_admin_logs MODIFY COLUMN admin_id INT NULL`);
    } catch (alterErr) {
      // Ignore alter errors (e.g., table just created or different engine), but log for visibility
      console.info('order_admin_logs ALTER attempt:', alterErr.message || alterErr);
    }
  } catch (e) {
    console.error('Failed to ensure order_admin_logs table:', e.message || e);
  }
})();

// GET /api/admin/orders - list orders with optional status and pagination
router.get('/', async (req, res) => {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (Math.max(1, Number(page)) - 1) * Number(limit);

  try {
    const params = [];
    let where = '';
    if (status) {
      where = 'WHERE o.status = ?';
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT o.*, p.name as product_name, p.image_url as product_image, u.username, u.phone
       FROM orders o
       LEFT JOIN products p ON o.product_id = p.id
       LEFT JOIN users u ON o.user_id = u.id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), offset]
    );

    res.json({ orders: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/admin/orders/:id - order detail
router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT o.*, p.name as product_name, p.image_url as product_image, u.username, u.phone
       FROM orders o
       LEFT JOIN products p ON o.product_id = p.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? LIMIT 1`,
      [id]
    );

    const order = rows && rows[0];
    if (!order) return res.status(404).json({ message: 'Order not found' });

    const [logs] = await pool.query('SELECT * FROM order_admin_logs WHERE order_id = ? ORDER BY created_at DESC', [id]);

    res.json({ order, logs });
  } catch (err) {
    console.error('GET /api/admin/orders/:id error:', err.message || err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/admin/orders/:id/status - update status (admin action)
router.put('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status, note } = req.body;
  const adminId = req.user?.id || null;

  if (!status) return res.status(400).json({ message: 'Status is required' });

  // Allowed statuses: pending, shipped, completed, cancelled
  const allowed = ['pending', 'shipped', 'completed', 'cancelled'];
  if (!allowed.includes(status)) return res.status(400).json({ message: 'Invalid status' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [orders] = await conn.query('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (orders.length === 0) {
      await conn.rollback();
      conn.release();
      return res.status(404).json({ message: 'Order not found' });
    }

    const prevStatus = orders[0].status;

    await conn.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);

    // If admin cancels an order that was not already cancelled, refund points back to user
    if (status === 'cancelled' && prevStatus !== 'cancelled') {
      const userId = orders[0].user_id;
      const pointsCost = orders[0].points_cost || 0;
      if (pointsCost > 0) {
        await conn.query('UPDATE users SET points = points + ? WHERE id = ?', [pointsCost, userId]);
        await conn.query('INSERT INTO points_log (user_id, amount, type, description, related_id) VALUES (?, ?, ?, ?, ?)', [userId, pointsCost, 'system_grant', '取消订单退款', id]);
      }
    }

    // insert admin log (allow null adminId)
    await conn.query('INSERT INTO order_admin_logs (order_id, admin_id, action, note) VALUES (?, ?, ?, ?)', [id, adminId ?? null, status, note || null]);

    await conn.commit();
    conn.release();

    res.json({ message: 'Order updated', orderId: id });
  } catch (err) {
    try { await conn.rollback(); } catch (e) { /* ignore */ }
    try { conn.release(); } catch (e) { /* ignore */ }
    console.error('PUT /api/admin/orders/:id/status error:', err.message || err);
    res.status(500).json({ message: 'Server error', detail: err.message });
  }
});

module.exports = router;
