const express = require('express');
const Listing = require('../models/Listing');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// ── GET all listings (with optional filters: crop, district, status) ──
// Public — buyers browse without needing to log in first
router.get('/', async (req, res) => {
  try {
    const { crop, district, status = 'available', farmer } = req.query;
    const filter = {};
    if (status !== 'all') filter.status = status;
    if (crop) filter.crop = new RegExp(crop, 'i');
    if (district) filter.district = new RegExp(district, 'i');
    if (farmer) filter.farmer = farmer;

    const listings = await Listing.find(filter)
      .populate('farmer', 'name district mobile')
      .sort({ createdAt: -1 });

    res.json(listings);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch listings', detail: err.message });
  }
});

// ── GET single listing ──
router.get('/:id', async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id).populate('farmer', 'name district mobile');
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    res.json(listing);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch listing', detail: err.message });
  }
});

// ── CREATE listing ── farmer only
router.post('/', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const { crop, quantity, unit, pricePerUnit, soilType, region, district, description } = req.body;
    const listing = await Listing.create({
      farmer: req.user.id, crop, quantity, unit, pricePerUnit, soilType, region, district, description,
    });
    res.status(201).json(listing);
  } catch (err) {
    res.status(500).json({ error: 'Could not create listing', detail: err.message });
  }
});

// ── UPDATE listing ── only the farmer who owns it
router.put('/:id', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (String(listing.farmer) !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }

    Object.assign(listing, req.body);
    await listing.save();
    res.json(listing);
  } catch (err) {
    res.status(500).json({ error: 'Could not update listing', detail: err.message });
  }
});

// ── DELETE listing ── only the farmer who owns it
router.delete('/:id', requireAuth, requireRole('farmer'), async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });
    if (String(listing.farmer) !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this listing' });
    }

    await listing.deleteOne();
    res.json({ message: 'Listing deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete listing', detail: err.message });
  }
});

module.exports = router;
