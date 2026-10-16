const express = require('express');
const Order = require('../models/Order');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const H = require('../config/honour');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET my orders (works for both farmer and buyer — filters by their own ID) ──
router.get('/my', requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === 'farmer' ? { farmer: req.user.id } : { buyer: req.user.id };
    const orders = await Order.find(filter)
      .populate('listing')
      .populate('buyer', 'name district mobile')
      .populate('farmer', 'name district mobile')
      .sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch orders', detail: err.message });
  }
});

// ── GET my honour score ── farmer only. The farmer portal calls this to show a fresh score.
router.get('/honour/me', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const me = await User.findById(req.user.id).select('honourScore reviewedOrders isBlacklisted');
    if (!me) return res.status(404).json({ error: 'User not found' });
    const recent = await Feedback.find({ farmer: req.user.id })
      .sort({ _id: -1 })
      .limit(5)
      .select('quality packaging honesty average')
      .lean();
    res.json({
      honourScore: me.honourScore ?? H.START_SCORE,
      reviewedOrders: me.reviewedOrders ?? 0,
      isBlacklisted: !!me.isBlacklisted,
      recent,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch honour score', detail: err.message });
  }
});

// ── UPDATE order status (e.g. mark shipped) ──
router.put('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;

    // 'completed' is only reachable through /:id/received, so feedback cannot be skipped
    if (status === 'completed') {
      return res.status(400).json({ error: 'Orders become completed only when the buyer confirms receipt with feedback' });
    }

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isParty = String(order.farmer) === req.user.id || String(order.buyer) === req.user.id;
    if (!isParty) return res.status(403).json({ error: 'Not your order' });

    // a finished order cannot be changed again
    if (order.status === 'completed') {
      return res.status(400).json({ error: 'This order is already completed' });
    }

    order.status = status;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Could not update order', detail: err.message });
  }
});

// ── MARK RECEIVED + COMPULSORY FEEDBACK ── buyer only
router.put('/:id/received', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (String(order.buyer) !== req.user.id) return res.status(403).json({ error: 'Not your order' });
    if (order.feedbackGiven) return res.status(400).json({ error: 'Feedback already given for this order' });
    if (!H.RECEIVABLE_STATUSES.includes(order.status)) {
      return res.status(400).json({ error: 'This order cannot be marked received right now' });
    }

    // Server-side compulsory check: all 3 must be whole numbers 1-5
    const { quality, packaging, honesty } = req.body || {};
    const all = [quality, packaging, honesty];
    if (!all.every((r) => Number.isInteger(r) && r >= 1 && r <= 5)) {
      return res.status(400).json({ error: 'Rate quality, packaging and honesty with whole numbers from 1 to 5' });
    }
    const average = Math.round(((quality + packaging + honesty) / 3) * 100) / 100;

    // Unique index on Feedback.order blocks double submissions
    let feedbackDoc;
    try {
      feedbackDoc = await Feedback.create({
        order: order._id, farmer: order.farmer, buyer: order.buyer, quality, packaging, honesty, average,
      });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'Feedback already given for this order' });
      throw e;
    }

    // if saving the order fails, remove the feedback so the buyer can try again
    try {
      order.status = 'completed';
      order.feedbackGiven = true;
      order.receivedAt = new Date();
      await order.save();
    } catch (saveErr) {
      await Feedback.deleteOne({ _id: feedbackDoc._id });
      throw saveErr;
    }

    // Update the farmer's honour score: good ratings add points, poor ratings remove points
    const farmer = await User.findById(order.farmer).select('honourScore reviewedOrders isBlacklisted');
    let honourScore = null;
    let honourChange = 0;
    if (farmer) {
      const oldScore = farmer.honourScore ?? H.START_SCORE;
      honourChange = H.scoreChange(quality, packaging, honesty);
      const newScore = Math.max(0, Math.min(100, oldScore + honourChange));
      const reviewed = (farmer.reviewedOrders ?? 0) + 1;
      const set = { honourScore: newScore, reviewedOrders: reviewed };
      if (newScore < H.BLACKLIST_BELOW && reviewed >= H.MIN_REVIEWS_TO_BLACKLIST && !farmer.isBlacklisted) {
        set.isBlacklisted = true;
        set.blacklistedAt = new Date();
      }
      await User.findByIdAndUpdate(order.farmer, { $set: set });
      honourScore = newScore;
    }

    res.json({ message: 'Order received, thank you for your feedback', order, honourScore, honourChange });
  } catch (err) {
    res.status(500).json({ error: 'Could not save feedback', detail: err.message });
  }
});

module.exports = router;
