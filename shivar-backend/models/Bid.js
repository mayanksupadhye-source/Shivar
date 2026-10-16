const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  farmer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  offerPrice: { type: Number, required: true },
  quantity: { type: Number, required: true },
  message: { type: String, trim: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
    index: true,
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null,
  },
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

bidSchema.index({ farmer: 1, status: 1 });
bidSchema.index({ buyer: 1, status: 1 });

module.exports = mongoose.model('Bid', bidSchema);
