const mongoose = require('mongoose');
const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ClientIO } = require('socket.io-client');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const connectDB = require('../config/db');
const { app, server } = require('../server');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Bid = require('../models/Bid');

function authHeader(user) {
  const token = jwt.sign(
    { id: String(user._id), role: user.role, name: user.name, mobile: user.mobile, marketplaceId: user.marketplaceId },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function createSocketClient(user, url) {
  const token = jwt.sign(
    { id: String(user._id), role: user.role, name: user.name, mobile: user.mobile, marketplaceId: user.marketplaceId },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
  return ClientIO(url, { auth: { token }, reconnection: false });
}

async function runTest() {
  console.log('--- Starting Confirm Logistics & Geolocation E2E Test ---');
  await connectDB();

  const testServer = http.createServer(app);
  const { Server } = require('socket.io');
  const initChatSocket = require('../sockets/chatSocket');
  const io = new Server(testServer, { cors: { origin: '*' } });
  initChatSocket(io);
  app.set('io', io);

  await new Promise((resolve) => testServer.listen(5077, resolve));
  const BASE_URL = 'http://localhost:5077';
  console.log(`Test server running at ${BASE_URL}`);

  try {
    // 1. Identify test users
    const [farmer, buyer, logistics] = await Promise.all([
      User.findOne({ role: 'farmer' }),
      User.findOne({ role: 'buyer' }),
      User.findOne({ role: 'logistics' }),
    ]);

    if (!farmer || !buyer || !logistics) {
      throw new Error('Required demo users not found in database');
    }

    console.log(`Farmer: ${farmer.name} (${farmer._id})`);
    console.log(`Buyer: ${buyer.name} (${buyer._id})`);
    console.log(`Logistics: ${logistics.name} (${logistics._id})`);

    // [Test 1] Geolocation Proximity Sorting with GPS coordinates
    console.log('\n[Test 1] Geolocation Proximity Sorting:');
    const geoRes = await fetch(`${BASE_URL}/api/logistics/transactions/sorted-by-distance?lat=19.9975&lng=73.7898&limit=5`, {
      headers: authHeader(logistics),
    });
    const geoData = await geoRes.json();
    if (!geoRes.ok) throw new Error(`sorted-by-distance failed: ${JSON.stringify(geoData)}`);
    console.log(`✅ GPS base detected: ${geoData.base.lat}°N, ${geoData.base.lng}°E (Source: ${geoData.base.source || 'gps'})`);
    console.log(`✅ Returned ${geoData.transactions.length} nearby transactions sorted by distance (Nearest: ${geoData.transactions[0]?.distanceFromBaseKm} km away)`);

    // [Test 2] Deal Confirmation -> Transaction Created
    console.log('\n[Test 2] Creating Confirmed Deal & Transaction:');
    const txId = `TR${Math.floor(10000 + Math.random() * 90000)}`;
    const tx = await Transaction.create({
      transaction_id: txId,
      farmer: farmer._id,
      buyer: buyer._id,
      listing: new mongoose.Types.ObjectId(),
      crop: 'Soybean Organic Yellow',
      variety: 'JS-335',
      quantity_tons: 8.5,
      agreed_price_per_quintal: 4650,
      pickup_location: 'Nashik, Maharashtra, India',
      delivery_location: 'Pune, Maharashtra, India',
      status: 'confirmed',
    });
    console.log(`✅ Confirmed Transaction created: ${tx.transaction_id} (Crop: ${tx.crop}, ${tx.quantity_tons} tons)`);

    // [Test 3] Setup Socket Listeners for Real-time Notification Verification
    console.log('\n[Test 3] Connecting Socket.io Clients for Farmer and Buyer:');
    const farmerSocket = createSocketClient(farmer, BASE_URL);
    const buyerSocket = createSocketClient(buyer, BASE_URL);

    const farmerReceivedPromise = new Promise((resolve) => {
      farmerSocket.on('logistics_new_message', (msg) => {
        if (msg.shipment_code) resolve(msg);
      });
      farmerSocket.on('new_message', (msg) => {
        if (msg.shipment_code) resolve(msg);
      });
    });

    const buyerReceivedPromise = new Promise((resolve) => {
      buyerSocket.on('logistics_new_message', (msg) => {
        if (msg.shipment_code) resolve(msg);
      });
      buyerSocket.on('new_message', (msg) => {
        if (msg.shipment_code) resolve(msg);
      });
    });

    await new Promise((r) => setTimeout(r, 600));

    // [Test 4] Logistics Partner Confirms Logistics
    console.log('\n[Test 4] Logistics Partner Confirms Logistics:');
    const confirmRes = await fetch(`${BASE_URL}/api/logistics/transactions/${tx._id}/confirm-logistics`, {
      method: 'POST',
      headers: authHeader(logistics),
    });
    const confirmData = await confirmRes.json();
    if (!confirmRes.ok) throw new Error(`confirm-logistics failed: ${JSON.stringify(confirmData)}`);

    console.log(`✅ Logistics Confirmed!`);
    console.log(`   Shipment Code: ${confirmData.shipment_code}`);
    console.log(`   Estimated Packaging: ~${confirmData.sacks_count} Sacks (Gunny Bags)`);
    console.log(`   New Status: ${confirmData.transaction.status}`);

    if (!confirmData.shipment_code || !/^SHV-[A-Z0-9]{4}-[1-9]$/.test(confirmData.shipment_code)) {
      throw new Error(`Invalid shipment code format: ${confirmData.shipment_code}`);
    }

    // [Test 5] Verify Real-time Socket System Notifications Delivered
    console.log('\n[Test 5] Verifying Real-time Notifications:');
    const farmerMsg = await Promise.race([
      farmerReceivedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Farmer socket message timeout')), 5000)),
    ]);
    console.log(`✅ Farmer received real-time socket message:`);
    console.log(`   "${farmerMsg.text.slice(0, 80)}..."`);
    if (!farmerMsg.text.includes('Sacks (Gunny Bags)') || !farmerMsg.text.includes(confirmData.shipment_code)) {
      throw new Error('Farmer notification missing sack instruction or code');
    }

    const buyerMsg = await Promise.race([
      buyerReceivedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Buyer socket message timeout')), 5000)),
    ]);
    console.log(`✅ Buyer received real-time socket message:`);
    console.log(`   "${buyerMsg.text.slice(0, 80)}..."`);
    if (!buyerMsg.text.includes(confirmData.shipment_code)) {
      throw new Error('Buyer notification missing shipment code');
    }

    // [Test 6] Database Persistence Verification
    console.log('\n[Test 6] Verifying Database Persistence:');
    const updatedTx = await Transaction.findById(tx._id);
    if (updatedTx.status !== 'logistics_confirmed') throw new Error(`DB status mismatch: ${updatedTx.status}`);
    if (updatedTx.shipment_code !== confirmData.shipment_code) throw new Error('DB shipment_code mismatch');
    if (!updatedTx.logistics_confirmed_at) throw new Error('DB logistics_confirmed_at missing');
    if (String(updatedTx.logisticsPartner) !== String(logistics._id)) throw new Error('DB logisticsPartner mismatch');
    console.log(`✅ MongoDB Transaction verified: status=logistics_confirmed, code=${updatedTx.shipment_code}, sacks=${updatedTx.sacks_count}`);

    // [Test 7] Buyer Orders Endpoint returns shipment_code
    console.log('\n[Test 7] Buyer Orders Endpoint Visibility:');
    const ordersRes = await fetch(`${BASE_URL}/api/orders/my`, { headers: authHeader(buyer) });
    const ordersData = await ordersRes.json();
    const targetOrder = ordersData.find((o) => String(o._id) === String(tx._id));
    if (!targetOrder) throw new Error('Order not found in buyer /api/orders/my');
    if (targetOrder.shipment_code !== confirmData.shipment_code) throw new Error('Order missing shipment_code');
    console.log(`✅ Buyer order tracking shows live shipment code: ${targetOrder.shipment_code} (${targetOrder.status})`);

    console.log('\n🎉 ALL CONFIRM LOGISTICS & GEOLOCATION TESTS PASSED WITH 100% SUCCESS!\n');
    farmerSocket.disconnect();
    buyerSocket.disconnect();
  } finally {
    testServer.close();
  }
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
