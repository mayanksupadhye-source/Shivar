/**
 * SEED REAL DATA
 * Reads real-data.js and inserts it into MongoDB.
 * Unlike seed.js, this does NOT wipe existing data — it only adds to it.
 * Safe to run multiple times as you keep adding more entries to real-data.js,
 * though re-running will error on duplicate mobile/email — see note at the bottom.
 *
 * Run with: npm run seed:real
 */
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Listing = require('./models/Listing');

const { farmers, buyers, listings } = require('./real-data');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to MongoDB.\n');

  // ── INSERT FARMERS ──
  const farmerIdByMobile = {};
  let farmersAdded = 0;

  for (const f of farmers) {
    const existing = await User.findOne({ $or: [{ mobile: f.mobile }, { email: f.email }] });
    if (existing) {
      console.log(`Skipping farmer ${f.name} — mobile/email already exists in the database.`);
      farmerIdByMobile[f.mobile] = existing._id;
      continue;
    }
    const passwordHash = await bcrypt.hash(f.password, 10);
    const user = await User.create({
      name: f.name, mobile: f.mobile, email: f.email, passwordHash,
      role: 'farmer', district: f.district, isVerified: true,
    });
    farmerIdByMobile[f.mobile] = user._id;
    farmersAdded++;
    console.log(`Added farmer: ${f.name} (${f.district})`);
  }

  // ── INSERT BUYERS ──
  let buyersAdded = 0;
  for (const b of buyers) {
    const existing = await User.findOne({ $or: [{ mobile: b.mobile }, { email: b.email }] });
    if (existing) {
      console.log(`Skipping buyer ${b.name} — mobile/email already exists in the database.`);
      continue;
    }
    const passwordHash = await bcrypt.hash(b.password, 10);
    await User.create({
      name: b.name, mobile: b.mobile, email: b.email, passwordHash,
      role: 'buyer', district: b.district, companyName: b.companyName, isVerified: true,
    });
    buyersAdded++;
    console.log(`Added buyer: ${b.name}`);
  }

  // ── INSERT LISTINGS ──
  let listingsAdded = 0;
  let listingsSkipped = 0;

  for (const l of listings) {
    const farmerId = farmerIdByMobile[l.farmerMobile];
    if (!farmerId) {
      console.warn(`⚠️  Skipped listing "${l.crop}" — no farmer found with mobile ${l.farmerMobile}. Check for a typo.`);
      listingsSkipped++;
      continue;
    }
    await Listing.create({
      farmer: farmerId, crop: l.crop, quantity: l.quantity, unit: l.unit,
      pricePerUnit: l.pricePerUnit, soilType: l.soilType, region: l.region,
      district: l.district, description: l.description, status: 'available',
    });
    listingsAdded++;
  }

  console.log('\n──────────────────────────────');
  console.log(`✅ Farmers added: ${farmersAdded}`);
  console.log(`✅ Buyers added: ${buyersAdded}`);
  console.log(`✅ Listings added: ${listingsAdded}`);
  if (listingsSkipped) console.log(`⚠️  Listings skipped (bad farmerMobile): ${listingsSkipped}`);
  console.log(`Total new entries: ${farmersAdded + buyersAdded + listingsAdded}`);
  console.log('──────────────────────────────');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

/**
 * NOTE ON RE-RUNNING:
 * Farmers/buyers with a mobile or email that already exists get safely SKIPPED, not duplicated.
 * Listings currently always get added fresh — if you re-run this after only adding a few new
 * listings to real-data.js, the old ones will be inserted again as duplicates. Simplest fix:
 * only add NEW listings to the array between runs, or clear the Listing collection in Atlas
 * first if you want a clean re-import.
 */
