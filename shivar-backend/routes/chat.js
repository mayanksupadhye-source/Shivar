const express = require('express');
const mongoose = require('mongoose');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { resolveUserId } = require('../utils/identity');
const { buildConversationId } = require('../utils/chatUtils');

const router = express.Router();

// ── GET unified inbox conversations for current user ──
router.get('/inbox/all', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const conversations = await Conversation.find({ participants: userId })
      .populate('participants', 'name role mobile marketplaceId district companyName')
      .populate('transaction', 'transaction_id crop agreed_price_per_quintal quantity_tons status pickup_location delivery_location')
      .populate('listing', 'listing_id crop price_per_quintal quantity_tonnes district')
      .sort({ updatedAt: -1 })
      .lean();

    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch inbox', detail: err.message });
  }
});

// ── GET or CREATE conversation and load message history ──
// Works for any context (listing or transaction) and handles both ObjectIds and Business IDs
router.get('/:contextId/:otherUserId', requireAuth, async (req, res) => {
  try {
    const { contextId, otherUserId: rawOtherUserId } = req.params;
    const myId = req.user.id;

    // Resolve other user's MongoDB ObjectId (works if passed F0001, B0001, or Mongo ObjectId)
    const otherId = await resolveUserId(rawOtherUserId);
    if (!otherId) {
      return res.status(404).json({ error: `User "${rawOtherUserId}" could not be resolved` });
    }

    if (String(myId) === String(otherId)) {
      return res.status(400).json({ error: 'Cannot create a conversation with yourself' });
    }

    // Determine if contextId refers to a Transaction or Listing
    let transaction = null;
    let listing = null;

    if (mongoose.Types.ObjectId.isValid(contextId)) {
      transaction = await Transaction.findById(contextId);
      if (!transaction) {
        listing = await Listing.findById(contextId);
      }
    }

    if (!transaction && !listing) {
      // Check by business identifier (e.g. TR0001 or L0001)
      transaction = await Transaction.findOne({ transaction_id: String(contextId).toUpperCase() });
      if (!transaction) {
        listing = await Listing.findOne({ listing_id: String(contextId).toUpperCase() });
      }
    }

    // Determine conversation type
    let convType = 'farmer_buyer';
    const otherUser = await User.findById(otherId).select('role');
    const myRole = req.user.role;
    const otherRole = otherUser?.role;

    if (myRole === 'logistics' || otherRole === 'logistics') {
      convType = (myRole === 'farmer' || otherRole === 'farmer') ? 'farmer_logistics' : 'buyer_logistics';
    }

    // Find or create Conversation
    let convQuery = {
      participants: { $all: [myId, otherId] },
    };
    if (transaction) convQuery.transaction = transaction._id;
    else if (listing) convQuery.listing = listing._id;

    let conv = await Conversation.findOne(convQuery);

    if (!conv) {
      // Verify authorization before creating a new conversation
      if (convType.includes('logistics')) {
        if (!transaction) {
          return res.status(400).json({ error: 'Logistics conversations require an associated transaction' });
        }
        const isParticipant =
          String(transaction.farmer) === String(myId) ||
          String(transaction.buyer) === String(myId) ||
          String(transaction.logisticsPartner) === String(myId) ||
          (myRole === 'logistics' && !transaction.logisticsPartner);

        if (!isParticipant) {
          return res.status(403).json({ error: 'Not authorized for this logistics transaction' });
        }
      }

      conv = await Conversation.create({
        type: convType,
        transaction: transaction ? transaction._id : null,
        listing: listing ? listing._id : (transaction ? transaction.listing : null),
        participants: [myId, otherId],
        lastMessage: {
          text: 'Conversation started',
          sender: myId,
          createdAt: new Date(),
        },
      });
    }

    const legacyConvId = buildConversationId(contextId, myId, otherId);

    // Fetch messages for this conversation (including legacy conversationId lookup)
    const messages = await Message.find({
      $or: [
        { conversation: conv._id },
        { conversationId: legacyConvId },
      ],
    }).sort({ createdAt: 1 }).lean();

    // Mark unread messages as read
    await Message.updateMany(
      { conversation: conv._id, receiver: myId, readAt: null },
      { readAt: new Date() }
    );

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch messages', detail: err.message });
  }
});

module.exports = router;
