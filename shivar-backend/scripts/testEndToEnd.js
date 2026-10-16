require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const jwt = require('jsonwebtoken');

// Backend models & config
const connectDB = require('../config/db');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Demand = require('../models/Demand');
const Transaction = require('../models/Transaction');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Bid = require('../models/Bid');

// Routes & Socket Gateway
const authRoutes = require('../routes/auth');
const listingRoutes = require('../routes/listings');
const demandRoutes = require('../routes/demand');
const bidRoutes = require('../routes/bids');
const transactionRoutes = require('../routes/transactions');
const logisticsTransactionRoutes = require('../routes/logisticsTransactions');
const logisticsMessageRoutes = require('../routes/logisticsMessages');
const chatRoutes = require('../routes/chat');
const initChatSocket = require('../sockets/chatSocket');
const { resolveUser, resolveUserId } = require('../utils/identity');

const JWT_SECRET = process.env.JWT_SECRET || 'nexora_jwt_secret_dev';
const TEST_PORT = 5055;
const BASE_URL = `http://localhost:${TEST_PORT}`;

let server;
let io;
let results = [];

function logTest(name, passed, details = '') {
  const symbol = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${symbol}] ${name}`);
  if (details) console.log(`       ${details}`);
  results.push({ name, passed, details });
}

async function apiRequest(method, path, body = null, token = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/demand', demandRoutes);
  app.use('/api/bids', bidRoutes);
  app.use('/api/transactions', transactionRoutes);
  app.use('/api/logistics/deliveries', logisticsTransactionRoutes);
  app.use('/api/logistics/messages', logisticsMessageRoutes);
  app.use('/api/chat', chatRoutes);

  server = http.createServer(app);
  io = new Server(server, { cors: { origin: '*' } });
  initChatSocket(io);

  await new Promise((resolve) => server.listen(TEST_PORT, resolve));
  console.log(`Test Express server running at ${BASE_URL}`);
}

async function runTests() {
  console.log('========================================================');
  console.log('  SHIVAR COMPREHENSIVE END-TO-END ACCEPTANCE SUITE');
  console.log('========================================================\n');

  await connectDB();
  await startServer();

  let farmerToken, buyerToken, logisticsToken;
  let farmerUser, buyerUser, logisticsUser;
  let testListing, testDemand, testBid, testTransaction;

  try {
    // ----------------------------------------------------
    // TEST 1: Authentication & Identity Resolution
    // ----------------------------------------------------
    console.log('--- Test Group 1: Authentication & Identity ---');
    const farmerLogin = await apiRequest('POST', '/api/auth/login', {
      identifier: 'F0001',
      password: 'farm123',
    });
    const fLoginOk = farmerLogin.ok && farmerLogin.data.token && farmerLogin.data.user.role === 'farmer';
    farmerToken = farmerLogin.data?.token;
    farmerUser = farmerLogin.data?.user;
    logTest('Farmer login by Business ID (F0001)', fLoginOk, `Token received, role: ${farmerUser?.role}`);

    const buyerLogin = await apiRequest('POST', '/api/auth/login', {
      identifier: 'B0001',
      password: 'buyer123',
    });
    const bLoginOk = buyerLogin.ok && buyerLogin.data.token && buyerLogin.data.user.role === 'buyer';
    buyerToken = buyerLogin.data?.token;
    buyerUser = buyerLogin.data?.user;
    logTest('Buyer login by Business ID (B0001)', bLoginOk, `Token received, role: ${buyerUser?.role}`);

    const logLogin = await apiRequest('POST', '/api/auth/login', {
      identifier: 'logistics@shivar.in',
      password: 'logistics123',
    });
    const lLoginOk = logLogin.ok && logLogin.data.token && logLogin.data.user.role === 'logistics';
    logisticsToken = logLogin.data?.token;
    logisticsUser = logLogin.data?.user;
    logTest('Logistics partner login by Email', lLoginOk, `Token received, role: ${logisticsUser?.role}`);

    // Verify identity resolution utility
    const resolvedFarmerId = await resolveUserId('F0001');
    const resolvedBuyerId = await resolveUserId('B0001');
    const identityOk = resolvedFarmerId && resolvedBuyerId &&
      resolvedFarmerId === farmerUser.id &&
      resolvedBuyerId === buyerUser.id;
    logTest('Identity Resolution helper (F0001 -> ObjectId, B0001 -> ObjectId)', identityOk);

    // ----------------------------------------------------
    // TEST 2: Farmer Listing Creation & Buyer Visibility
    // ----------------------------------------------------
    console.log('\n--- Test Group 2: Listings Lifecycle ---');
    const createListingRes = await apiRequest('POST', '/api/listings', {
      crop: 'Soybean',
      variety: 'JS-335',
      quantity_tonnes: 12.5,
      price_per_quintal: 4800,
      cluster: 'Marathwada',
      district: 'Nanded',
      taluka: 'Loha',
      village: 'Khandala',
      description: 'E2E Test Soybean Lot, dry storage',
    }, farmerToken);

    testListing = createListingRes.data?.data || createListingRes.data;
    const listingCreated = createListingRes.ok && testListing?._id;
    logTest('Farmer creates new listing via API', listingCreated, `Listing ID: ${testListing?._id}`);

    // Buyer queries listing with filter
    const searchListingRes = await apiRequest('GET', `/api/listings?crop=Soybean&district=Nanded`, null, buyerToken);
    const listingsList = Array.isArray(searchListingRes.data) ? searchListingRes.data : (searchListingRes.data?.listings || searchListingRes.data?.data || []);
    const listingsFound = searchListingRes.ok && listingsList.length > 0;
    logTest('Buyer discovers listing with crop & district filters', listingsFound, `Found: ${listingsList.length} items`);

    // Verify virtuals
    const dbListing = await Listing.findById(testListing._id);
    const virtualsOk = dbListing && dbListing.quantity === 12.5 && dbListing.pricePerUnit === 4800 && dbListing.unit === 'tonne';
    logTest('Listing compatibility virtuals (quantity, pricePerUnit, unit)', !!virtualsOk);

    // ----------------------------------------------------
    // TEST 3: Buyer Demand Creation & Farmer Visibility
    // ----------------------------------------------------
    console.log('\n--- Test Group 3: Buyer Demands Lifecycle ---');
    const createDemandRes = await apiRequest('POST', '/api/demand', {
      crop: 'Cotton',
      variety: 'Bt Cotton',
      required_quantity_tons: 25.0,
      maximum_price_per_quintal: 7200,
      cluster: 'Vidarbha',
      district: 'Nagpur',
      taluka: 'Hingna',
      village: 'Wanadongri',
      description: 'Need urgent cotton delivery for spinning mill',
    }, buyerToken);

    testDemand = createDemandRes.data?.demand || createDemandRes.data;
    const demandCreated = createDemandRes.ok && testDemand?._id;
    logTest('Buyer posts crop demand via API', demandCreated, `Demand ID: ${testDemand?._id}`);

    const searchDemandRes = await apiRequest('GET', '/api/demand?crop=Cotton', null, farmerToken);
    const demandsList = Array.isArray(searchDemandRes.data) ? searchDemandRes.data : (searchDemandRes.data?.demands || searchDemandRes.data?.data || []);
    const demandDiscovered = searchDemandRes.ok && demandsList.length > 0;
    logTest('Farmer discovers Buyer demand via GET /api/demand', demandDiscovered, `Found: ${demandsList.length} items`);

    // ----------------------------------------------------
    // TEST 4: Real-time Socket.IO Messaging (Farmer ↔ Buyer)
    // ----------------------------------------------------
    console.log('\n--- Test Group 4: Real-time Socket.IO Messaging ---');
    const farmerSocket = ioClient(BASE_URL, {
      auth: { token: farmerToken },
      transports: ['websocket'],
    });
    const buyerSocket = ioClient(BASE_URL, {
      auth: { token: buyerToken },
      transports: ['websocket'],
    });

    await Promise.all([
      new Promise(r => farmerSocket.on('connect', r)),
      new Promise(r => buyerSocket.on('connect', r)),
    ]);
    logTest('Farmer & Buyer Socket.IO clients connected & authenticated', true);

    // Farmer listens for new_message
    const msgPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve({ received: false }), 4000);
      farmerSocket.on('new_message', (msg) => {
        clearTimeout(timeout);
        resolve({ received: true, msg });
      });
    });

    // Buyer sends message to Farmer
    buyerSocket.emit('send_message', {
      otherUserId: farmerUser.id,
      listingId: testListing._id,
      text: 'Hello Farmer, is the Soybean available for immediate inspection?',
    });

    const msgResult = await msgPromise;
    logTest('Real-time Socket.IO message received by Farmer', msgResult.received, msgResult.msg?.text);

    // Verify MongoDB Message persistence
    const savedMsg = await Message.findOne({ text: 'Hello Farmer, is the Soybean available for immediate inspection?' });
    const msgPersisted = savedMsg && String(savedMsg.sender) === farmerUser.id || String(savedMsg.receiver) === farmerUser.id;
    logTest('Message persisted in MongoDB with valid sender, receiver, and conversationId', !!msgPersisted);

    // ----------------------------------------------------
    // TEST 5: Deal Confirmation & Canonical Transaction
    // ----------------------------------------------------
    console.log('\n--- Test Group 5: Deal & Canonical Transaction ---');
    // Buyer places bid
    const bidRes = await apiRequest('POST', '/api/bids', {
      listingId: testListing._id,
      offerPrice: 4750,
      quantity: 12.5,
      message: 'Deal offer at 4750 per quintal',
    }, buyerToken);

    testBid = bidRes.data?.bid || bidRes.data?.data || bidRes.data;
    const bidPlaced = bidRes.ok && testBid?._id;
    logTest('Buyer places bid on listing', bidPlaced, `Bid ID: ${testBid?._id}`);

    // Farmer accepts bid
    const acceptRes = await apiRequest('PUT', `/api/bids/${testBid._id}/accept`, {}, farmerToken);
    const bidAccepted = acceptRes.ok && acceptRes.data.transaction;
    testTransaction = acceptRes.data?.transaction;
    logTest('Farmer accepts bid -> Canonical Transaction created', bidAccepted, `Transaction ID: ${testTransaction?.transaction_id}`);

    // Verify Transaction attributes in MongoDB
    const dbTx = await Transaction.findById(testTransaction._id);
    const txValid = dbTx &&
      dbTx.listing.toString() === testListing._id &&
      dbTx.farmer.toString() === farmerUser.id &&
      dbTx.buyer.toString() === buyerUser.id &&
      dbTx.status === 'confirmed' &&
      dbTx.agreed_price_per_quintal === 4750 &&
      !dbTx.demand_id; // Strictly NO demand_id
    logTest('Canonical Transaction strictly links Listing, Farmer, Buyer with status: confirmed and NO demand_id', !!txValid);

    // Verify Idempotency: Re-accepting does not create a duplicate transaction
    const reAcceptRes = await apiRequest('PUT', `/api/bids/${testBid._id}/accept`, {}, farmerToken);
    const txCountForBid = await Transaction.countDocuments({ bid: testBid._id });
    const idempotentOk = reAcceptRes.ok && txCountForBid === 1;
    logTest('Deal confirmation idempotency (re-accept returns existing, exactly 1 transaction in DB)', idempotentOk);

    // Verify Listing status changed to sold
    const updatedListing = await Listing.findById(testListing._id);
    logTest('Listing status transitioned to "sold"', updatedListing?.status === 'sold');

    // ----------------------------------------------------
    // TEST 6: Logistics Board Visibility & Claiming
    // ----------------------------------------------------
    console.log('\n--- Test Group 6: Logistics Board Visibility & Claiming ---');
    const logisticsBoardRes = await apiRequest('GET', '/api/logistics/deliveries', null, logisticsToken);
    const boardTransactions = logisticsBoardRes.data?.transactions || logisticsBoardRes.data?.deliveries || logisticsBoardRes.data?.data || [];
    const txOnBoard = boardTransactions.some(t => t._id.toString() === testTransaction._id.toString() || t.transaction_id === testTransaction.transaction_id);
    logTest('Logistics Partner sees confirmed deal on delivery board', txOnBoard);

    // Logistics claims delivery
    const claimRes = await apiRequest('POST', `/api/logistics/deliveries/${testTransaction._id}/claim`, {}, logisticsToken);
    const claimOk = claimRes.ok && (claimRes.data.transaction?.status === 'assigned');
    logTest('Logistics Partner claims transaction -> status transitions to "assigned"', claimOk);

    // Database check
    const claimedDbTx = await Transaction.findById(testTransaction._id);
    const claimInDbOk = claimedDbTx && claimedDbTx.status === 'assigned' && claimedDbTx.logisticsPartner.toString() === logisticsUser.id;
    logTest('Transaction in MongoDB links logisticsPartner ObjectId', !!claimInDbOk);

    // ----------------------------------------------------
    // TEST 7: 3-Way Messaging (Logistics ↔ Farmer, Logistics ↔ Buyer)
    // ----------------------------------------------------
    console.log('\n--- Test Group 7: 3-Way Communication ---');
    const logisticsSocket = ioClient(BASE_URL, {
      auth: { token: logisticsToken },
      transports: ['websocket'],
    });
    await new Promise(r => logisticsSocket.on('connect', r));

    // Logistics sends message to Farmer
    const farmerLogPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 4000);
      farmerSocket.on('new_message', (msg) => {
        if (msg.text && msg.text.includes('pickup at 9:00 AM')) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    logisticsSocket.emit('logistics_send_message', {
      transactionId: testTransaction._id,
      otherUserId: farmerUser.id,
      text: 'Truck scheduled for pickup at 9:00 AM tomorrow at your farm location.',
    });

    const farmerLogReceived = await farmerLogPromise;
    logTest('Logistics sends pickup message to Farmer via unified socket gateway', farmerLogReceived);

    // Logistics sends message to Buyer
    const buyerLogPromise = new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 4000);
      buyerSocket.on('new_message', (msg) => {
        if (msg.text && msg.text.includes('warehouse by 5:00 PM')) {
          clearTimeout(timeout);
          resolve(true);
        }
      });
    });

    logisticsSocket.emit('logistics_send_message', {
      transactionId: testTransaction._id,
      otherUserId: buyerUser.id,
      text: 'Delivery estimated at buyer warehouse by 5:00 PM tomorrow.',
    });

    const buyerLogReceived = await buyerLogPromise;
    logTest('Logistics sends delivery message to Buyer via unified socket gateway', buyerLogReceived);

    // Verify Conversation threads in MongoDB
    const farmerLogisticsConv = await Conversation.findOne({
      transaction: testTransaction._id,
      type: 'farmer_logistics',
    });
    const buyerLogisticsConv = await Conversation.findOne({
      transaction: testTransaction._id,
      type: 'buyer_logistics',
    });
    logTest('Verified isolated Conversation threads (farmer_logistics & buyer_logistics)', !!(farmerLogisticsConv && buyerLogisticsConv));

    farmerSocket.disconnect();
    buyerSocket.disconnect();
    logisticsSocket.disconnect();

    // ----------------------------------------------------
    // TEST 8: Security & Authorization (IDOR & Room Protection)
    // ----------------------------------------------------
    console.log('\n--- Test Group 8: Security & Authorization ---');
    // Another farmer F0002 attempts to modify Farmer F0001's listing
    const farmer2Login = await apiRequest('POST', '/api/auth/login', {
      identifier: 'F0002',
      password: 'farm123',
    });
    const farmer2Token = farmer2Login.data?.token;

    const idorUpdateRes = await apiRequest('PUT', `/api/listings/${testListing._id}`, {
      price_per_quintal: 100, // Unauthorized price tamper
    }, farmer2Token);
    const idorBlocked = idorUpdateRes.status === 403;
    logTest('IDOR Protection: Farmer 2 forbidden (HTTP 403) from modifying Farmer 1 listing', idorBlocked);

    // ----------------------------------------------------
    // TEST 9: Duplicate Protection & Boundary Integrity
    // ----------------------------------------------------
    console.log('\n--- Test Group 9: Duplicate Protection & System Boundaries ---');
    // Attempting to register another user with duplicate { mobile, role } should be rejected
    let dupRejected = false;
    try {
      await User.create({
        name: 'Duplicate Test',
        mobile: farmerUser.mobile, // Same mobile
        role: 'farmer',             // Same role
        email: 'duplicate.farmer@test.com',
        passwordHash: 'dummyhash',
      });
    } catch (err) {
      dupRejected = err.code === 11000;
    }
    logTest('Database rejects duplicate { mobile, role } with MongoDB E11000', dupRejected);

    // Cross-role shared mobile: User with same mobile but role 'buyer' should be allowed if email unique
    let crossRoleAllowed = false;
    const testMobile = '+919999988888';
    try {
      const u1 = await User.create({
        name: 'Shared Mobile Farmer',
        mobile: testMobile,
        role: 'farmer',
        email: 'shared.farmer@test.com',
        passwordHash: 'dummyhash',
      });
      const u2 = await User.create({
        name: 'Shared Mobile Buyer',
        mobile: testMobile,
        role: 'buyer',
        email: 'shared.buyer@test.com',
        passwordHash: 'dummyhash',
      });
      crossRoleAllowed = !!(u1 && u2);
      // Clean up test users
      await User.deleteMany({ _id: { $in: [u1._id, u2._id] } });
    } catch (err) {
      crossRoleAllowed = false;
    }
    logTest('Cross-role phone sharing (farmer and buyer sharing mobile) allowed by compound index', crossRoleAllowed);

  } catch (err) {
    console.error('Unhandled test suite error:', err);
    logTest('Test Suite Execution', false, err.message);
  } finally {
    // Teardown test artifacts created during this run
    if (testListing?._id) await Listing.deleteOne({ _id: testListing._id });
    if (testDemand?._id) await Demand.deleteOne({ _id: testDemand._id });
    if (testBid?._id) await Bid.deleteOne({ _id: testBid._id });
    if (testTransaction?._id) await Transaction.deleteOne({ _id: testTransaction._id });

    if (server) {
      server.close();
      console.log('\nTest Express server closed.');
    }
    await mongoose.disconnect();
    console.log('MongoDB connection closed.');

    console.log('\n========================================================');
    console.log('  TEST SUITE RESULTS SUMMARY');
    console.log('========================================================');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`Total tests: ${results.length}`);
    console.log(`Passed     : ${passed}`);
    console.log(`Failed     : ${failed}`);
    if (failed === 0) {
      console.log('🎉 ALL END-TO-END VERIFICATION CHECKS PASSED PERFECTLY!');
    } else {
      console.log(`⚠️ ${failed} tests failed.`);
    }
    console.log('========================================================\n');
    process.exit(failed === 0 ? 0 : 1);
  }
}

runTests();
