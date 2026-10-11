const express = require('express');
const router = express.Router();

// Nexora Agrotech — Price Estimate route.
// Forwards crop/variety/district/quantity payloads to the standalone
// price ML service (ml-price-service/app.py, FastAPI) and relays the
// estimate back to the frontend.
// Set PRICE_SERVICE_URL in your .env once deployed.
const PRICE_SERVICE_URL = process.env.PRICE_SERVICE_URL || 'http://localhost:8002';

// ── Crop/variety/district/quantity -> price estimate ──
router.post('/estimate', async (req, res) => {
  try {
    const mlRes = await fetch(`${PRICE_SERVICE_URL}/price-estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await mlRes.json();
    if (!mlRes.ok) return res.status(mlRes.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('Price service error (estimate):', err.message);
    res.status(502).json({ error: 'Price service unavailable', detail: err.message });
  }
});

module.exports = router;