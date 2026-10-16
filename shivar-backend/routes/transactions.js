const express = require('express');
const Transaction = require('../models/Transaction');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET all transactions for the authenticated user ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, crop, page, limit } = req.query;
    const filter = {};

    if (req.user.role === 'farmer') {
      filter.farmer = req.user.id;
    } else if (req.user.role === 'buyer') {
      filter.buyer = req.user.id;
    } else if (req.user.role === 'logistics') {
      // Show assigned transactions OR confirmed available transactions ready for pickup
      if (req.query.scope === 'assigned') {
        filter.logisticsPartner = req.user.id;
      } else if (req.query.scope === 'available') {
        filter.status = 'confirmed';
        filter.logisticsPartner = null;
      } else {
        filter.$or = [
          { logisticsPartner: req.user.id },
          { status: 'confirmed', logisticsPartner: null },
        ];
      }
    }

    if (status && status !== 'all') filter.status = status;
    if (crop) filter.crop = new RegExp(crop.trim(), 'i');

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('farmer', 'name district village taluka mobile marketplaceId')
        .populate('buyer', 'name companyName district village taluka mobile marketplaceId')
        .populate('logisticsPartner', 'name mobile marketplaceId vehicles baseLocation')
        .populate('listing', 'crop variety quantity_tonnes price_per_quintal description')
        .sort({ transaction_date: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Transaction.countDocuments(filter),
    ]);

    res.json({
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      transactions,
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch transactions', detail: err.message });
  }
});

// ── GET single transaction ──
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id)
      .populate('farmer', 'name district village taluka mobile marketplaceId')
      .populate('buyer', 'name companyName district village taluka mobile marketplaceId')
      .populate('logisticsPartner', 'name mobile marketplaceId vehicles baseLocation')
      .populate('listing');

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    // Authorization check: participant or any logistics partner evaluating available job
    const isParty =
      String(tx.farmer._id || tx.farmer) === req.user.id ||
      String(tx.buyer._id || tx.buyer) === req.user.id ||
      (tx.logisticsPartner && String(tx.logisticsPartner._id || tx.logisticsPartner) === req.user.id) ||
      (req.user.role === 'logistics' && !tx.logisticsPartner);

    if (!isParty) {
      return res.status(403).json({ error: 'You are not authorized to view this transaction' });
    }

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch transaction', detail: err.message });
  }
});

// ── CLAIM / ASSIGN DELIVERY ── Logistics Partner only
router.post('/:id/claim', requireAuth, requireRole('logistics'), async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    if (tx.logisticsPartner && String(tx.logisticsPartner) !== req.user.id) {
      return res.status(409).json({ error: 'Transaction is already claimed by another logistics partner' });
    }

    const partner = await User.findById(req.user.id);

    tx.logisticsPartner = req.user.id;
    tx.logistics_id = partner?.marketplaceId || null;
    tx.status = 'assigned';
    await tx.save();

    // Automatically initialize logistics conversation channels:
    // 1. Logistics <-> Farmer
    await Conversation.findOneAndUpdate(
      { transaction: tx._id, type: 'farmer_logistics' },
      {
        type: 'farmer_logistics',
        transaction: tx._id,
        listing: tx.listing,
        participants: [tx.farmer, req.user.id],
        lastMessage: {
          text: `Logistics partner ${partner?.name || 'Partner'} assigned for delivery pickup.`,
          sender: req.user.id,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // 2. Logistics <-> Buyer
    await Conversation.findOneAndUpdate(
      { transaction: tx._id, type: 'buyer_logistics' },
      {
        type: 'buyer_logistics',
        transaction: tx._id,
        listing: tx.listing,
        participants: [tx.buyer, req.user.id],
        lastMessage: {
          text: `Logistics partner ${partner?.name || 'Partner'} assigned for delivery fulfillment.`,
          sender: req.user.id,
          createdAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    res.json({ message: 'Delivery successfully claimed', transaction: tx });
  } catch (err) {
    res.status(500).json({ error: 'Could not claim delivery', detail: err.message });
  }
});

// ── UPDATE TRANSACTION STATUS ──
router.put('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pending', 'confirmed', 'logistics_confirmed', 'assigned', 'in_transit', 'delivered', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Valid values: ${validStatuses.join(', ')}` });
    }

    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const isParty =
      String(tx.farmer) === req.user.id ||
      String(tx.buyer) === req.user.id ||
      (tx.logisticsPartner && String(tx.logisticsPartner) === req.user.id);

    if (!isParty) {
      return res.status(403).json({ error: 'You are not authorized to update this transaction' });
    }

    tx.status = status;
    await tx.save();

    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Could not update status', detail: err.message });
  }
});

module.exports = router;
