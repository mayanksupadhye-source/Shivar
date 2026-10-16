const express = require('express');
const Transaction = require('../models/Transaction');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET my orders (compatibility bridge: queries canonical Transaction collection) ──
router.get('/my', requireAuth, async (req, res) => {
  try {
    const filter = req.user.role === 'farmer' ? { farmer: req.user.id } : { buyer: req.user.id };
    const transactions = await Transaction.find(filter)
      .populate('listing')
      .populate('buyer', 'name district mobile companyName marketplaceId')
      .populate('farmer', 'name district mobile marketplaceId')
      .populate('logisticsPartner', 'name mobile marketplaceId')
      .sort({ createdAt: -1 });

    // Map fields so frontend expecting Order.finalPrice or Order.quantity receives them cleanly
    const orders = transactions.map((t) => ({
      ...t.toObject(),
      finalPrice: t.agreed_price_per_quintal,
      quantity: t.quantity_tons,
      _id: t._id,
      id: t._id,
    }));

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch orders', detail: err.message });
  }
});

// ── UPDATE order status ──
router.put('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ error: 'Order not found' });

    const isParty = String(tx.farmer) === req.user.id || String(tx.buyer) === req.user.id;
    if (!isParty) return res.status(403).json({ error: 'Not your order' });

    tx.status = status;
    await tx.save();
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: 'Could not update order', detail: err.message });
  }
});

module.exports = router;
