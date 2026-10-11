require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { parse } = require("csv-parse/sync");

const User = require("./models/User");
const Listing = require("./models/Listing");

const MOBILE_RE = /^[6-9]\d{9}$/;

function readCsv(filename) {
  const filePath = path.join(__dirname, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`(No ${filename} found — skipping that part.)`);
    return [];
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  return parse(raw, { columns: true, skip_empty_lines: true, trim: true });
}

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log("Connected to MongoDB.\n");

  const farmerRows = readCsv("farmers.csv");
  const buyerRows = readCsv("buyers.csv");
  const listingRows = readCsv("listings.csv");

  const farmerIdByMobile = {};
  let farmersAdded = 0,
    farmersSkipped = 0;

  for (const [i, row] of farmerRows.entries()) {
    const lineNum = i + 2;
    if (
      !row.name ||
      !row.mobile ||
      !row.email ||
      !row.password ||
      !row.district
    ) {
      console.warn(
        `⚠️  farmers.csv line ${lineNum}: missing a required field — skipped.`,
      );
      farmersSkipped++;
      continue;
    }
    if (!MOBILE_RE.test(row.mobile)) {
      console.warn(
        `⚠️  farmers.csv line ${lineNum}: "${row.mobile}" isn't a valid mobile — skipped.`,
      );
      farmersSkipped++;
      continue;
    }
    try {
      const existing = await User.findOne({
        $or: [{ mobile: row.mobile }, { email: row.email }],
      });
      if (existing) {
        farmerIdByMobile[row.mobile] = existing._id;
        farmersSkipped++;
        continue;
      }
      const passwordHash = await bcrypt.hash(row.password, 10);
      const user = await User.create({
        name: row.name,
        mobile: row.mobile,
        email: row.email,
        passwordHash,
        role: "farmer",
        district: row.district,
        isVerified: true,
      });
      farmerIdByMobile[row.mobile] = user._id;
      farmersAdded++;
    } catch (err) {
      console.warn(
        `⚠️  farmers.csv line ${lineNum}: ${err.message} — skipped.`,
      );
      farmersSkipped++;
    }
  }

  let buyersAdded = 0,
    buyersSkipped = 0;
  for (const [i, row] of buyerRows.entries()) {
    const lineNum = i + 2;
    if (
      !row.name ||
      !row.mobile ||
      !row.email ||
      !row.password ||
      !row.district
    ) {
      console.warn(
        `⚠️  buyers.csv line ${lineNum}: missing a required field — skipped.`,
      );
      buyersSkipped++;
      continue;
    }
    if (!MOBILE_RE.test(row.mobile)) {
      console.warn(
        `⚠️  buyers.csv line ${lineNum}: "${row.mobile}" isn't a valid mobile — skipped.`,
      );
      buyersSkipped++;
      continue;
    }
    try {
      const existing = await User.findOne({
        $or: [{ mobile: row.mobile }, { email: row.email }],
      });
      if (existing) {
        buyersSkipped++;
        continue;
      }
      const passwordHash = await bcrypt.hash(row.password, 10);
      await User.create({
        name: row.name,
        mobile: row.mobile,
        email: row.email,
        passwordHash,
        role: "buyer",
        district: row.district,
        companyName: row.companyName || "",
        isVerified: true,
      });
      buyersAdded++;
    } catch (err) {
      console.warn(`⚠️  buyers.csv line ${lineNum}: ${err.message} — skipped.`);
      buyersSkipped++;
    }
  }

  let listingsAdded = 0,
    listingsSkipped = 0;
  for (const [i, row] of listingRows.entries()) {
    const lineNum = i + 2;
    const farmerId = farmerIdByMobile[row.farmerMobile];
    if (!farmerId) {
      console.warn(
        `⚠️  listings.csv line ${lineNum}: no farmer found with mobile "${row.farmerMobile}" — skipped.`,
      );
      listingsSkipped++;
      continue;
    }
    if (!row.crop || !row.quantity || !row.pricePerUnit) {
      console.warn(
        `⚠️  listings.csv line ${lineNum}: missing crop/quantity/price — skipped.`,
      );
      listingsSkipped++;
      continue;
    }
    try {
      await Listing.create({
        farmer: farmerId,
        crop: row.crop,
        quantity: Number(row.quantity),
        unit: row.unit || "quintal",
        pricePerUnit: Number(row.pricePerUnit),
        soilType: row.soilType || "",
        region: row.region || "",
        district: row.district || "",
        description: row.description || "",
        status: "available",
      });
      listingsAdded++;
    } catch (err) {
      console.warn(
        `⚠️  listings.csv line ${lineNum}: ${err.message} — skipped.`,
      );
      listingsSkipped++;
    }
  }

  console.log("\n════════════════════════════════");
  console.log(
    `✅ Farmers added: ${farmersAdded}  (skipped/duplicate: ${farmersSkipped})`,
  );
  console.log(
    `✅ Buyers added:  ${buyersAdded}  (skipped/duplicate: ${buyersSkipped})`,
  );
  console.log(
    `✅ Listings added: ${listingsAdded}  (skipped: ${listingsSkipped})`,
  );
  console.log(
    `Total new entries: ${farmersAdded + buyersAdded + listingsAdded}`,
  );
  console.log("════════════════════════════════");

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
