require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const jwt = require('jsonwebtoken');

const connectDB = require('../config/db');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Demand = require('../models/Demand');
const Transaction = require('../models/Transaction');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Bid = require('../models/Bid');

const authRoutes = require('../routes/auth');
const listingRoutes = require('../routes/listings');
const demandRoutes = require('../routes/demand');
const bidRoutes = require('../routes/bids');
const transactionRoutes = require('../routes/transactions');
const logisticsTransactionRoutes = require('../routes/logisticsTransactions');
const logisticsMessageRoutes = require('../routes/logisticsMessages');
const chatRoutes = require('../routes/chat');
const orderRoutes = require('../routes/orders');
const initChatSocket = require('../sockets/chatSocket');

const PORT = 5066;
const BASE_URL = `http://localhost:${PORT}`;

async function run() {
  console.log('--- Starting Frontend Sync Verification Test ---');
  await connectDB();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/demand', demandRoutes);
  app.use('/api/bids', bidRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/logistics/transactions', logisticsTransactionRoutes);
  app.use('/api/logistics/messages', logisticsMessageRoutes);
  app.use('/api/chat', chatRoutes);

  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  initChatSocket(io);

  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Test server listening on ${BASE_URL}`);

  try {
    // 1. Get or create users
    const farmer = await User.findOne({ role: 'farmer' });
    const buyer = await User.findOne({ role: 'buyer' });
    const logistics = await User.findOne({ role: 'logistics' });

    console.log(`Farmer: ${farmer.name} (${farmer._id})`);
    console.log(`Buyer: ${buyer.name} (${buyer._id})`);
    console.log(`Logistics: ${logistics.name} (${logistics._id})`);

    const signToken = (u) => jwt.sign(
      { id: u._id, role: u.role, name: u.name, mobile: u.mobile, marketplaceId: u.marketplaceId },
      process.env.JWT_SECRET || 'nexora_jwt_secret_dev'
    );

    const farmerToken = signToken(farmer);
    const buyerToken = signToken(buyer);
    const logisticsToken = signToken(logistics);

    // 2. Test Buyer Posts Demand
    console.log('\n[Test 1] Buyer Posts Demand via API:');
    const demandRes = await fetch(`${BASE_URL}/api/demand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${buyerToken}` },
      body: JSON.stringify({
        crop: 'Organic Turmeric Erode',
        quantity: 25,
        maxPrice: 13500,
        district: 'Sangli',
        required_by_date: new Date(Date.now() + 86400000 * 7),
      }),
    });
    const demandData = await demandRes.json();
    if (!demandRes.ok) throw new Error(`Demand failed: ${JSON.stringify(demandData)}`);
    console.log(`✅ Demand created in MongoDB: ${demandData._id}, crop: ${demandData.crop}`);

    // Verify Farmer retrieves that demand
    const getDemandRes = await fetch(`${BASE_URL}/api/demand?status=open`, {
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    const allDemands = await getDemandRes.json();
    const foundDemand = allDemands.find((d) => String(d._id) === String(demandData._id));
    if (!foundDemand) throw new Error('Farmer could not find the created demand in GET /api/demand');
    console.log(`✅ Farmer retrieved buyer demand: "${foundDemand.crop}" (${foundDemand.required_quantity_tons} tons @ ₹${foundDemand.maximum_price_per_quintal}/qtl)`);

    // 3. Test Deal Creation (Farmer listing -> Buyer Bid -> Accept Bid -> Canonical Transaction)
    console.log('\n[Test 2] Deal confirmation & Canonical Transaction:');
    const listing = await Listing.create({
      farmer: farmer._id,
      farmer_id: farmer.marketplaceId,
      crop: 'Wheat Lokwan A-Grade',
      quantity_tonnes: 40,
      price_per_quintal: 2800,
      district: 'Nashik',
      status: 'available',
    });

    const bid = await Bid.create({
      listing: listing._id,
      farmer: farmer._id,
      buyer: buyer._id,
      quantity: 40,
      offerPrice: 2800,
      status: 'pending',
    });

    const acceptRes = await fetch(`${BASE_URL}/api/bids/${bid._id}/accept`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    const acceptData = await acceptRes.json();
    if (!acceptRes.ok) throw new Error(`Accept bid failed: ${JSON.stringify(acceptData)}`);
    console.log(`✅ Bid accepted: Transaction ${acceptData.transaction.transaction_id} created in MongoDB!`);

    const txId = acceptData.transaction._id;

    // 4. Test Logistics Partner Sees Transaction & Messaging Farmers
    console.log('\n[Test 3] Logistics Partner Board & 3-Way Messaging:');
    const logTxRes = await fetch(`${BASE_URL}/api/logistics/transactions`, {
      headers: { Authorization: `Bearer ${logisticsToken}` },
    });
    const logTxData = await logTxRes.json();
    const listedTx = logTxData.transactions?.find((t) => String(t._id) === String(txId));
    if (!listedTx) throw new Error('Logistics partner could not find the confirmed transaction on board');
    console.log(`✅ Logistics partner board lists transaction ${listedTx.transaction_id} (${listedTx.crop}) with farmer populated: ${listedTx.farmer?.name}`);

    // Logistics opens chat with Farmer
    const logFarmerChatRes = await fetch(`${BASE_URL}/api/logistics/messages/${txId}/${farmer._id}`, {
      headers: { Authorization: `Bearer ${logisticsToken}` },
    });
    const logFarmerChatData = await logFarmerChatRes.json();
    if (!logFarmerChatRes.ok) throw new Error(`Logistics chat with farmer failed: ${JSON.stringify(logFarmerChatData)}`);
    console.log(`✅ Logistics-Farmer conversation established: ${logFarmerChatData.conversationId}`);

    // Connect real Socket.io clients
    const logSocket = ioClient(BASE_URL, { auth: { token: logisticsToken } });
    const farmerSocket = ioClient(BASE_URL, { auth: { token: farmerToken } });
    const buyerSocket = ioClient(BASE_URL, { auth: { token: buyerToken } });

    await new Promise((r) => setTimeout(r, 600));

    // Logistics sends message to Farmer over Socket
    const p1 = new Promise((resolve) => {
      farmerSocket.on('new_message', (msg) => {
        if (msg.text.includes('dispatching a 10-ton truck')) {
          console.log(`✅ Farmer received real-time socket message: "${msg.text}" from ${msg.senderName} (${msg.senderRole})`);
          resolve(msg);
        }
      });
    });

    logSocket.emit('logistics_send_message', {
      transactionId: txId,
      otherUserId: farmer._id,
      text: 'Hello Farmer, dispatching a 10-ton truck for pickup tomorrow morning at 8 AM.',
    });

    await p1;

    // 5. Test Refresh Persistence: Farmer calls GET /api/chat/inbox/all
    console.log('\n[Test 4] Refresh Persistence for Farmer:');
    const farmerInboxRes = await fetch(`${BASE_URL}/api/chat/inbox/all`, {
      headers: { Authorization: `Bearer ${farmerToken}` },
    });
    const farmerInbox = await farmerInboxRes.json();
    const logisticsConvInFarmerInbox = farmerInbox.find((c) => c.type === 'farmer_logistics' && String(c.transaction?._id) === String(txId));
    if (!logisticsConvInFarmerInbox) throw new Error('Farmer inbox did not contain the logistics conversation upon refresh');
    console.log(`✅ Farmer inbox on refresh contains logistics conversation with lastMessage: "${logisticsConvInFarmerInbox.lastMessage?.text}"`);

    // Farmer replies to Logistics
    const p2 = new Promise((resolve) => {
      logSocket.on('logistics_new_message', (msg) => {
        if (msg.text.includes('Gate #2 is open')) {
          console.log(`✅ Logistics partner received Farmer reply via socket: "${msg.text}"`);
          resolve(msg);
        }
      });
    });

    farmerSocket.emit('send_message', {
      transactionId: txId,
      otherUserId: logistics._id,
      text: 'Acknowledged! Gate #2 is open and produce is packed.',
    });

    await p2;

    // 6. Logistics messages Buyer
    console.log('\n[Test 5] Logistics messages Buyer:');
    const p3 = new Promise((resolve) => {
      buyerSocket.on('new_message', (msg) => {
        if (msg.text.includes('ETA at your warehouse')) {
          console.log(`✅ Buyer received real-time socket message: "${msg.text}" from ${msg.senderName}`);
          resolve(msg);
        }
      });
    });

    logSocket.emit('logistics_send_message', {
      transactionId: txId,
      otherUserId: buyer._id,
      text: 'Hello Buyer, ETA at your warehouse is tomorrow 4 PM.',
    });

    await p3;

    // Refresh Persistence for Buyer
    const buyerInboxRes = await fetch(`${BASE_URL}/api/chat/inbox/all`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const buyerInbox = await buyerInboxRes.json();
    const logisticsConvInBuyerInbox = buyerInbox.find((c) => c.type === 'buyer_logistics' && String(c.transaction?._id) === String(txId));
    if (!logisticsConvInBuyerInbox) throw new Error('Buyer inbox did not contain the logistics conversation upon refresh');
    console.log(`✅ Buyer inbox on refresh contains logistics conversation with lastMessage: "${logisticsConvInBuyerInbox.lastMessage?.text}"`);

    // 7. Verify Order tracking for Buyer: GET /api/orders/my
    console.log('\n[Test 6] Buyer Order Tracking:');
    const ordersRes = await fetch(`${BASE_URL}/api/orders/my`, {
      headers: { Authorization: `Bearer ${buyerToken}` },
    });
    const orders = await ordersRes.json();
    const myOrder = orders.find((o) => String(o._id) === String(txId));
    if (!myOrder) throw new Error('Confirmed transaction did not appear in buyer GET /api/orders/my');
    console.log(`✅ Buyer order tracking shows live order: ${myOrder.transaction_id} (${myOrder.crop}, ₹${myOrder.finalPrice}/qtl, status: ${myOrder.status})`);

    logSocket.disconnect();
    farmerSocket.disconnect();
    buyerSocket.disconnect();

    console.log('\n🎉 ALL FRONTEND END-TO-END FLOW TESTS COMPLETED WITH 100% SUCCESS!');
  } finally {
    server.close();
    await mongoose.connection.close();
  }
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
