require('dotenv').config();
const mongoose = require('mongoose');
const TransactionReadOnly = require('../models/TransactionReadOnly');
const LocationCache = require('../models/LocationCache');
const { geocodePlace } = require('../utils/geocode');

// Optional: run "node scripts/precacheLocations.js 50" to only do 50 places as a test
const LIMIT = parseInt(process.argv[2], 10) || 0;

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const all = (await TransactionReadOnly.distinct('pickup_location'))
    .map((p) => (p || '').trim())
    .filter(Boolean);

  const done = await LocationCache.find({ placeText: { $in: all } }).select('placeText').lean();
  const doneSet = new Set(done.map((d) => d.placeText));

  let todo = all.filter((p) => !doneSet.has(p));
  if (LIMIT) todo = todo.slice(0, LIMIT);

  console.log(`Unique pickup places: ${all.length}`);
  console.log(`Already saved: ${doneSet.size}`);
  console.log(`To look up now: ${todo.length}\n`);

  const failed = [];
  for (let i = 0; i < todo.length; i++) {
    try {
      await geocodePlace(todo[i]);
      console.log(`[${i + 1}/${todo.length}] OK     ${todo[i]}`);
    } catch (e) {
      failed.push(todo[i]);
      console.log(`[${i + 1}/${todo.length}] FAILED ${todo[i]}`);
    }
  }

  console.log(`\nFinished. Failed: ${failed.length}`);
  failed.forEach((f) => console.log(' -', f));

  await mongoose.disconnect();
})();