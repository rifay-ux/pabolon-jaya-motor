require('dotenv').config();
const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');
const { v4: uuidv4 } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Koneksi database
const pool = mysql.createPool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     process.env.DB_PORT     || 3306,
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'pabolon_jaya',
  waitForConnections: true,
  connectionLimit: 10,
  timezone: '+07:00'
});

(async () => {
  try {
    const conn = await pool.getConnection();
    console.log('✅ Terhubung ke database MySQL');
    conn.release();
  } catch (err) {
    console.error('❌ Gagal koneksi database:', err.message);
    process.exit(1);
  }
})();

// ============================================================
// API: BARANG
// ============================================================

// GET semua barang
app.get('/api/items', async (req, res) => {
  try {
    const { q, category, low_stock, id, categories } = req.query;

    // Ambil kategori unik
    if (categories) {
      const [rows] = await pool.query('SELECT DISTINCT category FROM items ORDER BY category ASC');
      return res.json({ success: true, data: rows.map(r => r.category) });
    }

    // Ambil satu barang
    if (id) {
      const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Barang tidak ditemukan' });
      return res.json({ success: true, data: rows[0] });
    }

    // Ambil semua barang
    let sql = 'SELECT * FROM items WHERE 1=1';
    const params = [];
    if (q) {
      sql += ' AND (name LIKE ? OR sku LIKE ? OR category LIKE ?)';
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    if (category && category !== 'Semua') {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (low_stock) sql += ' AND stock <= min_stock';
    sql += ' ORDER BY name ASC';

    const [rows] = await pool.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST tambah barang
app.post('/api/items', async (req, res) => {
  try {
    const { name, category, sku, price, cost, stock, min_stock, unit } = req.body;
    if (!name || price === undefined || stock === undefined)
      return res.status(400).json({ success: false, message: 'Nama, harga, dan stok wajib diisi' });

    const id = uuidv4();
    await pool.query(
      'INSERT INTO items (id,name,category,sku,price,cost,stock,min_stock,unit) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, name, category||'Lainnya', sku||'SKU-'+Date.now().toString().slice(-5), price||0, cost||0, stock||0, min_stock||3, unit||'pcs']
    );
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err.code === 'ER_DUP_ENTRY' ? 'SKU sudah digunakan' : err.message;
    res.status(400).json({ success: false, message: msg });
  }
});

// PUT edit barang
app.put('/api/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, sku, price, cost, stock, min_stock, unit } = req.body;
    await pool.query(
      'UPDATE items SET name=?,category=?,sku=?,price=?,cost=?,stock=?,min_stock=?,unit=? WHERE id=?',
      [name, category, sku, price, cost||0, stock, min_stock||3, unit, id]
    );
    const [rows] = await pool.query('SELECT * FROM items WHERE id = ?', [id]);
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    const msg = err.code === 'ER_DUP_ENTRY' ? 'SKU sudah digunakan' : err.message;
    res.status(400).json({ success: false, message: msg });
  }
});

// DELETE hapus barang
app.delete('/api/items/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM items WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Barang berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================
// API: TRANSAKSI
// ============================================================

// GET semua transaksi
app.get('/api/transactions', async (req, res) => {
  try {
    const [txs] = await pool.query('SELECT * FROM transactions ORDER BY created_at DESC LIMIT 200');
    const txIds = txs.map(t => t.id);
    let txItems = [];
    if (txIds.length) {
      const placeholders = txIds.map(() => '?').join(',');
      [txItems] = await pool.query(`SELECT * FROM transaction_items WHERE transaction_id IN (${placeholders})`, txIds);
    }
    const result = txs.map(tx => ({ ...tx, items: txItems.filter(ti => ti.transaction_id === tx.id) }));
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST buat transaksi baru
app.post('/api/transactions', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { customer_name, items } = req.body;
    if (!items || !items.length) throw new Error('Keranjang kosong');

    for (const ci of items) {
      const [rows] = await conn.query('SELECT id, name, stock FROM items WHERE id = ? FOR UPDATE', [ci.id]);
      if (!rows.length) throw new Error(`Barang tidak ditemukan`);
      if (rows[0].stock < ci.quantity) throw new Error(`Stok ${rows[0].name} tidak mencukupi (tersisa ${rows[0].stock})`);
    }

    const total     = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const invoiceNo = 'INV-' + Date.now().toString().slice(-8);
    const txId      = uuidv4();

    await conn.query('INSERT INTO transactions (id,invoice_no,customer_name,total) VALUES (?,?,?,?)',
      [txId, invoiceNo, customer_name||'Umum', total]);

    for (const ci of items) {
      await conn.query(
        'INSERT INTO transaction_items (id,transaction_id,item_id,item_name,price,quantity,subtotal) VALUES (?,?,?,?,?,?,?)',
        [uuidv4(), txId, ci.id, ci.name, ci.price, ci.quantity, ci.price * ci.quantity]
      );
      await conn.query('UPDATE items SET stock = stock - ? WHERE id = ?', [ci.quantity, ci.id]);
    }

    await conn.commit();
    const [txRows] = await pool.query('SELECT * FROM transactions WHERE id = ?', [txId]);
    const [tiRows] = await pool.query('SELECT * FROM transaction_items WHERE transaction_id = ?', [txId]);
    res.status(201).json({ success: true, data: { ...txRows[0], items: tiRows } });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ success: false, message: err.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// API: STATISTIK
// ============================================================
app.get('/api/stats', async (req, res) => {
  try {
    const [[{ total_items }]]    = await pool.query('SELECT COUNT(*) AS total_items FROM items');
    const [[{ low_stock }]]      = await pool.query('SELECT COUNT(*) AS low_stock FROM items WHERE stock <= min_stock');
    const [[{ out_of_stock }]]   = await pool.query('SELECT COUNT(*) AS out_of_stock FROM items WHERE stock = 0');
    const [[{ nilai_stok }]]     = await pool.query('SELECT COALESCE(SUM(price*stock),0) AS nilai_stok FROM items');
    const today = new Date().toISOString().slice(0,10);
    const [[{ tx_hari_ini }]]    = await pool.query('SELECT COUNT(*) AS tx_hari_ini FROM transactions WHERE DATE(created_at) = ?', [today]);
    const [[{ omset_hari_ini }]] = await pool.query('SELECT COALESCE(SUM(total),0) AS omset_hari_ini FROM transactions WHERE DATE(created_at) = ?', [today]);
    res.json({ success: true, data: { total_items, low_stock, out_of_stock, nilai_stok, tx_hari_ini, omset_hari_ini } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Serve index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🔧 Pabolon Jaya Motor berjalan di http://localhost:${PORT}`);
});
