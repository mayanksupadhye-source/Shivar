const express = require('express');
const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── CREATE bid ── buyer only
router.post('/', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const { listingId, offerPrice, quantity, message } = req.body;
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status !== 'available') return res.status(400).json({ error: 'Listing is no longer available' });

    const bid = await Bid.create({
      listing: listingId, buyer: req.user.id, farmer: listing.farmer,
      offerPrice, quantity, message,
    });
    res.status(201).json(bid);
  } catch (err) {
    res.status(500).json({ error: 'Could not place bid', detail: err.message });
  }
});

// ── GET bids for a listing ── (farmer checking offers they've received)
router.get('/listing/:listingId', requireAuth, async (req, res) => {
  try {
    const bids = await Bid.find({ listing: req.params.listingId })
      .populate('buyer', 'name district mobile')
      .sort({ createdAt: -1 });
    res.json(bids);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch bids', detail: err.message });
  }
});

// ── GET my bids ── (buyer checking their own offers)
router.get('/my', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const bids = await Bid.find({ buyer: req.user.id })
      .populate('listing')
      .populate('farmer', 'name district mobile')
      .sort({ createdAt: -1 });
    res.json(bids);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch your bids', detail: err.message });
  }
});

// ── GET bids across ALL of my listings ── (farmer's unified bid inbox)
router.get('/mine', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const bids = await Bid.find({ farmer: req.user.id })
      .populate('listing')
      .populate('buyer', 'name district mobile companyName')
      .sort({ createdAt: -1 });
    res.json(bids);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch bids', detail: err.message });
  }
});

// ── CANCEL bid ── buyer only, own pending bid
router.delete('/:id', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (String(bid.buyer) !== req.user.id) return res.status(403).json({ error: 'Not your bid' });
    if (bid.status !== 'pending') return res.status(400).json({ error: 'Only pending bids can be cancelled' });

    bid.status = 'rejected';
    await bid.save();
    res.json({ message: 'Bid cancelled', bid });
  } catch (err) {
    res.status(500).json({ error: 'Could not cancel bid', detail: err.message });
  }
});

// ── ACCEPT bid ── farmer only, creates an Order and marks listing sold
router.put('/:id/accept', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (String(bid.farmer) !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

    bid.status = 'accepted';
    await bid.save();

    await Listing.findByIdAndUpdate(bid.listing, { status: 'sold' });

    const order = await Order.create({
      listing: bid.listing, bid: bid._id, buyer: bid.buyer, farmer: bid.farmer,
      finalPrice: bid.offerPrice, quantity: bid.quantity,
    });

    // Reject other pending bids on the same listing
    await Bid.updateMany(
      { listing: bid.listing, _id: { $ne: bid._id }, status: 'pending' },
      { status: 'rejected' }
    );

    res.json({ message: 'Bid accepted, order created', bid, order });
  } catch (err) {
    res.status(500).json({ error: 'Could not accept bid', detail: err.message });
  }
});

// ── REJECT bid ── farmer only
router.put('/:id/reject', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (String(bid.farmer) !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

    bid.status = 'rejected';
    await bid.save();
    res.json(bid);
  } catch (err) {
    res.status(500).json({ error: 'Could not reject bid', detail: err.message });
  }
});

module.exports = router;
