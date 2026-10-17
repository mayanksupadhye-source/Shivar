require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const assert = require('assert');
const http = require('http');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const connectDB = require('../config/db');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Bid = require('../models/Bid');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Feedback = require('../models/Feedback');
const H = require('../config/honour');

const authRoutes = require('../routes/auth');
const listingRoutes = require('../routes/listings');
const bidRoutes = require('../routes/bids');
const orderRoutes = require('../routes/orders');
const qualityRoutes = require('../routes/quality.routes');

const PORT = 5088;
const BASE_URL = `http://localhost:${PORT}`;

function makeToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      name: user.name,
      mobile: user.mobile,
      marketplaceId: user.marketplaceId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: '1d' }
  );
}

async function api(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function run() {
  console.log('\n🧪 Testing Honour Score, Blacklisting & AI Quality Integration\n' + '═'.repeat(60));
  await connectDB();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.use('/api/auth', authRoutes);
  app.use('/api/listings', listingRoutes);
  app.use('/api/bids', bidRoutes);
  app.use('/api/orders', orderRoutes);
  app.use('/api/quality', qualityRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));

  try {
    // 1. Create unique test users
    const ts = Date.now();
    const testFarmerMobile = `98${Math.floor(10000000 + Math.random() * 89999999)}`;
    const testBuyerMobile = `97${Math.floor(10000000 + Math.random() * 89999999)}`;

    const farmer = await User.create({
      name: `Test Farmer ${ts}`,
      mobile: testFarmerMobile,
      email: `farmer_${ts}@shivar.test`,
      passwordHash: 'dummy_hash',
      role: 'farmer',
      isVerified: true,
      honourScore: 50,
      reviewedOrders: 0,
      isBlacklisted: false,
    });

    const buyer = await User.create({
      name: `Test Buyer ${ts}`,
      mobile: testBuyerMobile,
      email: `buyer_${ts}@shivar.test`,
      passwordHash: 'dummy_hash',
      role: 'buyer',
      isVerified: true,
    });

    const farmerToken = makeToken(farmer);
    const buyerToken = makeToken(buyer);

    console.log('✅ Created test farmer and buyer accounts');

    // 2. Farmer creates listing
    const createListingRes = await api('/api/listings', {
      method: 'POST',
      token: farmerToken,
      body: {
        crop: 'Honour Wheat',
        variety: 'Sharbati',
        quantity: 10,
        pricePerUnit: 3200,
      },
    });
    assert.strictEqual(createListingRes.status, 201, 'Farmer should create listing');
    const listingId = createListingRes.data._id;
    console.log('✅ Farmer successfully created listing:', createListingRes.data.crop);

    // 3. Buyer places bid
    const placeBidRes = await api('/api/bids', {
      method: 'POST',
      token: buyerToken,
      body: {
        listingId,
        offerPrice: 3100,
        quantity: 5,
        message: 'Interested in bulk pickup',
      },
    });
    assert.strictEqual(placeBidRes.status, 201, 'Buyer should place bid');
    const bidId = placeBidRes.data._id;
    console.log('✅ Buyer placed bid successfully');

    // 4. Farmer accepts bid -> creates Transaction and Order
    const acceptBidRes = await api(`/api/bids/${bidId}/accept`, {
      method: 'PUT',
      token: farmerToken,
    });
    assert.strictEqual(acceptBidRes.status, 200, 'Farmer should accept bid');
    assert.ok(acceptBidRes.data.transaction, 'Transaction should be created');
    assert.ok(acceptBidRes.data.order, 'Order should be created');
    const orderId = acceptBidRes.data.order._id;
    console.log('✅ Farmer accepted bid: Transaction and Order created concurrently');

    // 5. Buyer fetches orders
    const myOrdersRes = await api('/api/orders/my', { token: buyerToken });
    assert.strictEqual(myOrdersRes.status, 200);
    const foundOrder = myOrdersRes.data.find((o) => String(o._id) === String(orderId));
    assert.ok(foundOrder, 'Order should be found in buyer orders list');
    console.log('✅ Buyer retrieves order via /api/orders/my');

    // 6. Buyer submits compulsory feedback
    // First test invalid rating:
    const invalidFb = await api(`/api/orders/${orderId}/received`, {
      method: 'PUT',
      token: buyerToken,
      body: { quality: 6, packaging: 5, honesty: 5 }, // 6 is out of range
    });
    assert.strictEqual(invalidFb.status, 400, 'Invalid rating should return 400');
    console.log('✅ Server rejects rating > 5 with 400');

    // Submit poor rating 1, 1, 1:
    const fbRes1 = await api(`/api/orders/${orderId}/received`, {
      method: 'PUT',
      token: buyerToken,
      body: { quality: 1, packaging: 1, honesty: 1 },
    });
    assert.strictEqual(fbRes1.status, 200, 'Valid feedback should be accepted');
    assert.strictEqual(fbRes1.data.honourScore, 38, 'Score 50 with 1-star avg drops to 38');
    console.log('✅ Buyer submitted feedback: Farmer score dropped to', fbRes1.data.honourScore);

    // Double submission check
    const doubleFb = await api(`/api/orders/${orderId}/received`, {
      method: 'PUT',
      token: buyerToken,
      body: { quality: 5, packaging: 5, honesty: 5 },
    });
    assert.strictEqual(doubleFb.status, 400, 'Double feedback submission must be rejected');
    console.log('✅ Double feedback submission correctly blocked');

    // 7. Verify farmer's /api/orders/honour/me endpoint
    const honourMeRes = await api('/api/orders/honour/me', { token: farmerToken });
    assert.strictEqual(honourMeRes.status, 200);
    assert.strictEqual(honourMeRes.data.honourScore, 38);
    assert.strictEqual(honourMeRes.data.reviewedOrders, 1);
    assert.strictEqual(honourMeRes.data.isBlacklisted, false, 'Not blacklisted yet (< 3 reviews)');
    console.log('✅ /api/orders/honour/me returns live score and review count');

    // 8. Test Blacklisting threshold:
    // Directly set reviewedOrders = 2, score = 38 on farmer, then submit a 2nd low rating to trigger blacklisting
    await User.findByIdAndUpdate(farmer._id, { reviewedOrders: 2, honourScore: 38 });
    
    // Create an order directly for this test
    const dummyOrder = await Order.create({
      listing: listingId,
      bid: bidId,
      buyer: buyer._id,
      farmer: farmer._id,
      finalPrice: 3000,
      quantity: 2,
      status: 'confirmed',
    });

    const triggerBlacklist = await api(`/api/orders/${dummyOrder._id}/received`, {
      method: 'PUT',
      token: buyerToken,
      body: { quality: 1, packaging: 1, honesty: 1 },
    });
    assert.strictEqual(triggerBlacklist.status, 200);
    
    const updatedFarmer = await User.findById(farmer._id);
    assert.strictEqual(updatedFarmer.isBlacklisted, true, 'Farmer should now be blacklisted');
    console.log('✅ Farmer reached score < 40 with >= 3 reviews and is now blacklisted: isBlacklisted = true');

    // 9. Blacklisted farmer restrictions:
    // A. Cannot create listing
    const blockedListing = await api('/api/listings', {
      method: 'POST',
      token: farmerToken,
      body: { crop: 'Blocked Cotton', quantity: 10, pricePerUnit: 6000 },
    });
    assert.strictEqual(blockedListing.status, 403, 'Blacklisted farmer cannot create listings');
    console.log('✅ Blacklisted farmer blocked from creating listings (403)');

    // B. Public browse hides blacklisted farmer's listings
    const browseRes = await api('/api/listings');
    assert.strictEqual(browseRes.status, 200);
    const hasBlocked = browseRes.data.some((l) => String(l.farmer?._id || l.farmer) === String(farmer._id));
    assert.strictEqual(hasBlocked, false, 'Public listings browse hides blacklisted farmer listings');
    console.log('✅ Public listings browse hides blacklisted farmer produce');

    // 10. AI Quality route verification
    const qualityNoFileRes = await api('/api/quality/analyze', {
      method: 'POST',
      body: { cropType: 'Wheat' },
    });
    assert.strictEqual(qualityNoFileRes.status, 400, 'Quality analysis without photo returns 400');
    console.log('✅ AI Quality route properly validates missing photos with 400');

    console.log('\n🎉 ALL HONOUR SCORE, BLACKLISTING & AI QUALITY TESTS PASSED 100%!\n');

    // Cleanup test docs
    await Promise.all([
      User.deleteMany({ _id: { $in: [farmer._id, buyer._id] } }),
      Listing.deleteMany({ _id: listingId }),
      Bid.deleteMany({ _id: bidId }),
      Order.deleteMany({ _id: { $in: [orderId, dummyOrder._id] } }),
      Transaction.deleteMany({ _id: acceptBidRes.data.transaction._id }),
      Feedback.deleteMany({ farmer: farmer._id }),
    ]);

  } finally {
    server.close();
  }
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
