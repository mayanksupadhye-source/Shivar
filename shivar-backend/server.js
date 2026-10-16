require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const initUnifiedSocket = require('./sockets/chatSocket');

const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listings');
const demandRoutes = require('./routes/demand');
const bidRoutes = require('./routes/bids');
const orderRoutes = require('./routes/orders');
const transactionRoutes = require('./routes/transactions');
const chatRoutes = require('./routes/chat');
const matchingRoutes = require('./routes/matching');
const priceRoutes = require('./routes/price');
const advisorRoutes = require('./routes/advisor');

const logisticsTransactionRoutes = require('./routes/logisticsTransactions');
const logisticsMessageRoutes = require('./routes/logisticsMessages');

const app = express();
const server = http.createServer(app);

// ── CORS: allow frontend clients ──
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

// ── Unified Socket.io Gateway ──
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*' },
});
initUnifiedSocket(io);
app.set('io', io);

// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/demand', demandRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/advisor', advisorRoutes);

// Logistics portal endpoints
app.use('/api/logistics/transactions', logisticsTransactionRoutes);
app.use('/api/logistics/messages', logisticsMessageRoutes);

app.get('/', (req, res) => {
  res.json({ status: 'SHIVAR API is running', version: '2.0-canonical' });
});

// ── Basic error handler ──
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong', detail: err.message });
});

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  connectDB().then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 SHIVAR backend running on port ${PORT}`);
    });
  });
}

module.exports = { app, server };