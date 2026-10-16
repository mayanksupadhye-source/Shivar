const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['farmer_buyer', 'farmer_logistics', 'buyer_logistics'],
    required: true,
  },

  // Bridge transaction (for transaction-related conversations)
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null,
    index: true,
  },

  // Bridge listing (for pre-deal buyer/farmer inquiries)
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    default: null,
    index: true,
  },

  // All authorized participants in this thread (MongoDB User _ids)
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  }],

  // Cached summary for snappy inbox rendering
  lastMessage: {
    text: { type: String, default: '' },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now },
  },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Ensure only one conversation exists for a specific transaction and conversation type
conversationSchema.index(
  { transaction: 1, type: 1 },
  { unique: true, partialFilterExpression: { transaction: { $type: 'objectId' } } }
);

module.exports = mongoose.model('Conversation', conversationSchema);
