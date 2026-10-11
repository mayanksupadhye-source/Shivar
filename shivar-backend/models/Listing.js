const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  crop: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true },
  unit: { type: String, default: 'quintal' },
  pricePerUnit: { type: Number, required: true },
  soilType: { type: String },
  region: { type: String },
  district: { type: String },
  description: { type: String },
  status: { type: String, enum: ['available', 'sold', 'withdrawn'], default: 'available' },
}, { timestamps: true });

listingSchema.index({ crop: 1, district: 1, status: 1 });

module.exports = mongoose.model('Listing', listingSchema);
