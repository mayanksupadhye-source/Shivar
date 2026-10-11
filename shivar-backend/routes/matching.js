const express = require('express');
const router = express.Router();

// Nexora Agrotech — Smart Matching route.
// Forwards buyer/farmer requirement payloads to the standalone ML service
// (ml-model/app.py, FastAPI) and relays its ranked results back to the frontend.
// Set ML_SERVICE_URL in your .env once deployed (e.g. Render URL for the ML service).
const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';

// ── Buyer requirement -> ranked farmer listings ──
router.post('/buyer-to-farmer', async (req, res) => {
  try {
    const mlRes = await fetch(`${ML_SERVICE_URL}/match/buyer-to-farmer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await mlRes.json();
    if (!mlRes.ok) return res.status(mlRes.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('ML service error (buyer-to-farmer):', err.message);
    res.status(502).json({ error: 'Matching service unavailable', detail: err.message });
  }
});

// ── Farmer listing -> ranked buyer demands ──
router.post('/farmer-to-buyer', async (req, res) => {
  try {
    const mlRes = await fetch(`${ML_SERVICE_URL}/match/farmer-to-buyer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await mlRes.json();
    if (!mlRes.ok) return res.status(mlRes.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('ML service error (farmer-to-buyer):', err.message);
    res.status(502).json({ error: 'Matching service unavailable', detail: err.message });
  }
});

module.exports = router;
