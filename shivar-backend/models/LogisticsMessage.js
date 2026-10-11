const mongoose = require('mongoose');

const logisticsMessageSchema = new mongoose.Schema({
  // conversationId groups all messages between a logistics partner and a
  // farmer or buyer about one transaction.
  // Convention: `${transactionId}_${smallerUserId}_${largerUserId}`
  // (built in utils/logisticsChatUtils.js — mirrors chatUtils.js exactly,
  // just swaps listingId for transactionId).
  conversationId: { type: String, required: true, index: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },

  // sender/receiver can each be either a LogisticsPartner or a farmer/buyer
  // (existing User). We store the role alongside the id since the two
  // sides live in different collections and a plain ref can't span both.
  sender: { type: mongoose.Schema.Types.ObjectId, required: true },
  senderRole: { type: String, enum: ['logistics', 'farmer', 'buyer'], required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, required: true },
  receiverRole: { type: String, enum: ['logistics', 'farmer', 'buyer'], required: true },

  text: { type: String, required: true },
  readAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('LogisticsMessage', logisticsMessageSchema);
