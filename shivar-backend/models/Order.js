const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  bid: { type: mongoose.Schema.Types.ObjectId, ref: 'Bid' },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  finalPrice: { type: Number, required: true },
  quantity: { type: Number, required: true },
  status: { type: String, enum: ['confirmed', 'shipped', 'completed', 'cancelled'], default: 'confirmed' },
  feedbackGiven: { type: Boolean, default: false },
receivedAt:    { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
