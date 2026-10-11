require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { faker } = require('@faker-js/faker');

const User = require('./models/User');
const Listing = require('./models/Listing');
const Bid = require('./models/Bid');
const Order = require('./models/Order');

const CROPS = ['Cotton', 'Wheat', 'Soybean', 'Onion', 'Sugarcane', 'Tomato', 'Grapes', 'Pomegranate'];
const DISTRICTS = ['Nashik', 'Pune', 'Nagpur', 'Aurangabad', 'Kolhapur', 'Solapur', 'Amravati'];
const SOILS = ['Black Cotton Soil', 'Loamy', 'Red Soil', 'Alluvial'];

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected. Clearing old data...');

  await Promise.all([
    User.deleteMany({}),
    Listing.deleteMany({}),
    Bid.deleteMany({}),
    Order.deleteMany({}),
  ]);

  // ── HAND-PICKED "HERO" USERS — use these live during your demo ──
  const heroFarmerPwd = await bcrypt.hash('farm123', 10);
  const heroBuyerPwd = await bcrypt.hash('buy123', 10);

  const heroFarmer = await User.create({
    name: 'Ramesh Patil', mobile: '9876543210', email: 'ramesh.farmer@nexora.in',
    passwordHash: heroFarmerPwd, role: 'farmer', district: 'Nashik', isVerified: true,
  });
  const heroBuyer = await User.create({
    name: 'Anjali Traders', mobile: '9876500000', email: 'buyer@nexora.in',
    passwordHash: heroBuyerPwd, role: 'buyer', district: 'Pune', isVerified: true,
  });

  console.log('Hero users created:', heroFarmer.mobile, heroBuyer.email);

  // ── BULK USERS: ~13 more (mix of farmers + buyers) ──
  const bulkUsers = [];
  const password = await bcrypt.hash('password123', 10);
  for (let i = 0; i < 13; i++) {
    const role = i % 3 === 0 ? 'buyer' : 'farmer';
    bulkUsers.push({
      name: faker.person.fullName(),
      mobile: '9' + faker.string.numeric(9),
      email: faker.internet.email().toLowerCase(),
      passwordHash: password,
      role,
      district: faker.helpers.arrayElement(DISTRICTS),
      isVerified: true,
    });
  }
  const createdBulkUsers = await User.insertMany(bulkUsers, { ordered: false }).catch(e => {
    // Duplicate mobile/email from faker collision — retry is overkill for a seed script, just log it
    console.warn('Some bulk users skipped due to collisions:', e.message);
    return User.find({ email: { $in: bulkUsers.map(u => u.email) } });
  });

  const allUsers = [heroFarmer, heroBuyer, ...createdBulkUsers];
  const farmers = allUsers.filter(u => u.role === 'farmer');
  const buyers = allUsers.filter(u => u.role === 'buyer');

  console.log(`Users: ${allUsers.length} (${farmers.length} farmers, ${buyers.length} buyers)`);

  // ── LISTINGS: 40, including a couple of hand-crafted ones for the hero farmer ──
  const listings = [];

  listings.push({
    farmer: heroFarmer._id, crop: 'Cotton', quantity: 50, unit: 'quintal',
    pricePerUnit: 6800, soilType: 'Black Cotton Soil', region: 'Malegaon', district: 'Nashik',
    description: 'Premium BT cotton, harvested this Kharif season. No pest damage.',
    status: 'available',
  });
  listings.push({
    farmer: heroFarmer._id, crop: 'Onion', quantity: 30, unit: 'quintal',
    pricePerUnit: 1800, soilType: 'Loamy', region: 'Lasalgaon', district: 'Nashik',
    description: 'Fresh red onion, well-stored, ready for immediate pickup.',
    status: 'available',
  });

  for (let i = 0; i < 38; i++) {
    listings.push({
      farmer: faker.helpers.arrayElement(farmers)._id,
      crop: faker.helpers.arrayElement(CROPS),
      quantity: faker.number.int({ min: 10, max: 100 }),
      unit: 'quintal',
      pricePerUnit: faker.number.int({ min: 1200, max: 9000 }),
      soilType: faker.helpers.arrayElement(SOILS),
      region: faker.location.city(),
      district: faker.helpers.arrayElement(DISTRICTS),
      description: faker.lorem.sentence(),
      status: faker.helpers.arrayElement(['available', 'available', 'available', 'sold']),
    });
  }

  const createdListings = await Listing.insertMany(listings);
  console.log(`Listings: ${createdListings.length}`);

  // ── BIDS: 30, on available listings ──
  const availableListings = createdListings.filter(l => l.status === 'available');
  const bids = [];
  for (let i = 0; i < 30; i++) {
    const listing = faker.helpers.arrayElement(availableListings);
    const buyer = faker.helpers.arrayElement(buyers);
    bids.push({
      listing: listing._id,
      buyer: buyer._id,
      farmer: listing.farmer,
      offerPrice: Math.round(listing.pricePerUnit * faker.number.float({ min: 0.85, max: 1.05, fractionDigits: 2 })),
      quantity: Math.min(listing.quantity, faker.number.int({ min: 5, max: listing.quantity })),
      message: faker.helpers.arrayElement([
        'Can you deliver to Pune market?', 'Interested, please confirm quality grade.',
        'Can we negotiate the price slightly?', 'Ready to finalize today.',
      ]),
      status: 'pending',
    });
  }
  const createdBids = await Bid.insertMany(bids);
  console.log(`Bids: ${createdBids.length}`);

  // ── ORDERS: 15, simulate some bids already accepted ──
  const orders = [];
  for (let i = 0; i < 15; i++) {
    const bid = createdBids[i];
    orders.push({
      listing: bid.listing, bid: bid._id, buyer: bid.buyer, farmer: bid.farmer,
      finalPrice: bid.offerPrice, quantity: bid.quantity,
      status: faker.helpers.arrayElement(['confirmed', 'shipped', 'completed']),
    });
  }
  const createdOrders = await Order.insertMany(orders);
  console.log(`Orders: ${createdOrders.length}`);

  const total = allUsers.length + createdListings.length + createdBids.length + createdOrders.length;
  console.log(`\n✅ Done. Total entries seeded: ${total}`);
  console.log(`\nDemo login — Farmer: 9876543210 / farm123`);
  console.log(`Demo login — Buyer: buyer@nexora.in / buy123`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
