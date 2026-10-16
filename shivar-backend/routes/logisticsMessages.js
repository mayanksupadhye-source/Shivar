const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveUserId } = require('../utils/identity');
const { buildLogisticsConversationId } = require('../utils/logisticsChatUtils');

const router = express.Router();
router.use(requireAuth, requireRole('logistics'));

// GET /api/logistics/messages/:transactionId/:otherUserId
router.get('/:transactionId/:otherUserId', async (req, res) => {
  try {
    const { transactionId: rawTxId, otherUserId: rawOtherId } = req.params;
    const partnerId = req.user.id;

    const otherId = await resolveUserId(rawOtherId);
    if (!otherId) {
      return res.status(404).json({ error: `User "${rawOtherId}" not found` });
    }

    // Resolve transaction
    let transaction = null;
    if (mongoose.Types.ObjectId.isValid(rawTxId)) {
      transaction = await Transaction.findById(rawTxId);
    }
    if (!transaction) {
      transaction = await Transaction.findOne({ transaction_id: String(rawTxId).toUpperCase() });
    }

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    const otherUser = await User.findById(otherId);
    const convType = otherUser?.role === 'farmer' ? 'farmer_logistics' : 'buyer_logistics';

    // Get or create unified conversation
    let conv = await Conversation.findOne({
      transaction: transaction._id,
      participants: { $all: [partnerId, otherId] },
    });

    if (!conv) {
      conv = await Conversation.create({
        type: convType,
        transaction: transaction._id,
        listing: transaction.listing,
        participants: [partnerId, otherId],
        lastMessage: {
          text: 'Logistics chat opened',
          sender: partnerId,
          createdAt: new Date(),
        },
      });
    }

    const legacyConvId = buildLogisticsConversationId(rawTxId, partnerId, otherId);

    const messages = await Message.find({
      $or: [
        { conversation: conv._id },
        { conversationId: legacyConvId },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    res.json({ conversationId: String(conv._id), legacyConversationId: legacyConvId, messages });
  } catch (err) {
    res.status(500).json({ error: 'Could not load messages', detail: err.message });
  }
});

module.exports = router;