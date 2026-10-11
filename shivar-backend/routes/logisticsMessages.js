const express = require('express');
const LogisticsMessage = require('../models/LogisticsMessage');
const { requireAuth, requireRole } = require('../middleware/auth');
const { buildLogisticsConversationId } = require('../utils/logisticsChatUtils');

const router = express.Router();
router.use(requireAuth, requireRole('logistics'));

// GET /api/logistics/messages/:transactionId/:otherUserId
// Loads history for a conversation so the chat UI has something to render
// before any new socket messages arrive. Sending stays on the socket
// (logistics_send_message) — this route is read-only.
router.get('/:transactionId/:otherUserId', async (req, res) => {
  try {
    const { transactionId, otherUserId } = req.params;
    const conversationId = buildLogisticsConversationId(transactionId, req.user.id, otherUserId);

    const messages = await LogisticsMessage.find({ conversationId })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    res.json({ conversationId, messages });
  } catch (err) {
    res.status(500).json({ error: 'Could not load messages', detail: err.message });
  }
});

module.exports = router;