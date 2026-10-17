const express = require('express');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveUserId } = require('../utils/identity');

const router = express.Router();

// ── GET all listings (with filtering & pagination) ──
// Public — buyers browse without needing to log in first
router.get('/', async (req, res) => {
  try {
    const {
      crop,
      variety,
      cluster,
      district,
      status = 'available',
      farmer,
      page,
      limit,
    } = req.query;

    const filter = {};
    if (status !== 'all') filter.status = status;
    if (crop) filter.crop = new RegExp(crop.trim(), 'i');
    if (variety) filter.variety = new RegExp(variety.trim(), 'i');
    if (cluster) filter.cluster = new RegExp(cluster.trim(), 'i');
    if (district) filter.district = new RegExp(district.trim(), 'i');

    if (farmer) {
      // Resolve either MongoDB ObjectId or business farmer_id (e.g. F0001)
      const farmerId = await resolveUserId(farmer);
      if (farmerId) {
        filter.farmer = farmerId;
      } else {
        filter.farmer = farmer;
      }
    } else {
      // Public browse hides listings of blacklisted farmers
      const blocked = await User.find({ isBlacklisted: true }).distinct('_id');
      if (blocked.length) filter.farmer = { $nin: blocked };
    }

    const isExplicitlyPaginated = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const query = Listing.find(filter)
      .populate('farmer', 'name district village taluka mobile marketplaceId honourScore isBlacklisted')
      .sort({ createdAt: -1 });

    if (isExplicitlyPaginated) {
      const [listings, total] = await Promise.all([
        query.skip((pageNum - 1) * limitNum).limit(limitNum),
        Listing.countDocuments(filter),
      ]);

      return res.json({
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        listings,
      });
    }

    // Default unpaginated query (safely bounded to 100 items to avoid UI freezes)
    const [listings, total] = await Promise.all([
      query.limit(100),
      Listing.countDocuments(filter),
    ]);

    res.set('X-Total-Count', String(total));
    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch listings', detail: err.message });
  }
});

// ── GET single listing ──
router.get('/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('farmer', 'name district village taluka mobile marketplaceId honourScore isBlacklisted');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(listing);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch listing', detail: err.message });
  }
});

// ── CREATE listing ── Farmer only
router.post('/', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    // Blacklist check must run BEFORE the listing is created
    const me = await User.findById(req.user.id).select('isBlacklisted');
    if (me && me.isBlacklisted) {
      return res.status(403).json({ error: 'Your account is blacklisted. You cannot create listings.' });
    }

    const {
      crop,
      variety,
      quantity,
      quantity_tonnes,
      pricePerUnit,
      price_per_quintal,
      description,
      harvest_date,
      cluster,
      district,
      taluka,
      village,
    } = req.body;

    const qty = quantity_tonnes !== undefined ? Number(quantity_tonnes) : Number(quantity);
    const price = price_per_quintal !== undefined ? Number(price_per_quintal) : Number(pricePerUnit);

    if (!crop || isNaN(qty) || isNaN(price)) {
      return res.status(400).json({ error: 'Crop, quantity, and price are required fields' });
    }

    const farmerUser = await User.findById(req.user.id);

    const listing = await Listing.create({
      farmer: req.user.id,
      farmer_id: farmerUser?.marketplaceId || null,
      crop: crop.trim(),
      variety: variety ? variety.trim() : undefined,
      quantity_tonnes: qty,
      price_per_quintal: price,
      description: description ? description.trim() : undefined,
      harvest_date: harvest_date ? new Date(harvest_date) : undefined,
      cluster: cluster ? cluster.trim() : (farmerUser?.vibhagCluster || undefined),
      district: district ? district.trim() : (farmerUser?.district || undefined),
      taluka: taluka ? taluka.trim() : (farmerUser?.taluka || undefined),
      village: village ? village.trim() : (farmerUser?.village || undefined),
      status: 'available',
    });

    res.status(201).json(listing);
  } catch (err) {
    res.status(500).json({ error: 'Could not create listing', detail: err.message });
  }
});

// ── UPDATE listing ── Only the farmer who owns it
// Security: Strict allowlist prevents tampering with farmer, _id, or listing_id
router.put('/:id', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (String(listing.farmer) !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }

    const {
      crop,
      variety,
      quantity,
      quantity_tonnes,
      pricePerUnit,
      price_per_quintal,
      description,
      harvest_date,
      cluster,
      district,
      taluka,
      village,
      status,
    } = req.body;

    if (crop) listing.crop = crop.trim();
    if (variety !== undefined) listing.variety = variety ? variety.trim() : undefined;
    if (quantity_tonnes !== undefined) listing.quantity_tonnes = Number(quantity_tonnes);
    else if (quantity !== undefined) listing.quantity_tonnes = Number(quantity);

    if (price_per_quintal !== undefined) listing.price_per_quintal = Number(price_per_quintal);
    else if (pricePerUnit !== undefined) listing.price_per_quintal = Number(pricePerUnit);

    if (description !== undefined) listing.description = description ? description.trim() : undefined;
    if (harvest_date !== undefined) listing.harvest_date = harvest_date ? new Date(harvest_date) : undefined;
    if (cluster !== undefined) listing.cluster = cluster;
    if (district !== undefined) listing.district = district;
    if (taluka !== undefined) listing.taluka = taluka;
    if (village !== undefined) listing.village = village;
    if (status && ['available', 'pending', 'sold', 'withdrawn'].includes(status)) {
      listing.status = status;
    }

    await listing.save();
    res.json(listing);
  } catch (err) {
    res.status(500).json({ error: 'Could not update listing', detail: err.message });
  }
});

// ── DELETE listing ── Only the farmer who owns it
router.delete('/:id', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (String(listing.farmer) !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }

    await listing.deleteOne();
    res.json({ message: 'Listing deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete listing', detail: err.message });
  }
});

module.exports = router;