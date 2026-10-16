
require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const initChatSocket = require('./sockets/chatSocket');
const initLogisticsChatSocket = require('./sockets/logisticsChatSocket');

const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listings');
const bidRoutes = require('./routes/bids');
const orderRoutes = require('./routes/orders');
const chatRoutes = require('./routes/chat');
const matchingRoutes = require('./routes/matching');
const priceRoutes = require('./routes/price');
const advisorRoutes = require('./routes/advisor');
const qualityRoutes = require('./routes/quality.routes');

const logisticsTransactionRoutes = require('./routes/logisticsTransactions');
const logisticsMessageRoutes = require('./routes/logisticsMessages');

const app = express();
const server = http.createServer(app);

const clientOrigin = process.env.CLIENT_URL || '*';

// Middleware

app.use(cors({
  origin: [
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ],
  credentials: true
}));

app.use(express.json());

// Existing API routes
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/price', priceRoutes);
app.use('/api/advisor', advisorRoutes);

app.use('/api/logistics/transactions', logisticsTransactionRoutes);
app.use('/api/logistics/messages', logisticsMessageRoutes);

// AI Crop Quality API
app.use('/api/quality', qualityRoutes);

// Socket.IO
const io = new Server(server, {
  cors: { origin: clientOrigin }
});

initChatSocket(io);
initLogisticsChatSocket(io);

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'Nexora API is running',
    qualityApi: '/api/quality/analyze'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Backend error:', err.message);

  const status = err.status || err.statusCode || 500;

  res.status(status).json({
    error: status >= 500
      ? 'Something went wrong'
      : err.message
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`Nexora backend running on port ${PORT}`);
      console.log('Crop Quality API: POST /api/quality/analyze');
    });
  } catch (error) {
    console.error('Backend startup failed:', error.message);
    process.exit(1);
  }
}

startServer();
