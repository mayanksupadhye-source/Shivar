const express = require('express');
const TransactionReadOnly = require('../models/TransactionReadOnly');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { geocodePlace, geocodeMany } = require('../utils/geocode');
const { haversineKm } = require('../utils/haversine');
const vehicleRates = require('../config/vehicleRates');
const LocationCache = require('../models/LocationCache');

const router = express.Router();
router.use(requireAuth, requireRole('logistics'));

// GET /api/logistics/transactions
// Read-only browse of the existing `transactions` collection. Paginated —
// 3,000 rows is too many to ever send (or geocode) in one shot.
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const { crop, district } = req.query;

    const filter = {};
    if (crop) filter.crop = crop;
    if (district) {
      // pickup_location is a hierarchical string; a loose match on district
      // is good enough here since we never write to this collection.
      filter.pickup_location = { $regex: district, $options: 'i' };
    }

    const [rows, total] = await Promise.all([
      TransactionReadOnly.find(filter)
        .sort({ transaction_date: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      TransactionReadOnly.countDocuments(filter),
    ]);

    res.json({ page, limit, total, transactions: rows });
  } catch (err) {
    console.error('❌ /api/logistics/transactions error:', err);
    res.status(500).json({ error: 'Could not list transactions', detail: err.message });
  }
});

// GET /api/logistics/transactions/sorted-by-distance
// Geocodes only the CURRENT PAGE's pickup locations on demand (bounded,
// small batch — not the full 3,000-row collection) and sorts that page by
// distance from the partner's base. Anything already in LocationCache from
// a prior click resolves instantly.
router.get('/sorted-by-distance', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const partner = await User.findById(req.user.id).lean();
    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    // Your base location (saved after the first lookup, so it is instant later)
    let base;
    try {
      base = await geocodePlace(partner.baseLocation);
    } catch (e) {
      return res.status(400).json({
        error: 'Could not find your base location',
        detail: `Please check the base location in your profile: "${partner.baseLocation}"`,
      });
    }

    // 1. All transactions, but only the pickup field (small and fast)
    const all = await TransactionReadOnly.find({}).select('pickup_location').lean();

    // 2. Saved coordinates from LocationCache (no internet lookups at all)
    const places = [...new Set(all.map((t) => (t.pickup_location || '').trim()).filter(Boolean))];
    const cached = await LocationCache.find({ placeText: { $in: places } })
      .select('placeText lat lng')
      .lean();
    const coordsByPlace = new Map(cached.map((c) => [c.placeText, { lat: c.lat, lng: c.lng }]));

    // 3. Distance for every transaction, then sort. Unknown places go last.
    const ranked = all.map((t) => {
      const c = coordsByPlace.get((t.pickup_location || '').trim());
      return {
        id: t._id,
        pickupCoords: c || null,
        distanceFromBaseKm: c ? round1(haversineKm(base.lat, base.lng, c.lat, c.lng)) : null,
      };
    });

    ranked.sort((a, b) => {
      if (a.distanceFromBaseKm == null && b.distanceFromBaseKm == null) return 0;
      if (a.distanceFromBaseKm == null) return 1;
      if (b.distanceFromBaseKm == null) return -1;
      return a.distanceFromBaseKm - b.distanceFromBaseKm;
    });

    // 4. Take only this page, then load the full details for just those rows
    const pageItems = ranked.slice((page - 1) * limit, page * limit);
    const docs = await TransactionReadOnly.find({ _id: { $in: pageItems.map((p) => p.id) } }).lean();
    const docById = new Map(docs.map((d) => [String(d._id), d]));

    const transactions = pageItems
      .map((p) => ({
        ...docById.get(String(p.id)),
        pickupCoords: p.pickupCoords,
        distanceFromBaseKm: p.distanceFromBaseKm,
      }))
      .filter((t) => t._id);

    res.json({
      page,
      limit,
      total: ranked.length,
      base: { location: partner.baseLocation, ...base },
      transactions,
    });
  } catch (err) {
    console.error('❌ /api/logistics/transactions/sorted-by-distance error:', err);
    res.status(500).json({ error: 'Could not sort by distance', detail: err.message });
  }
});

// POST /api/logistics/transactions/:id/geocode
// The on-demand geocode endpoint — fires only when a partner clicks into a
// specific transaction. Resolves pickup, delivery, and the partner's own
// baseLocation (cache-first), computes distances, and returns a cost/time
// estimate per registered vehicle type.
router.post('/:id/geocode', async (req, res) => {
  try {
    const transaction = await TransactionReadOnly.findById(req.params.id).lean();
    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    const partner = await User.findById(req.user.id).lean();
    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    const [pickup, delivery, base] = await geocodeMany([
      transaction.pickup_location,
      transaction.delivery_location,
      partner.baseLocation,
    ]);

    const distancePickupToDeliveryKm = round1(haversineKm(pickup.lat, pickup.lng, delivery.lat, delivery.lng));
    const distanceBaseToPickupKm = round1(haversineKm(base.lat, base.lng, pickup.lat, pickup.lng));

    // Cost/time estimate for every vehicle type (frontend highlights the
    // partner's own registered vehicles from this list).
    const estimates = Object.entries(vehicleRates).map(([key, rate]) => ({
      vehicleType: key,
      label: rate.label,
      distanceKm: distancePickupToDeliveryKm,
      estimatedCost: round1(distancePickupToDeliveryKm * rate.dieselCostPerKm),
      estimatedTransitHours: round1(distancePickupToDeliveryKm / rate.avgSpeedKmph),
    }));

    res.json({
      transactionId: transaction._id,
      farmer_id: transaction.farmer_id,
      buyer_id: transaction.buyer_id,
      pickup: { location: transaction.pickup_location, ...pickup },
      delivery: { location: transaction.delivery_location, ...delivery },
      base: { location: partner.baseLocation, ...base },
      distancePickupToDeliveryKm,
      distanceBaseToPickupKm,
      vehicleEstimates: estimates,
    });
  } catch (err) {
    console.error('❌ /api/logistics/transactions/:id/geocode error:', err);
    res.status(500).json({ error: 'Could not geocode transaction', detail: err.message });
  }
});

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = router;