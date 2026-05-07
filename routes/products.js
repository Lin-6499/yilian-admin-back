const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/admin/products - list all products
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ products: rows });
  } catch (err) {
    console.error('Admin GET /products error:', err.message || err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/admin/products - create product
router.post('/', async (req, res) => {
  const { name, description, image_url, price_points, stock, category } = req.body;
  if (!name || price_points == null) return res.status(400).json({ message: 'name and price_points are required' });

  try {
    const [result] = await pool.query(
      'INSERT INTO products (name, description, image_url, price_points, stock, category) VALUES (?, ?, ?, ?, ?, ?)',
      [name, description || null, image_url || null, Number(price_points), Number(stock) || 0, category || 'goods']
    );

    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.json({ product: rows[0] });
  } catch (err) {
    console.error('Admin POST /products error:', err.message || err);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/admin/products/:id - update product
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, image_url, price_points, stock, category } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Product not found' });

    await pool.query(
      'UPDATE products SET name = ?, description = ?, image_url = ?, price_points = ?, stock = ?, category = ? WHERE id = ?',
      [name || rows[0].name, description ?? rows[0].description, image_url ?? rows[0].image_url, price_points != null ? Number(price_points) : rows[0].price_points, stock != null ? Number(stock) : rows[0].stock, category || rows[0].category, id]
    );

    const [updated] = await pool.query('SELECT * FROM products WHERE id = ?', [id]);
    res.json({ product: updated[0] });
  } catch (err) {
    console.error('Admin PUT /products/:id error:', err.message || err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/admin/products/:id - delete product
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM products WHERE id = ?', [id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Admin DELETE /products/:id error:', err.message || err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
