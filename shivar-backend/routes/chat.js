const express = require('express');
const Message = require('../models/Message');
const { requireAuth } = require('../middleware/auth');
const { buildConversationId } = require('../utils/chatUtils');

const router = express.Router();

// ── GET message history for a conversation (listing + other user) ──
router.get('/:listingId/:otherUserId', requireAuth, async (req, res) => {
  try {
    const { listingId, otherUserId } = req.params;
    const conversationId = buildConversationId(listingId, req.user.id, otherUserId);

    const messages = await Message.find({ conversationId }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch messages', detail: err.message });
  }
});

// ── GET list of my conversations (for an inbox view) ──
router.get('/inbox/all', requireAuth, async (req, res) => {
  try {
    const messages = await Message.find({
      $or: [{ sender: req.user.id }, { receiver: req.user.id }],
    }).sort({ createdAt: -1 });

    // Collapse to one entry per conversationId (most recent message)
    const seen = new Set();
    const conversations = [];
    for (const m of messages) {
      if (!seen.has(m.conversationId)) {
        seen.add(m.conversationId);
        conversations.push(m);
      }
    }
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch inbox', detail: err.message });
  }
});

module.exports = router;
