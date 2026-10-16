require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { parse } = require('csv-parse/sync');

// Safety guardrails & connection
const connectDB = require('../config/db');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Demand = require('../models/Demand');
const Transaction = require('../models/Transaction');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Bid = require('../models/Bid');

const DEFAULT_CSV_DIR = 'C:\\Users\\mayan\\Downloads';

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    dryRun: false,
    clean: false,
    dir: DEFAULT_CSV_DIR,
    batchSize: 1000,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') options.dryRun = true;
    if (args[i] === '--clean') options.clean = true;
    if (args[i] === '--dir' && args[i + 1]) {
      options.dir = args[i + 1];
      i++;
    }
    if (args[i] === '--batch-size' && args[i + 1]) {
      options.batchSize = parseInt(args[i + 1], 10);
      i++;
    }
  }
  return options;
}

function loadCsv(dir, filename) {
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found at: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

// Cached password hashing to avoid re-hashing identical passwords 9,300 times
const passwordHashCache = new Map();
async function getCachedHash(plainText) {
  if (!passwordHashCache.has(plainText)) {
    const hash = await bcrypt.hash(plainText, 10);
    passwordHashCache.set(plainText, hash);
  }
  return passwordHashCache.get(plainText);
}

async function insertInChunks(Model, documents, batchSize, label) {
  const total = documents.length;
  console.log(`Inserting ${total} ${label} into MongoDB in batches of ${batchSize}...`);
  for (let i = 0; i < total; i += batchSize) {
    const chunk = documents.slice(i, i + batchSize);
    try {
      await Model.insertMany(chunk, { ordered: true });
    } catch (err) {
      console.error(`❌ Error inserting ${label} at offset ${i}:`);
      console.error('Error code:', err.code);
      console.error('Error message:', err.message);
      if (err.writeErrors && err.writeErrors.length > 0) {
        console.error('First write error:', JSON.stringify(err.writeErrors[0]));
      }
      if (err.keyPattern) console.error('Key pattern:', err.keyPattern);
      if (err.keyValue) console.error('Key value:', err.keyValue);
      throw err;
    }
    const percent = Math.min(100, Math.round(((i + chunk.length) / total) * 100));
    console.log(`  -> ${label}: inserted ${i + chunk.length}/${total} (${percent}%)`);
  }
}

async function run() {
  const options = parseArgs();
  console.log('====================================================');
  console.log('  SHIVAR CANONICAL MARKETPLACE CSV IMPORTER');
  console.log('====================================================');
  console.log(`Source directory : ${options.dir}`);
  console.log(`Mode             : ${options.dryRun ? 'DRY RUN (Validation only, no DB writes)' : 'LIVE IMPORT'}`);
  console.log(`Clean DB first   : ${options.clean ? 'YES' : 'NO'}`);
  console.log(`Batch size       : ${options.batchSize}`);
  console.log('----------------------------------------------------');

  const startTime = Date.now();

  // 1. Read CSV files
  console.log('Reading 5 CSV files from disk...');
  const farmerRows = loadCsv(options.dir, 'farmers.csv');
  const buyerRows = loadCsv(options.dir, 'buyers.csv');
  const listingRows = loadCsv(options.dir, 'listings.csv');
  const demandRows = loadCsv(options.dir, 'demand.csv');
  const transactionRows = loadCsv(options.dir, 'transaction.csv');

  console.log(`✓ farmers.csv      : ${farmerRows.length.toLocaleString()} rows`);
  console.log(`✓ buyers.csv       : ${buyerRows.length.toLocaleString()} rows`);
  console.log(`✓ listings.csv     : ${listingRows.length.toLocaleString()} rows`);
  console.log(`✓ demand.csv       : ${demandRows.length.toLocaleString()} rows`);
  console.log(`✓ transaction.csv  : ${transactionRows.length.toLocaleString()} rows`);

  // 2. Prepare Farmers
  console.log('\nValidating & preparing Farmers...');
  const farmerDocs = [];
  const farmerMap = new Map(); // farmer_id -> ObjectId
  const farmerMobileSet = new Set();
  const farmerEmailSet = new Set();

  for (const row of farmerRows) {
    const fid = row.farmer_id.trim();
    if (!fid) throw new Error(`Missing farmer_id in farmers.csv`);
    if (farmerMap.has(fid)) throw new Error(`Duplicate farmer_id ${fid} in farmers.csv`);

    const objectId = new mongoose.Types.ObjectId();
    farmerMap.set(fid, objectId);

    const plainPw = row.password ? row.password.trim() : 'farm123';
    const passwordHash = await getCachedHash(plainPw);

    farmerDocs.push({
      _id: objectId,
      name: row.name.trim(),
      mobile: row.mobile.trim(),
      email: row.email.trim().toLowerCase(),
      passwordHash,
      role: 'farmer',
      marketplaceId: fid,
      vibhagCluster: row.vibhag_cluster ? row.vibhag_cluster.trim() : '',
      district: row.district ? row.district.trim() : 'India',
      taluka: row.taluka ? row.taluka.trim() : '',
      village: row.village ? row.village.trim() : '',
      primaryCrop: row.primary_crop ? row.primary_crop.trim() : '',
      isVerified: true,
    });
    farmerMobileSet.add(row.mobile.trim());
    farmerEmailSet.add(row.email.trim().toLowerCase());
  }
  console.log(`✓ Prepared ${farmerDocs.length.toLocaleString()} farmer documents.`);

  // 3. Prepare Buyers
  console.log('Validating & preparing Buyers...');
  const buyerDocs = [];
  const buyerMap = new Map(); // buyer_id -> ObjectId
  let sharedMobileWithFarmers = 0;

  for (const row of buyerRows) {
    const bid = row.buyer_id.trim();
    if (!bid) throw new Error(`Missing buyer_id in buyers.csv`);
    if (buyerMap.has(bid)) throw new Error(`Duplicate buyer_id ${bid} in buyers.csv`);

    const objectId = new mongoose.Types.ObjectId();
    buyerMap.set(bid, objectId);

    const mobile = row.mobile.trim();
    if (farmerMobileSet.has(mobile)) {
      sharedMobileWithFarmers++;
    }

    const plainPw = row.password ? row.password.trim() : 'buyer123';
    const passwordHash = await getCachedHash(plainPw);

    buyerDocs.push({
      _id: objectId,
      name: (row.business_name || 'Buyer').trim(),
      companyName: (row.business_name || '').trim(),
      mobile,
      email: row.email.trim().toLowerCase(),
      passwordHash,
      role: 'buyer',
      marketplaceId: bid,
      vibhagCluster: row.vibhag_cluster ? row.vibhag_cluster.trim() : '',
      district: row.district ? row.district.trim() : 'India',
      taluka: row.taluka ? row.taluka.trim() : '',
      village: row.village ? row.village.trim() : '',
      primaryCrop: row.primary_crop ? row.primary_crop.trim() : '',
      isVerified: true,
    });
  }
  console.log(`✓ Prepared ${buyerDocs.length.toLocaleString()} buyer documents.`);
  console.log(`  (Note: Exactly ${sharedMobileWithFarmers} buyers share phone numbers with farmers — supported by { mobile: 1, role: 1 } compound index)`);

  // 4. Prepare Hero Logistics Partner for Live Operations & Testing
  const heroLogisticsPw = await getCachedHash('logistics123');
  const heroLogistics = {
    _id: new mongoose.Types.ObjectId(),
    name: 'Maharashtra State Agri Logistics',
    companyName: 'Maharashtra State Agri Logistics',
    mobile: '+919800000001',
    email: 'logistics@shivar.in',
    passwordHash: heroLogisticsPw,
    role: 'logistics',
    marketplaceId: 'L0001',
    district: 'Pune',
    vibhagCluster: 'Western Maharashtra (Desh)',
    baseLocation: 'Pune Hub',
    isVerified: true,
    vehicles: [
      { vehicleNumber: 'MH-12-AB-1234', vehicleType: 'medium_truck' },
      { vehicleNumber: 'MH-12-CD-5678', vehicleType: 'heavy_truck' },
    ],
  };
  console.log(`✓ Prepared default Logistics Partner: ${heroLogistics.name} (${heroLogistics.email})`);

  // 5. Prepare Listings
  console.log('\nValidating & preparing Listings...');
  const listingDocs = [];
  const listingMap = new Map(); // listing_id -> ObjectId
  let unlinkedListingFarmers = 0;

  for (const row of listingRows) {
    const lid = row.listing_id.trim();
    const fid = row.farmer_id.trim();
    const farmerObjectId = farmerMap.get(fid);

    if (!farmerObjectId) {
      unlinkedListingFarmers++;
      continue;
    }

    const objectId = new mongoose.Types.ObjectId();
    listingMap.set(lid, objectId);

    listingDocs.push({
      _id: objectId,
      listing_id: lid,
      farmer: farmerObjectId,
      farmer_id: fid,
      crop: row.crop.trim(),
      variety: row.variety ? row.variety.trim() : '',
      quantity_tonnes: parseFloat(row.quantity_tonnes) || 0,
      price_per_quintal: parseFloat(row.price_per_quintal) || 0,
      description: row.description ? row.description.trim() : '',
      harvest_date: row.harvest_date ? new Date(row.harvest_date) : null,
      listed_at: row.listed_at ? new Date(row.listed_at) : new Date(),
      cluster: row.cluster ? row.cluster.trim() : '',
      district: row.district ? row.district.trim() : '',
      taluka: row.taluka ? row.taluka.trim() : '',
      village: row.village ? row.village.trim() : '',
      status: 'available',
    });
  }
  console.log(`✓ Prepared ${listingDocs.length.toLocaleString()} listing documents (Unlinked farmers: ${unlinkedListingFarmers})`);

  // 6. Prepare Demands
  console.log('\nValidating & preparing Demands...');
  const demandDocs = [];
  let unlinkedDemandBuyers = 0;

  for (const row of demandRows) {
    const did = row.demand_id.trim();
    const bid = row.buyer_id.trim();
    const buyerObjectId = buyerMap.get(bid);

    if (!buyerObjectId) {
      unlinkedDemandBuyers++;
      continue;
    }

    const objectId = new mongoose.Types.ObjectId();

    demandDocs.push({
      _id: objectId,
      demand_id: did,
      buyer: buyerObjectId,
      buyer_id: bid,
      crop: row.crop.trim(),
      variety: row.variety ? row.variety.trim() : '',
      required_quantity_tons: parseFloat(row.required_quantity_tons) || 0,
      maximum_price_per_quintal: parseFloat(row.maximum_price_per_quintal) || 0,
      description: row.description ? row.description.trim() : '',
      demand_date: row.demand_date ? new Date(row.demand_date) : new Date(),
      required_by_date: row.required_by_date ? new Date(row.required_by_date) : null,
      cluster: row.cluster ? row.cluster.trim() : '',
      district: row.district ? row.district.trim() : '',
      taluka: row.taluka ? row.taluka.trim() : '',
      village: row.village ? row.village.trim() : '',
      status: 'open',
    });
  }
  console.log(`✓ Prepared ${demandDocs.length.toLocaleString()} demand documents (Unlinked buyers: ${unlinkedDemandBuyers})`);

  // 7. Prepare Transactions
  console.log('\nValidating & preparing Transactions...');
  const transactionDocs = [];
  let unlinkedTxListings = 0;
  let unlinkedTxFarmers = 0;
  let unlinkedTxBuyers = 0;

  for (const row of transactionRows) {
    const tid = row.transaction_id.trim();
    const lid = row.listing_id.trim();
    const fid = row.farmer_id.trim();
    const bid = row.buyer_id.trim();

    const listingObjectId = listingMap.get(lid);
    const farmerObjectId = farmerMap.get(fid);
    const buyerObjectId = buyerMap.get(bid);

    if (!listingObjectId) unlinkedTxListings++;
    if (!farmerObjectId) unlinkedTxFarmers++;
    if (!buyerObjectId) unlinkedTxBuyers++;

    if (!listingObjectId || !farmerObjectId || !buyerObjectId) {
      continue;
    }

    const objectId = new mongoose.Types.ObjectId();

    transactionDocs.push({
      _id: objectId,
      transaction_id: tid,
      listing: listingObjectId,
      listing_id: lid,
      farmer: farmerObjectId,
      farmer_id: fid,
      buyer: buyerObjectId,
      buyer_id: bid,
      logisticsPartner: null, // Open for logistics claiming
      crop: row.crop.trim(),
      variety: row.variety ? row.variety.trim() : '',
      quantity_tons: parseFloat(row.quantity_tons) || 0,
      agreed_price_per_quintal: parseFloat(row.agreed_price_per_quintal) || 0,
      transaction_date: row.transaction_date ? new Date(row.transaction_date) : new Date(),
      pickup_location: row.pickup_location.trim(),
      delivery_location: row.delivery_location.trim(),
      status: 'confirmed',
    });
  }
  console.log(`✓ Prepared ${transactionDocs.length.toLocaleString()} transaction documents`);
  console.log(`  Unlinked listings: ${unlinkedTxListings}`);
  console.log(`  Unlinked farmers : ${unlinkedTxFarmers}`);
  console.log(`  Unlinked buyers  : ${unlinkedTxBuyers}`);

  // Summary of Reference Check
  const totalUnresolved = unlinkedListingFarmers + unlinkedDemandBuyers + unlinkedTxListings + unlinkedTxFarmers + unlinkedTxBuyers;
  console.log('\n----------------------------------------------------');
  console.log(`FOREIGN KEY INTEGRITY CHECK:`);
  console.log(`Total unresolved foreign keys across all 5 CSVs: ${totalUnresolved}`);
  if (totalUnresolved === 0) {
    console.log('🎉 100% PERFECT RELATIONAL INTEGRITY ACROSS ALL DATASETS!');
  } else {
    console.warn('⚠️ Some records have unresolved references.');
  }
  console.log('----------------------------------------------------');

  if (options.dryRun) {
    console.log('\nDRY RUN COMPLETE. No data was written to MongoDB.');
    console.log(`Elapsed time: ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
    process.exit(0);
  }

  // 8. Connect to MongoDB Atlas
  console.log('\nConnecting to MongoDB Atlas (shivar_db)...');
  await connectDB();

  // 9. Clean if requested
  if (options.clean) {
    console.log('Cleaning existing marketplace data from shivar_db...');
    await Promise.all([
      User.deleteMany({}),
      Listing.deleteMany({}),
      Demand.deleteMany({}),
      Transaction.deleteMany({}),
      Conversation.deleteMany({}),
      Message.deleteMany({}),
      Bid.deleteMany({}),
    ]);
    console.log('✓ Cleared User, Listing, Demand, Transaction, Conversation, Message, Bid collections.');
  }

  // Synchronize schema indexes and purge any stale legacy indexes (e.g. mobile_1)
  console.log('Synchronizing schema indexes...');
  try {
    await mongoose.connection.db.collection('users').dropIndex('mobile_1');
    console.log('✓ Dropped obsolete single-field "mobile_1" index.');
  } catch (e) {
    // Index may not exist or already dropped
  }
  await Promise.all([
    User.syncIndexes(),
    Listing.syncIndexes(),
    Demand.syncIndexes(),
    Transaction.syncIndexes(),
  ]);
  console.log('✓ All collection indexes synchronized.');

  // 10. Execute Inserts
  console.log('\n--- Inserting into MongoDB Atlas ---');
  // Combine all users: Farmers + Buyers + Hero Logistics
  const allUserDocs = [...farmerDocs, ...buyerDocs, heroLogistics];
  await insertInChunks(User, allUserDocs, options.batchSize, 'Users');
  await insertInChunks(Listing, listingDocs, options.batchSize, 'Listings');
  await insertInChunks(Demand, demandDocs, options.batchSize, 'Demands');
  await insertInChunks(Transaction, transactionDocs, options.batchSize, 'Transactions');

  // Verify Counts in Database
  console.log('\n--- Verifying MongoDB Collection Counts ---');
  const [userCount, farmerCount, buyerCount, logisticsCount, listingCount, demandCount, txCount] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: 'farmer' }),
    User.countDocuments({ role: 'buyer' }),
    User.countDocuments({ role: 'logistics' }),
    Listing.countDocuments(),
    Demand.countDocuments(),
    Transaction.countDocuments(),
  ]);

  console.log(`Users in DB        : ${userCount.toLocaleString()} (Farmers: ${farmerCount.toLocaleString()}, Buyers: ${buyerCount.toLocaleString()}, Logistics: ${logisticsCount})`);
  console.log(`Listings in DB     : ${listingCount.toLocaleString()}`);
  console.log(`Demands in DB      : ${demandCount.toLocaleString()}`);
  console.log(`Transactions in DB : ${txCount.toLocaleString()}`);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('====================================================');
  console.log(`🎉 ALL 5 CSV DATASETS SUCCESSFULLY IMPORTED IN ${totalTime}s!`);
  console.log('====================================================');

  await mongoose.disconnect();
  console.log('Disconnected from MongoDB Atlas.');
}

run().catch((err) => {
  console.error('Fatal import error:', err);
  process.exit(1);
});
