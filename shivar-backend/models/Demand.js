const mongoose = require('mongoose');

const demandSchema = new mongoose.Schema({
  demand_id: {
    type: String,
    trim: true,
    uppercase: true,
  },

  // Internal MongoDB ObjectId reference to buyer
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // External Business Identifier of buyer (e.g. B0001)
  buyer_id: {
    type: String,
    trim: true,
    uppercase: true,
  },

  crop: { type: String, required: true, trim: true, index: true },
  variety: { type: String, trim: true },

  required_quantity_tons: { type: Number, required: true },
  maximum_price_per_quintal: { type: Number, required: true },

  description: { type: String, trim: true },
  demand_date: { type: Date, default: Date.now, index: true },
  required_by_date: { type: Date },

  // Geographic hierarchy
  cluster: { type: String, trim: true },
  district: { type: String, trim: true, index: true },
  taluka: { type: String, trim: true },
  village: { type: String, trim: true },

  status: {
    type: String,
    enum: ['open', 'fulfilled', 'cancelled'],
    default: 'open',
    index: true,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Sparse unique index on business demand_id
demandSchema.index({ demand_id: 1 }, { unique: true, sparse: true });

// Compound indexes for farmer search & matching
demandSchema.index({ crop: 1, district: 1, status: 1 });
demandSchema.index({ cluster: 1, status: 1 });

// Compatibility Virtuals
demandSchema.virtual('quantity').get(function () {
  return this.required_quantity_tons;
});
demandSchema.virtual('maxPrice').get(function () {
  return this.maximum_price_per_quintal;
});

module.exports = mongoose.model('Demand', demandSchema);
