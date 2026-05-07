const pool = require('./db');
const bcrypt = require('bcryptjs');

async function seedAdmin() {
    try {
        console.log('Connecting to database...');
        // Test connection
        await pool.query('SELECT 1');
        console.log('Database connected.');

        const username = 'admin';
        const password = 'adminpassword';
        const role = 'admin';
        const phone = '13800000000';

        // Check if admin already exists
        const [existing] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        if (existing.length > 0) {
            console.log(`Admin user '${username}' already exists. ID: ${existing[0].id}, Role: ${existing[0].role}`);
            
            // Optional: Update password to ensure it's correct
            const hashedPassword = await bcrypt.hash(password, 10);
            await pool.query('UPDATE users SET password = ?, role = ? WHERE username = ?', [hashedPassword, role, username]);
            console.log(`Password reset for user '${username}' to '${password}'`);
            
            return;
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO users (username, password, role, phone, real_name) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, role, phone, '系统管理员']
        );

        console.log(`Admin user created successfully. Username: ${username}, Password: ${password}`);

    } catch (error) {
        console.error('Error seeding admin:', error);
    } finally {
        // We need to close the pool manually to exit the script, 
        // but pool.end() might not be available on the promise wrapper directly in all versions.
        // Usually process.exit() is enough for a script.
        process.exit();
    }
}

seedAdmin();
