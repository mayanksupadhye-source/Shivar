const express = require('express');
const router = express.Router();
const { fetchMandiPrices, getFilterOptions } = require('../services/mandiPriceService');

// ── Validate & sanitise query params ──
function sanitizeString(val) {
  if (!val || typeof val !== 'string') return undefined;
  // Strip any characters that aren't letters, digits, spaces, parens, hyphens, dots
  return val.trim().replace(/[^\w\s().\-]/g, '').substring(0, 100) || undefined;
}

/**
 * GET /api/mandi-prices
 *
 * Query parameters:
 *   state      - Filter by state name (e.g. "Maharashtra")
 *   district   - Filter by district
 *   market     - Filter by market/mandi name
 *   commodity  - Filter by commodity (e.g. "Onion", "Soyabean")
 *   limit      - Max records (default 50, max 500)
 *   offset     - Pagination offset (default 0)
 *
 * Returns daily mandi prices sourced from data.gov.in / AGMARKNET.
 */
router.get('/', async (req, res) => {
  try {
    const state = sanitizeString(req.query.state);
    const district = sanitizeString(req.query.district);
    const market = sanitizeString(req.query.market);
    const commodity = sanitizeString(req.query.commodity);

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 50;
    if (limit > 500) limit = 500;

    let offset = parseInt(req.query.offset, 10);
    if (isNaN(offset) || offset < 0) offset = 0;

    const result = await fetchMandiPrices({
      state,
      district,
      market,
      commodity,
      limit,
      offset,
    });

    if (!result.success) {
      const statusCode =
        result.errorCode === 'MISSING_API_KEY' ? 503 :
        result.errorCode === 'AUTH_ERROR' ? 502 :
        result.errorCode === 'RATE_LIMITED' ? 429 :
        result.errorCode === 'TIMEOUT' ? 504 :
        502;
      return res.status(statusCode).json(result);
    }

    res.json(result);
  } catch (err) {
    console.error('Mandi price route error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching mandi prices.',
      records: [],
      total: 0,
    });
  }
});

/**
 * GET /api/mandi-prices/filters
 *
 * Returns available states, commodities and districts for building filter dropdowns.
 */
router.get('/filters', async (req, res) => {
  try {
    const result = await getFilterOptions();
    if (!result.success) {
      return res.status(502).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('Mandi filters route error:', err.message);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
      states: [],
      commodities: [],
    });
  }
});

module.exports = router;
