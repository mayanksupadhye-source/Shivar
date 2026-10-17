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

    // No bids on a blacklisted farmer's listing
    const farmerUser = await User.findById(listing.farmer).select('isBlacklisted');
    if (farmerUser && farmerUser.isBlacklisted) {
      return res.status(403).json({ error: 'This farmer is currently blacklisted and cannot receive bids' });
    }

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
router.get('/listing/:listingId', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (String(listing.farmer) !== req.user.id) {
      return res.status(403).json({ error: 'Not your listing' });
    }
    const bids = await Bid.find({ listing: req.params.listingId })
      .populate('buyer', 'name district mobile companyName marketplaceId')
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
      .populate('farmer', 'name district mobile honourScore isBlacklisted marketplaceId')
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
      .populate('buyer', 'name district mobile companyName marketplaceId')
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

// ── ACCEPT bid ── farmer only, creates canonical Transaction, Order, and Conversation
router.put('/:id/accept', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const bid = await Bid.findById(req.params.id);
    if (!bid) return res.status(404).json({ error: 'Bid not found' });
    if (String(bid.farmer) !== req.user.id) return res.status(403).json({ error: 'Not your listing' });

    // Blacklisted farmers cannot accept bids
    const me = await User.findById(req.user.id).select('isBlacklisted');
    if (me && me.isBlacklisted) {
      return res.status(403).json({ error: 'Your account is blacklisted. You cannot accept bids.' });
    }

    if (bid.status !== 'pending') {
      return res.status(400).json({ error: 'This bid is no longer pending' });
    }

    // Claim the bid atomically
    const claimed = await Bid.findOneAndUpdate(
      { _id: bid._id, status: 'pending' },
      { status: 'accepted' },
      { new: true }
    );
    if (!claimed) {
      return res.status(400).json({ error: 'This bid is no longer pending' });
    }

    const [listing, farmerUser, buyerUser] = await Promise.all([
      Listing.findById(bid.listing),
      User.findById(bid.farmer),
      User.findById(bid.buyer),
    ]);

    if (!listing) {
      await Bid.findByIdAndUpdate(bid._id, { status: 'pending' });
      return res.status(404).json({ error: 'Associated listing not found' });
    }

    // Format pickup and delivery locations from profiles and listing
    const pickupParts = [listing.village, listing.taluka, listing.district, listing.cluster].filter(Boolean);
    const pickupLocation = pickupParts.length ? pickupParts.join(', ') : (farmerUser?.district || 'Pickup Location, India');

    const deliveryParts = [buyerUser?.village, buyerUser?.taluka, buyerUser?.district, buyerUser?.vibhagCluster].filter(Boolean);
    const deliveryLocation = deliveryParts.length ? deliveryParts.join(', ') : (buyerUser?.district || 'Delivery Location, India');

    const txSuffix = Math.floor(10000 + Math.random() * 90000);
    const generatedTxId = `TR${txSuffix}`;

    let transaction;
    let order;

    try {
      // 1. Create canonical Transaction
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

      // 2. Create Order document
      try {
        order = await Order.create({
          _id: transaction._id,
          listing: bid.listing,
          bid: bid._id,
          buyer: bid.buyer,
          farmer: bid.farmer,
          finalPrice: bid.offerPrice,
          quantity: bid.quantity,
          status: 'confirmed',
        });
      } catch (orderIdErr) {
        order = await Order.create({
          listing: bid.listing,
          bid: bid._id,
          buyer: bid.buyer,
          farmer: bid.farmer,
          finalPrice: bid.offerPrice,
          quantity: bid.quantity,
          status: 'confirmed',
        });
      }

      claimed.transaction = transaction._id;
      await claimed.save();

      await Listing.findByIdAndUpdate(bid.listing, { status: 'sold' });

      // 3. Automatically create/link the farmer-buyer conversation for this transaction
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

    } catch (txErr) {
      // Rollback bid status on unexpected failure
      await Bid.findByIdAndUpdate(bid._id, { status: 'pending' });
      throw txErr;
    }

    res.json({
      message: 'Bid accepted, transaction confirmed',
      bid: claimed,
      transaction,
      order,
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

    // Only pending bids can be rejected
    if (bid.status !== 'pending') {
      return res.status(400).json({ error: 'This bid is no longer pending' });
    }

    bid.status = 'rejected';
    await bid.save();
    res.json(bid);
  } catch (err) {
    res.status(500).json({ error: 'Could not reject bid', detail: err.message });
  }
});

module.exports = router;