const express = require('express');
const router = express.Router();
const pool = require('../db');
const { getRecentHealthAlertSummary } = require('../services/healthAlertService');

router.get('/overview', async (req, res) => {
  try {
    const [[usersAgg]] = await pool.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(role='elderly') AS elderly,
        SUM(role='volunteer') AS volunteer,
        SUM(role='family') AS family,
        SUM(role='admin') AS admin
      FROM users`
    );

    const [[auditAgg]] = await pool.query(
      `SELECT COUNT(*) AS pending FROM users WHERE status='pending'`
    );

    const [[tasksAgg]] = await pool.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(status='pending') AS pending,
        SUM(status='assigned') AS assigned,
        SUM(status='in_progress') AS in_progress,
        SUM(status='completed') AS completed,
        SUM(status='cancelled') AS cancelled
      FROM tasks`
    );

    const [[disputesAgg]] = await pool.query(
      `SELECT 
        COUNT(*) AS total,
        SUM(status='pending') AS pending,
        SUM(status='resolved') AS resolved,
        SUM(status='rejected') AS rejected
      FROM task_disputes`
    );

    const [[todayNewUsers]] = await pool.query(
      `SELECT COUNT(*) AS c FROM users WHERE DATE(created_at)=CURDATE()`
    );

    const [[todayNewTasks]] = await pool.query(
      `SELECT COUNT(*) AS c FROM tasks WHERE DATE(created_at)=CURDATE()`
    );

    const [[todayActive]] = await pool.query(
      `SELECT COUNT(DISTINCT user_id) AS c FROM points_log WHERE DATE(created_at)=CURDATE()`
    );

    const healthSummary = await getRecentHealthAlertSummary(pool, { hours: 24 });

    res.json({
      users: usersAgg,
      audit: { pending: auditAgg.pending },
      tasks: tasksAgg,
      disputes: disputesAgg,
      today: {
        active_users: todayActive.c,
        new_users: todayNewUsers.c,
        new_tasks: todayNewTasks.c
      },
      health_alerts: healthSummary.health_alerts
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/trends', async (req, res) => {
  const daysParam = parseInt(req.query.days) || 7;
  const days = Math.max(1, Math.min(daysParam, 60));
  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

    const [usersRows] = await pool.query(
      `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM users WHERE created_at >= ? GROUP BY DATE(created_at)`,
      [startStr]
    );
    const [tasksRows] = await pool.query(
      `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM tasks WHERE created_at >= ? GROUP BY DATE(created_at)`,
      [startStr]
    );
    const [disputesRows] = await pool.query(
      `SELECT DATE(created_at) AS d, COUNT(*) AS c
       FROM task_disputes WHERE created_at >= ? GROUP BY DATE(created_at)`,
      [startStr]
    );
    const [pointsRows] = await pool.query(
      `SELECT DATE(created_at) AS d,
              SUM(CASE WHEN amount>0 THEN amount ELSE 0 END) AS in_amount,
              SUM(CASE WHEN amount<0 THEN -amount ELSE 0 END) AS out_amount
       FROM points_log
       WHERE created_at >= ?
       GROUP BY DATE(created_at)`,
      [startStr]
    );

    const daysArr = [];
    const today = new Date(start);
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      daysArr.push(s);
    }

    const mapByDate = (rows, key) => {
      const m = {};
      for (const r of rows) {
        const d = r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d);
        m[d] = Number(r[key] || r.c || 0);
      }
      return daysArr.map(d => m[d] || 0);
    };

    const new_users = mapByDate(usersRows, 'c');
    const new_tasks = mapByDate(tasksRows, 'c');
    const disputes = mapByDate(disputesRows, 'c');
    const points_in = mapByDate(pointsRows, 'in_amount');
    const points_out = mapByDate(pointsRows, 'out_amount');

    res.json({
      days: daysArr,
      new_users,
      new_tasks,
      disputes,
      points_in,
      points_out
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

