const mongoose = require('mongoose');

// This is NOT a new collection — it's a read-only Mongoose window onto the
// existing `transactions` collection (already populated from transaction.csv,
// ~3,000 rows). Field names mirror the CSV header exactly. We never write
// through this model; it exists purely so the logistics routes can query
// with Mongoose instead of the raw driver.
//
// Assumption: since transaction.csv doesn't show how transaction_id/listing_id/
// farmer_id/buyer_id were imported (as strings like "TR0001"/"L5084" vs as
// ObjectId refs), this schema treats them as plain strings, matching the CSV
// verbatim. If your import instead cast these to ObjectIds referencing
// Listing/User, swap the `String` types below for
// `mongoose.Schema.Types.ObjectId` — everything else in this feature works
// unchanged either way since we only ever read and display these fields.
const transactionSchema = new mongoose.Schema({
  transaction_id: { type: String, required: true },
  listing_id: { type: String },
  farmer_id: { type: String },
  buyer_id: { type: String },
  crop: { type: String },
  variety: { type: String },
  quantity_tons: { type: Number },
  agreed_price_per_quintal: { type: Number },
  transaction_date: { type: Date },
  pickup_location: { type: String },
  delivery_location: { type: String },
}, {
  collection: 'transactions', // explicit — do not let Mongoose pluralize/rename
  strict: false, // tolerate any extra columns already present in the collection
  timestamps: false,
});

transactionSchema.index({ crop: 1, transaction_date: -1 });

module.exports = mongoose.model('TransactionReadOnly', transactionSchema);
