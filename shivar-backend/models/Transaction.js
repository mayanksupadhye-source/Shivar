const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  transaction_id: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    uppercase: true,
  },

  // Internal MongoDB references
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
    index: true,
  },
  listing_id: { type: String, trim: true },

  farmer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  farmer_id: { type: String, trim: true },

  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  buyer_id: { type: String, trim: true },

  // Assigned Logistics Partner (User with role='logistics')
  logisticsPartner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true,
  },
  logistics_id: { type: String, trim: true },

  crop: { type: String, required: true, trim: true },
  variety: { type: String, trim: true },
  quantity_tons: { type: Number, required: true },
  agreed_price_per_quintal: { type: Number, required: true },

  transaction_date: { type: Date, default: Date.now, index: true },
  pickup_location: { type: String, required: true, trim: true },
  delivery_location: { type: String, required: true, trim: true },

  status: {
    type: String,
    enum: ['pending', 'confirmed', 'logistics_confirmed', 'assigned', 'in_transit', 'delivered', 'completed', 'cancelled'],
    default: 'confirmed',
    index: true,
  },

  // Unique shipment/batch identification code (e.g. SHV-7B3-4)
  shipment_code: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    uppercase: true,
    index: true,
  },
  logistics_confirmed_at: {
    type: Date,
    default: null,
  },
  // Physical sacks/gunny bags count for traceability
  sacks_count: {
    type: Number,
    default: null,
  },

  // Linked bid (if originated from a marketplace bid)
  bid: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Bid',
    default: null,
  },

}, {
  collection: 'transactions',
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Indexes for logistics queries and dashboard views
transactionSchema.index({ crop: 1, transaction_date: -1 });
transactionSchema.index({ farmer: 1, status: 1 });
transactionSchema.index({ buyer: 1, status: 1 });
transactionSchema.index({ logisticsPartner: 1, status: 1 });

// Compatibility Virtuals
transactionSchema.virtual('finalPrice').get(function () {
  return this.agreed_price_per_quintal;
});
transactionSchema.virtual('quantity').get(function () {
  return this.quantity_tons;
});

module.exports = mongoose.model('Transaction', transactionSchema);
