const express = require('express');
const Bid = require('../models/Bid');
const Listing = require('../models/Listing');
const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const Conversation = require('../models/Conversation');
const User = require('../models/User');
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
      .populate('transaction', 'transaction_id status shipment_code sacks_count')
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
      .populate('transaction', 'transaction_id status shipment_code sacks_count')
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

// ── ACCEPT bid ── farmer only, creates canonical Transaction and Conversation
router.put('/:id/accept', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (String(bid.farmer) !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

    // IDEMPOTENCY: Check if transaction was already created for this bid
    let transaction = await Transaction.findOne({ bid: bid._id });
    if (!transaction) {
      const [listing, farmerUser, buyerUser] = await Promise.all([
        Listing.findById(bid.listing),
        User.findById(bid.farmer),
        User.findById(bid.buyer),
      ]);

      if (!listing) return res.status(404).json({ error: 'Associated listing not found' });

      bid.status = 'accepted';
      await bid.save();

      listing.status = 'sold';
      await listing.save();

      // Format pickup and delivery locations from profiles and listing
      const pickupParts = [listing.village, listing.taluka, listing.district, listing.cluster].filter(Boolean);
      const pickupLocation = pickupParts.length ? pickupParts.join(', ') : (farmerUser?.district || 'Pickup Location, India');

      const deliveryParts = [buyerUser?.village, buyerUser?.taluka, buyerUser?.district, buyerUser?.vibhagCluster].filter(Boolean);
      const deliveryLocation = deliveryParts.length ? deliveryParts.join(', ') : (buyerUser?.district || 'Delivery Location, India');

      const txSuffix = Math.floor(10000 + Math.random() * 90000);
      const generatedTxId = `TR${txSuffix}`;

      transaction = await Transaction.create({
        transaction_id: generatedTxId,
        listing: listing._id,
        listing_id: listing.listing_id || null,
        farmer: bid.farmer,
        farmer_id: farmerUser?.marketplaceId || null,
        buyer: bid.buyer,
        buyer_id: buyerUser?.marketplaceId || null,
        crop: listing.crop,
        variety: listing.variety || '',
        quantity_tons: bid.quantity,
        agreed_price_per_quintal: bid.offerPrice,
        pickup_location: pickupLocation,
        delivery_location: deliveryLocation,
        status: 'confirmed',
        bid: bid._id,
      });

      bid.transaction = transaction._id;
      await bid.save();

      // Automatically create or link the farmer-buyer conversation for this transaction
      await Conversation.findOneAndUpdate(
        { transaction: transaction._id, type: 'farmer_buyer' },
        {
          type: 'farmer_buyer',
          transaction: transaction._id,
          listing: listing._id,
          participants: [bid.farmer, bid.buyer],
          lastMessage: {
            text: `Deal confirmed for ${listing.crop} (${bid.quantity} tons @ ₹${bid.offerPrice}/qtl)`,
            sender: bid.farmer,
            createdAt: new Date(),
          },
        },
        { upsert: true, new: true }
      );

      // Reject other pending bids on the same listing
      await Bid.updateMany(
        { listing: bid.listing, _id: { $ne: bid._id }, status: 'pending' },
        { status: 'rejected' }
      );
    }

    res.json({
      message: 'Bid accepted, transaction confirmed',
      bid,
      transaction,
      order: transaction, // compatibility alias for older UI scripts
    });
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
