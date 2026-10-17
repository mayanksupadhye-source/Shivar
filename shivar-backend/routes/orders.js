const express = require('express');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Feedback = require('../models/Feedback');
const User = require('../models/User');
const H = require('../config/honour');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET my orders (works for both farmer and buyer — bridges Transaction & Order collections) ──
router.get('/my', requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === 'farmer' ? { farmer: req.user.id } : { buyer: req.user.id };
    const [transactions, orders, feedbacks] = await Promise.all([
      Transaction.find(filter)
        .populate('listing')
        .populate('buyer', 'name district mobile companyName marketplaceId')
        .populate('farmer', 'name district mobile marketplaceId honourScore isBlacklisted')
        .populate('logisticsPartner', 'name mobile marketplaceId')
        .sort({ createdAt: -1 }),
      Order.find(filter)
        .populate('listing')
        .populate('buyer', 'name district mobile')
        .populate('farmer', 'name district mobile honourScore isBlacklisted')
        .sort({ createdAt: -1 }),
      Feedback.find(req.user.role === 'farmer' ? { farmer: req.user.id } : { buyer: req.user.id }).lean(),
    ]);

    const feedbackOrderIds = new Set(feedbacks.map((f) => String(f.order)));
    const mergedMap = new Map();

    // Transactions are the source of truth for logistics, shipment code, and pricing
    for (const t of transactions) {
      const idStr = String(t._id);
      mergedMap.set(idStr, {
        ...t.toObject(),
        _id: t._id,
        id: t._id,
        finalPrice: t.agreed_price_per_quintal,
        quantity: t.quantity_tons,
        feedbackGiven: t.feedbackGiven || feedbackOrderIds.has(idStr),
        receivedAt: t.receivedAt || null,
        shipment_code: t.shipment_code,
        sacks_count: t.sacks_count,
        status: t.status,
      });
    }

    // Add any standalone orders not already in map
    for (const o of orders) {
      const idStr = String(o._id);
      if (!mergedMap.has(idStr)) {
        mergedMap.set(idStr, {
          ...o.toObject(),
          _id: o._id,
          id: o._id,
          feedbackGiven: o.feedbackGiven || feedbackOrderIds.has(idStr),
          receivedAt: o.receivedAt,
        });
      }
    }

    const result = Array.from(mergedMap.values()).sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );

    res.json(result);
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
    const tx = await Transaction.findById(req.params.id);

    if (!order && !tx) return res.status(404).json({ error: 'Order not found' });

    const farmerId = order?.farmer || tx?.farmer;
    const buyerId = order?.buyer || tx?.buyer;
    const isParty = String(farmerId) === req.user.id || String(buyerId) === req.user.id;
    if (!isParty) return res.status(403).json({ error: 'Not your order' });

    if (order && order.status === 'completed') {
      return res.status(400).json({ error: 'This order is already completed' });
    }

    if (order) {
      order.status = status;
      await order.save();
    }
    if (tx) {
      tx.status = status;
      await tx.save();
    }

    res.json(order || tx);
  } catch (err) {
    res.status(500).json({ error: 'Could not update order', detail: err.message });
  }
});

// ── MARK RECEIVED + COMPULSORY FEEDBACK ── buyer only
router.put('/:id/received', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    const tx = await Transaction.findById(req.params.id);

    if (!order && !tx) return res.status(404).json({ error: 'Order not found' });

    const buyerId = order?.buyer || tx?.buyer;
    const farmerId = order?.farmer || tx?.farmer;
    const currentStatus = order?.status || tx?.status;
    const alreadyGiven = (order && order.feedbackGiven) || (tx && tx.feedbackGiven);

    if (String(buyerId) !== req.user.id) return res.status(403).json({ error: 'Not your order' });
    if (alreadyGiven) return res.status(400).json({ error: 'Feedback already given for this order' });

    const receivableStatuses = ['confirmed', 'shipped', 'logistics_confirmed', 'assigned', 'in_transit', 'delivered'];
    if (!receivableStatuses.includes(currentStatus)) {
      return res.status(400).json({ error: 'This order cannot be marked received right now' });
    }

    // Server-side compulsory check: all 3 must be whole numbers 1-5
    const { quality, packaging, honesty } = req.body || {};
    const all = [quality, packaging, honesty];
    if (!all.every((r) => Number.isInteger(r) && r >= 1 && r <= 5)) {
      return res.status(400).json({ error: 'Rate quality, packaging and honesty with whole numbers from 1 to 5' });
    }
    const average = Math.round(((quality + packaging + honesty) / 3) * 100) / 100;

    const targetId = order?._id || tx?._id;

    // Unique index on Feedback.order blocks double submissions
    let feedbackDoc;
    try {
      feedbackDoc = await Feedback.create({
        order: targetId,
        farmer: farmerId,
        buyer: buyerId,
        quality,
        packaging,
        honesty,
        average,
      });
    } catch (e) {
      if (e.code === 11000) return res.status(409).json({ error: 'Feedback already given for this order' });
      throw e;
    }

    try {
      if (order) {
        order.status = 'completed';
        order.feedbackGiven = true;
        order.receivedAt = new Date();
        await order.save();
      }
      if (tx) {
        tx.status = 'delivered';
        tx.feedbackGiven = true;
        tx.receivedAt = new Date();
        await tx.save();
      }
    } catch (saveErr) {
      await Feedback.deleteOne({ _id: feedbackDoc._id });
      throw saveErr;
    }

    // Update the farmer's honour score: good ratings add points, poor ratings remove points
    const farmer = await User.findById(farmerId).select('honourScore reviewedOrders isBlacklisted');
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
      await User.findByIdAndUpdate(farmerId, { $set: set });
      honourScore = newScore;
    }

    res.json({
      message: 'Order received, thank you for your feedback',
      order: order || tx,
      honourScore,
      honourChange,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not save feedback', detail: err.message });
  }
});

module.exports = router;
