const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // Relational link to the conversation document
  conversation: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true,
  },

  // Legacy string conversationId kept for backward compatibility with frontend
  conversationId: {
    type: String,
    index: true,
  },

  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  receiver: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  text: {
    type: String,
    required: true,
    trim: true,
  },

  readAt: {
    type: Date,
    default: null,
  },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Index for chronological message retrieval within a conversation
messageSchema.index({ conversation: 1, createdAt: 1 });
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
