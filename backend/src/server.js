const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'waterboy',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// Test database connection
pool.connect((err, client, release) => {
  if (err) {
    console.error('Error connecting to database:', err.stack);
  } else {
    console.log('✓ Connected to PostgreSQL database');
    release();
  }
});

// Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Receive moisture data from Arduino
app.post('/api/moisture', async (req, res) => {
  try {
    const { pot_id, location, raw_value, moisture_percent } = req.body;

    console.log('Received data:', req.body);

    // Validate required fields
    if (!pot_id || raw_value === undefined || moisture_percent === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: pot_id, raw_value, moisture_percent' 
      });
    }

    // Insert reading into database
    const query = `
      INSERT INTO readings (pot_id, location, raw_value, moisture_percent, timestamp)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `;

    const values = [pot_id, location || null, raw_value, moisture_percent];
    const result = await pool.query(query, values);

    res.status(201).json({
      success: true,
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error saving reading:', error);
    res.status(500).json({ 
      error: 'Failed to save reading',
      details: error.message 
    });
  }
});

// Get all readings for a specific pot
app.get('/api/moisture/:pot_id', async (req, res) => {
  try {
    const { pot_id } = req.params;
    const limit = req.query.limit || 100;

    const query = `
      SELECT * FROM readings
      WHERE pot_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `;

    const result = await pool.query(query, [pot_id, limit]);

    res.json({
      success: true,
      pot_id,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching readings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch readings',
      details: error.message 
    });
  }
});

// Get latest reading for each pot
app.get('/api/pots/latest', async (req, res) => {
  try {
    const query = `
      SELECT DISTINCT ON (pot_id) 
        pot_id, 
        location, 
        raw_value, 
        moisture_percent, 
        timestamp
      FROM readings
      ORDER BY pot_id, timestamp DESC
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching latest readings:', error);
    res.status(500).json({ 
      error: 'Failed to fetch latest readings',
      details: error.message 
    });
  }
});

// Get all unique pots
app.get('/api/pots', async (req, res) => {
  try {
    const query = `
      SELECT 
        pot_id,
        location,
        COUNT(*) as reading_count,
        MAX(timestamp) as last_reading
      FROM readings
      GROUP BY pot_id, location
      ORDER BY pot_id
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });

  } catch (error) {
    console.error('Error fetching pots:', error);
    res.status(500).json({ 
      error: 'Failed to fetch pots',
      details: error.message 
    });
  }
});

// Delete old readings (cleanup utility)
app.delete('/api/readings/cleanup', async (req, res) => {
  try {
    const daysToKeep = req.query.days || 30;

    const query = `
      DELETE FROM readings
      WHERE timestamp < NOW() - INTERVAL '${daysToKeep} days'
      RETURNING *
    `;

    const result = await pool.query(query);

    res.json({
      success: true,
      deleted: result.rowCount,
      message: `Deleted readings older than ${daysToKeep} days`
    });

  } catch (error) {
    console.error('Error cleaning up readings:', error);
    res.status(500).json({ 
      error: 'Failed to cleanup readings',
      details: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    details: err.message 
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`💧 Waterboy API Server`);
  console.log(`=================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`=================================`);
});