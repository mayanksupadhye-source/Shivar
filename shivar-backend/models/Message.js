const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  // conversationId groups all messages between two users about one listing
  // Convention: `${listingId}_${smallerUserId}_${largerUserId}`  (built in routes/sockets/chatUtils.js)
  conversationId: { type: String, required: true, index: true },
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true },
  readAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
