require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
 
const connectDB = require('./config/db');
const initChatSocket = require('./sockets/chatSocket');
const initLogisticsChatSocket = require('./sockets/logisticsChatSocket'); // ← added
 
const authRoutes = require('./routes/auth');
const listingRoutes = require('./routes/listings');
const bidRoutes = require('./routes/bids');
const orderRoutes = require('./routes/orders');
const chatRoutes = require('./routes/chat');
const matchingRoutes = require('./routes/matching');
const priceRoutes = require('./routes/price'); // ← added: AI Price Estimate

// ← added: logistics routes (auth now goes through the shared /api/auth routes above —
// logistics partners are just `role: 'logistics'` Users, so there's no separate
// logistics auth route anymore)
const logisticsTransactionRoutes = require('./routes/logisticsTransactions');
const logisticsMessageRoutes = require('./routes/logisticsMessages');
 
const app = express();
const server = http.createServer(app);
 
// ── CORS: allow your frontend to call this API ──
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());
 
// ── Socket.io, same CORS rule ──
const io = new Server(server, {
  cors: { origin: process.env.CLIENT_URL || '*' },
});
initChatSocket(io);
initLogisticsChatSocket(io); // ← added
 
// ── Routes ──
app.use('/api/auth', authRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/matching', matchingRoutes);
app.use('/api/price', priceRoutes); // ← added: AI Price Estimate

// ← added: logistics routes
app.use('/api/logistics/transactions', logisticsTransactionRoutes);
app.use('/api/logistics/messages', logisticsMessageRoutes);
 
app.get('/', (req, res) => {
  res.json({ status: 'Nexora API is running' });
});
 
// ── Basic error handler for anything that slips through ──
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});
 
const PORT = process.env.PORT || 5000;
 
connectDB().then(() => {
  server.listen(PORT, () => {
    console.log(`🚀 Nexora backend running on port ${PORT}`);
  });
});