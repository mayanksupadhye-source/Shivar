const express = require('express');
const TransactionReadOnly = require('../models/TransactionReadOnly');
const User = require('../models/User');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { requireAuth, requireRole } = require('../middleware/auth');
const { geocodePlace, geocodeMany } = require('../utils/geocode');
const { haversineKm } = require('../utils/haversine');
const { buildLogisticsConversationId } = require('../utils/logisticsChatUtils');
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
    const { crop, district, status } = req.query;

    const filter = {};
    if (crop) filter.crop = crop;
    if (status && status !== 'all') filter.status = status;
    if (district) {
      // pickup_location is a hierarchical string; a loose match on district
      // is good enough here since we never write to this collection.
      filter.pickup_location = { $regex: district, $options: 'i' };
    }

    const [rows, total] = await Promise.all([
      TransactionReadOnly.find(filter)
        .populate('farmer', 'name mobile district village marketplaceId')
        .populate('buyer', 'name companyName mobile district village marketplaceId')
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
// distance from the partner's base or detected device GPS location.
router.get('/sorted-by-distance', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const partner = await User.findById(req.user.id).lean();
    if (!partner) return res.status(404).json({ error: 'Partner not found' });

    // Determine base location: GPS coordinates from browser Geolocation API take priority,
    // otherwise fallback to partner.baseLocation from profile or Maharashtra central default.
    let base;
    if (req.query.lat && req.query.lng && !isNaN(parseFloat(req.query.lat)) && !isNaN(parseFloat(req.query.lng))) {
      base = {
        lat: parseFloat(req.query.lat),
        lng: parseFloat(req.query.lng),
        location: 'Current Geolocation',
        source: 'gps',
      };
    } else {
      try {
        base = await geocodePlace(partner.baseLocation || 'Nashik, Maharashtra');
      } catch (e) {
        base = { lat: 19.9975, lng: 73.7898, location: partner.baseLocation || 'Maharashtra, India', source: 'default' };
      }
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
    const docs = await TransactionReadOnly.find({ _id: { $in: pageItems.map((p) => p.id) } })
      .populate('farmer', 'name mobile district village marketplaceId')
      .populate('buyer', 'name companyName mobile district village marketplaceId')
      .lean();
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
    const transaction = await TransactionReadOnly.findById(req.params.id)
      .populate('farmer', 'name mobile district village marketplaceId')
      .populate('buyer', 'name companyName mobile district village marketplaceId')
      .lean();
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

    // Cost/time estimate for every vehicle type
    const estimates = Object.entries(vehicleRates).map(([key, rate]) => ({
      vehicleType: key,
      label: rate.label,
      distanceKm: distancePickupToDeliveryKm,
      estimatedCost: round1(distancePickupToDeliveryKm * rate.dieselCostPerKm),
      estimatedTransitHours: round1(distancePickupToDeliveryKm / rate.avgSpeedKmph),
    }));

    res.json({
      transactionId: transaction._id,
      farmer_id: transaction.farmer_id || transaction.farmer?.marketplaceId,
      buyer_id: transaction.buyer_id || transaction.buyer?.marketplaceId,
      farmerMongoId: String(transaction.farmer?._id || transaction.farmer || ''),
      buyerMongoId: String(transaction.buyer?._id || transaction.buyer || ''),
      farmerName: transaction.farmer?.name || 'Farmer',
      buyerName: transaction.buyer?.name || transaction.buyer?.companyName || 'Buyer',
      farmerMobile: transaction.farmer?.mobile,
      buyerMobile: transaction.buyer?.mobile,
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

// Helper to generate collision-resistant unique shipment code (e.g. SHV-7B3-4)
async function generateUniqueShipmentCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 10; attempt++) {
    let randPart = '';
    for (let i = 0; i < 4; i++) {
      randPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const digit = Math.floor(1 + Math.random() * 9);
    const code = `SHV-${randPart}-${digit}`;
    const exists = await TransactionReadOnly.exists({ shipment_code: code });
    if (!exists) return code;
  }
  return `SHV-${Date.now().toString(36).slice(-4).toUpperCase()}-1`;
}

// POST /api/logistics/transactions/:id/confirm-logistics
// Core action: Logistics partner officially confirms pickup and delivery.
// Generates unique shipment code, calculates physical gunny bags / sacks count,
// sets status to 'logistics_confirmed', and dispatches system messages to both
// Farmer and Buyer via the existing messaging architecture and Socket.io.
router.post('/:id/confirm-logistics', async (req, res) => {
  try {
    const tx = await TransactionReadOnly.findById(req.params.id)
      .populate('farmer', 'name mobile marketplaceId district')
      .populate('buyer', 'name companyName mobile marketplaceId district');

    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    // Prevent conflict if already assigned to a different logistics partner
    if (tx.logisticsPartner && String(tx.logisticsPartner) !== req.user.id) {
      return res.status(409).json({ error: 'This shipment has already been confirmed by another logistics partner.' });
    }

    const partner = await User.findById(req.user.id);
    if (!partner) return res.status(404).json({ error: 'Logistics partner not found' });

    // Generate or reuse unique shipment code
    const shipmentCode = tx.shipment_code || (await generateUniqueShipmentCode());
    // Estimate physical sacks (gunny bags): standard Indian metric is 20 bags of 50kg each per metric ton
    const sacksCount = tx.sacks_count || Math.max(1, Math.round((tx.quantity_tons || 1) * 20));

    tx.logisticsPartner = req.user.id;
    tx.logistics_id = partner.marketplaceId || null;
    tx.status = 'logistics_confirmed';
    tx.shipment_code = shipmentCode;
    tx.logistics_confirmed_at = tx.logistics_confirmed_at || new Date();
    tx.sacks_count = sacksCount;
    await tx.save();

    const farmerId = String(tx.farmer?._id || tx.farmer);
    const buyerId = String(tx.buyer?._id || tx.buyer);
    const logisticsId = String(req.user.id);
    const partnerName = partner.name || 'Maharashtra State Agri Logistics';

    // ── 1. Create or link Conversation with Farmer (farmer_logistics) ──
    let farmerConv = await Conversation.findOne({
      transaction: tx._id,
      type: 'farmer_logistics',
    });
    if (!farmerConv) {
      farmerConv = await Conversation.create({
        type: 'farmer_logistics',
        transaction: tx._id,
        listing: tx.listing,
        participants: [farmerId, logisticsId],
        lastMessage: {
          text: `Logistics Confirmed: Shipment Code ${shipmentCode}`,
          sender: logisticsId,
          createdAt: new Date(),
        },
      });
    }

    const farmerMsgText = `📦 LOGISTICS CONFIRMED: ${partnerName} has confirmed pickup for your transaction (${tx.crop}, ${tx.quantity_tons} tons).\n\n🏷️ Shipment Identification Code: ${shipmentCode}\n\n⚠️ INSTRUCTION FOR FARMER: Please write "${shipmentCode}" clearly on every sack/gunny bag (approx. ${sacksCount} Sacks (Gunny Bags)) included in this shipment for physical traceability at pickup.`;

    const farmerLegacyId = buildLogisticsConversationId(tx._id, logisticsId, farmerId);
    const farmerMsg = await Message.create({
      conversation: farmerConv._id,
      conversationId: farmerLegacyId || String(farmerConv._id),
      sender: logisticsId,
      receiver: farmerId,
      text: farmerMsgText,
    });
    farmerConv.lastMessage = {
      text: farmerMsgText,
      sender: logisticsId,
      createdAt: farmerMsg.createdAt,
    };
    await farmerConv.save();

    // ── 2. Create or link Conversation with Buyer (buyer_logistics) ──
    let buyerConv = await Conversation.findOne({
      transaction: tx._id,
      type: 'buyer_logistics',
    });
    if (!buyerConv) {
      buyerConv = await Conversation.create({
        type: 'buyer_logistics',
        transaction: tx._id,
        listing: tx.listing,
        participants: [buyerId, logisticsId],
        lastMessage: {
          text: `Logistics Confirmed: Shipment Code ${shipmentCode}`,
          sender: logisticsId,
          createdAt: new Date(),
        },
      });
    }

    const buyerMsgText = `🚚 LOGISTICS CONFIRMED: ${partnerName} has confirmed delivery fulfillment for your transaction (${tx.crop}, ${tx.quantity_tons} tons).\n\n🏷️ Shipment Identification Code: ${shipmentCode}\n\nVerify that all delivered Sacks (Gunny Bags) bear this code upon physical receipt.`;

    const buyerLegacyId = buildLogisticsConversationId(tx._id, logisticsId, buyerId);
    const buyerMsg = await Message.create({
      conversation: buyerConv._id,
      conversationId: buyerLegacyId || String(buyerConv._id),
      sender: logisticsId,
      receiver: buyerId,
      text: buyerMsgText,
    });
    buyerConv.lastMessage = {
      text: buyerMsgText,
      sender: logisticsId,
      createdAt: buyerMsg.createdAt,
    };
    await buyerConv.save();

    // ── 3. Real-time Socket.IO Broadcast to all participants ──
    const io = req.app.get('io');
    if (io) {
      const emitToThread = (conv, msg, receiverId) => {
        const payload = {
          _id: msg._id,
          id: msg._id,
          conversationId: String(conv._id),
          legacyConversationId: msg.conversationId,
          sender: logisticsId,
          receiver: String(receiverId),
          senderName: partnerName,
          senderRole: 'logistics',
          text: msg.text,
          createdAt: msg.createdAt,
          crop: tx.crop,
          transaction: String(tx._id),
          shipment_code: shipmentCode,
        };

        io.to(`conversation_${conv._id}`)
          .to(`user_${logisticsId}`)
          .to(`user_${receiverId}`)
          .emit('new_message', payload);

        io.to(`conversation_${conv._id}`)
          .to(`user_${logisticsId}`)
          .to(`user_${receiverId}`)
          .emit('logistics_new_message', payload);
      };

      emitToThread(farmerConv, farmerMsg, farmerId);
      emitToThread(buyerConv, buyerMsg, buyerId);

      // Broadcast shipment confirmation event for live UI reactivity
      const eventData = {
        transactionId: String(tx._id),
        shipment_code: shipmentCode,
        status: 'logistics_confirmed',
        sacks_count: sacksCount,
        logisticsPartner: { id: partner._id, name: partnerName },
      };
      io.to(`user_${farmerId}`)
        .to(`user_${buyerId}`)
        .to(`user_${logisticsId}`)
        .emit('shipment_confirmed', eventData);
    }

    res.json({
      message: 'Logistics confirmed successfully',
      transaction: tx,
      shipment_code: shipmentCode,
      sacks_count: sacksCount,
      farmerNotification: farmerMsgText,
      buyerNotification: buyerMsgText,
    });
  } catch (err) {
    console.error('❌ /api/logistics/transactions/:id/confirm-logistics error:', err);
    res.status(500).json({ error: 'Could not confirm logistics', detail: err.message });
  }
});

// POST /api/logistics/transactions/:id/claim
// Backward compatibility: forwards to confirm-logistics logic
router.post('/:id/claim', async (req, res, next) => {
  // Delegate to confirm-logistics
  req.url = `/${req.params.id}/confirm-logistics`;
  router.handle(req, res, next);
});

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = router;