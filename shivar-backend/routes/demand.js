const express = require('express');
const Demand = require('../models/Demand');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { resolveUserId } = require('../utils/identity');

const router = express.Router();

// ── GET all buyer demands (with filtering & pagination) ──
// Public / Farmers — farmers browse buyer demands to respond and fulfill
router.get('/', async (req, res) => {
  try {
    const {
      crop,
      variety,
      cluster,
      district,
      status = 'open',
      buyer,
      page,
      limit,
    } = req.query;

    const filter = {};
    if (status !== 'all') filter.status = status;
    if (crop) filter.crop = new RegExp(crop.trim(), 'i');
    if (variety) filter.variety = new RegExp(variety.trim(), 'i');
    if (cluster) filter.cluster = new RegExp(cluster.trim(), 'i');
    if (district) filter.district = new RegExp(district.trim(), 'i');

    if (buyer) {
      const buyerId = await resolveUserId(buyer);
      if (buyerId) {
        filter.buyer = buyerId;
      } else {
        filter.buyer = buyer;
      }
    }

    const isExplicitlyPaginated = page !== undefined || limit !== undefined;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const query = Demand.find(filter)
      .populate('buyer', 'name companyName district village taluka mobile marketplaceId')
      .sort({ createdAt: -1 });

    if (isExplicitlyPaginated) {
      const [demands, total] = await Promise.all([
        query.skip((pageNum - 1) * limitNum).limit(limitNum),
        Demand.countDocuments(filter),
      ]);

      return res.json({
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        demands,
      });
    }

    const [demands, total] = await Promise.all([
      query.limit(100),
      Demand.countDocuments(filter),
    ]);

    res.set('X-Total-Count', String(total));
    res.json(demands);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch demands', detail: err.message });
  }
});

// ── GET single demand ──
router.get('/:id', async (req, res) => {
  try {
    const demand = await Demand.findById(req.params.id)
      .populate('buyer', 'name companyName district village taluka mobile marketplaceId');
    if (!demand) return res.status(404).json({ error: 'Demand not found' });
    res.json(demand);
  } catch (err) {
    res.status(500).json({ error: 'Could not fetch demand', detail: err.message });
  }
});

// ── CREATE demand ── Buyer only
router.post('/', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const {
      crop,
      variety,
      required_quantity_tons,
      quantity,
      maximum_price_per_quintal,
      maxPrice,
      description,
      required_by_date,
      cluster,
      district,
      taluka,
      village,
    } = req.body;

    const qty = required_quantity_tons !== undefined ? Number(required_quantity_tons) : Number(quantity);
    const price = maximum_price_per_quintal !== undefined ? Number(maximum_price_per_quintal) : Number(maxPrice);

    if (!crop || isNaN(qty) || isNaN(price)) {
      return res.status(400).json({ error: 'Crop, required quantity, and maximum price are required' });
    }

    const buyerUser = await User.findById(req.user.id);

    const demand = await Demand.create({
      buyer: req.user.id,
      buyer_id: buyerUser?.marketplaceId || null,
      crop: crop.trim(),
      variety: variety ? variety.trim() : undefined,
      required_quantity_tons: qty,
      maximum_price_per_quintal: price,
      description: description ? description.trim() : undefined,
      required_by_date: required_by_date ? new Date(required_by_date) : undefined,
      cluster: cluster ? cluster.trim() : (buyerUser?.vibhagCluster || undefined),
      district: district ? district.trim() : (buyerUser?.district || undefined),
      taluka: taluka ? taluka.trim() : (buyerUser?.taluka || undefined),
      village: village ? village.trim() : (buyerUser?.village || undefined),
      status: 'open',
    });

    res.status(201).json(demand);
  } catch (err) {
    res.status(500).json({ error: 'Could not create demand', detail: err.message });
  }
});

// ── UPDATE demand ── Only the buyer who owns it
router.put('/:id', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const demand = await Demand.findById(req.params.id);
    if (!demand) return res.status(404).json({ error: 'Demand not found' });
    if (String(demand.buyer) !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this demand' });
    }

    const {
      crop,
      variety,
      required_quantity_tons,
      maximum_price_per_quintal,
      description,
      required_by_date,
      cluster,
      district,
      taluka,
      village,
      status,
    } = req.body;

    if (crop) demand.crop = crop.trim();
    if (variety !== undefined) demand.variety = variety ? variety.trim() : undefined;
    if (required_quantity_tons !== undefined) demand.required_quantity_tons = Number(required_quantity_tons);
    if (maximum_price_per_quintal !== undefined) demand.maximum_price_per_quintal = Number(maximum_price_per_quintal);
    if (description !== undefined) demand.description = description ? description.trim() : undefined;
    if (required_by_date !== undefined) demand.required_by_date = required_by_date ? new Date(required_by_date) : undefined;
    if (cluster !== undefined) demand.cluster = cluster;
    if (district !== undefined) demand.district = district;
    if (taluka !== undefined) demand.taluka = taluka;
    if (village !== undefined) demand.village = village;
    if (status && ['open', 'fulfilled', 'cancelled'].includes(status)) {
      demand.status = status;
    }

    await demand.save();
    res.json(demand);
  } catch (err) {
    res.status(500).json({ error: 'Could not update demand', detail: err.message });
  }
});

// ── DELETE demand ── Only the buyer who owns it
router.delete('/:id', requireAuth, requireRole('buyer'), async (req, res) => {
  try {
    const demand = await Demand.findById(req.params.id);
    if (!demand) return res.status(404).json({ error: 'Demand not found' });
    if (String(demand.buyer) !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this demand' });
    }

    await demand.deleteOne();
    res.json({ message: 'Demand deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete demand', detail: err.message });
  }
});

module.exports = router;
