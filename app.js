const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const path = require('path');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const userRoutes = require('./routes/user');
const activitiesRoutes = require('./routes/activities');
const announcementsRoutes = require('./routes/announcements');
const neighborsRoutes = require('./routes/neighbors');
const auditRoutes = require('./routes/audit');
const tasksRoutes = require('./routes/tasks');
const pointsRoutes = require('./routes/points');
const dashboardRoutes = require('./routes/dashboard');
const systemRoutes = require('./routes/system');
const ordersRoutes = require('./routes/orders');
const videosRoutes = require('./routes/videos');
const adminProductsRoutes = require('./routes/products');
const uploadRoutes = require('./routes/upload');
const authMiddleware = require('./middleware/auth');
const { getJwtSecret } = require('./shared/jwt-secret');
const fs = require('fs');
const https = require('https')
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure core tables exist
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS task_disputes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                task_id INT NOT NULL,
                reporter_id INT NULL,
                reason VARCHAR(100) NOT NULL,
                description TEXT NULL,
                evidence_url VARCHAR(255) NULL,
                status ENUM('pending','resolved','rejected') NOT NULL DEFAULT 'pending',
                resolution TEXT NULL,
                admin_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                CONSTRAINT fk_task_disputes_task_id FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
                CONSTRAINT fk_task_disputes_reporter_id FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT fk_task_disputes_admin_id FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS announcements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                content TEXT NOT NULL,
                status ENUM('draft','published') NOT NULL DEFAULT 'published',
                is_pinned TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

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

        try {
            await pool.query(`ALTER TABLE video_courses MODIFY video_url TEXT NOT NULL`);
            await pool.query(`ALTER TABLE video_courses MODIFY cover_url TEXT NULL`);
        } catch (alterError) {
            // Table may already use the right types; ignore migration races
        }
    } catch (error) {
        console.error('Failed to ensure admin tables:', error.message || error);
    }
})();

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Routes
app.use('/api/admin/users', authMiddleware, userRoutes);
app.use('/api/admin/activities', authMiddleware, activitiesRoutes);
app.use('/api/admin/announcements', authMiddleware, announcementsRoutes);
app.use('/api/admin/neighbors', authMiddleware, neighborsRoutes);
app.use('/api/admin/audit', authMiddleware, auditRoutes);
app.use('/api/admin/tasks', authMiddleware, tasksRoutes);
app.use('/api/admin/points', authMiddleware, pointsRoutes);
app.use('/api/admin/dashboard', authMiddleware, dashboardRoutes);
app.use('/api/admin/system', authMiddleware, systemRoutes);
app.use('/api/admin/orders', authMiddleware, ordersRoutes);
app.use('/api/admin/videos', authMiddleware, videosRoutes);
app.use('/api/admin/products', authMiddleware, adminProductsRoutes);
app.use('/api/admin/upload', authMiddleware, uploadRoutes);

// Admin Login
app.post('/api/admin/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND role = "admin"', [username]);

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials or not an admin' });
        }

        const user = users[0];
        const validPassword = await bcrypt.compare(password, user.password);

        if (!validPassword) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        let jwtSecret;
        try {
            jwtSecret = getJwtSecret();
        } catch (error) {
            console.error(error);
            return res.status(500).json({ message: 'Server misconfigured' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: '24h' });

        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
});

const sslOptions = {
    key: fs.readFileSync(`${__dirname}/private-key.pem`),
    cert: fs.readFileSync(`${__dirname}/certificate.pem`),
};

// Start server
https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`✅ HTTPS 后端运行中：https://43.138.138.136:${PORT}`);
});
