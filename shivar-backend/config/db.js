const mongoose = require('mongoose');
const dns = require('dns');

// Ensure reliable SRV resolution across environments
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (e) {
  // Ignore if not permitted
}

async function connectDB() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGO_URI is missing from environment variables.');
    process.exit(1);
  }

  // Safety Guardrail: Prevent modifying or connecting to the legacy nexora database
  if (/nexora/i.test(uri)) {
    console.error('❌ SAFETY GUARD: Blocked connection attempt to legacy "nexora" database.');
    console.error('❌ Please ensure MONGO_URI points to the new SHIVAR database.');
    process.exit(1);
  }

  try {
    const conn = await mongoose.connect(uri);
    console.log(`✅ MongoDB connected: ${conn.connection.host} (DB: ${conn.connection.name})`);
    return conn;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = connectDB;
