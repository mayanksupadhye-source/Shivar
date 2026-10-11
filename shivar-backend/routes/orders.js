const express = require('express');
const Order = require('../models/Order');
const { requireAuth } = require('../middleware/auth');

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

// ── UPDATE order status (e.g. mark shipped/completed) ──
router.put('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const isParty = String(order.farmer) === req.user.id || String(order.buyer) === req.user.id;
    if (!isParty) return res.status(403).json({ error: 'Not your order' });

    order.status = status;
    await order.save();
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Could not update order', detail: err.message });
  }
});

module.exports = router;
