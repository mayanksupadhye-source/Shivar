const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  listing_id: {
    type: String,
    trim: true,
    uppercase: true,
  },
  
  // Internal MongoDB ObjectId reference to farmer
  farmer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // External Business Identifier of farmer (e.g. F0001) for fast reporting
  farmer_id: {
    type: String,
    trim: true,
    uppercase: true,
  },

  crop: { type: String, required: true, trim: true, index: true },
  variety: { type: String, trim: true },
  
  // Quantities and prices
  quantity_tonnes: { type: Number, required: true },
  price_per_quintal: { type: Number, required: true },
  
  description: { type: String, trim: true },
  harvest_date: { type: Date },
  listed_at: { type: Date, default: Date.now, index: true },

  // Geographic hierarchy
  cluster: { type: String, trim: true },
  district: { type: String, trim: true, index: true },
  taluka: { type: String, trim: true },
  village: { type: String, trim: true },

  status: {
    type: String,
    enum: ['available', 'pending', 'sold', 'withdrawn'],
    default: 'available',
    index: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Sparse unique index on business listing_id
listingSchema.index({ listing_id: 1 }, { unique: true, sparse: true });

// Compound index for browsing and filtering
listingSchema.index({ crop: 1, district: 1, status: 1 });
listingSchema.index({ cluster: 1, status: 1 });

// Compatibility Virtuals for Frontend
listingSchema.virtual('quantity').get(function () {
  return this.quantity_tonnes;
});
listingSchema.virtual('pricePerUnit').get(function () {
  return this.price_per_quintal;
});
listingSchema.virtual('unit').get(function () {
  return 'tonne';
});

module.exports = mongoose.model('Listing', listingSchema);
