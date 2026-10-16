/**
 * SHIVAR — Mandi Price Service
 * Fetches daily commodity prices from the data.gov.in API
 * (Ministry of Agriculture / AGMARKNET upstream data).
 *
 * Data is updated daily by the government; this is NOT intraday pricing.
 * Prices are in ₹ per quintal as reported by the source APMC mandis.
 */

// ── In-memory cache with TTL ──
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const DATA_GOV_RESOURCE_ID = '9ef84268-d588-465a-a308-a864a43d0070';
const DATA_GOV_BASE_URL = 'https://api.data.gov.in/resource';
const REQUEST_TIMEOUT_MS = 15000; // 15 seconds

/**
 * Build a cache key from query parameters.
 */
function buildCacheKey(params) {
  const parts = ['mandi'];
  if (params.state) parts.push(`s:${params.state}`);
  if (params.district) parts.push(`d:${params.district}`);
  if (params.market) parts.push(`m:${params.market}`);
  if (params.commodity) parts.push(`c:${params.commodity}`);
  if (params.limit) parts.push(`l:${params.limit}`);
  if (params.offset) parts.push(`o:${params.offset}`);
  return parts.join('|').toLowerCase();
}

/**
 * Fetch mandi prices from the data.gov.in API.
 *
 * @param {Object} params - Query parameters
 * @param {string} [params.state] - State filter (e.g. "Maharashtra")
 * @param {string} [params.district] - District filter
 * @param {string} [params.market] - Market/mandi filter
 * @param {string} [params.commodity] - Commodity filter
 * @param {number} [params.limit=50] - Max records to return
 * @param {number} [params.offset=0] - Pagination offset
 * @returns {Promise<Object>} Normalized response
 */
async function fetchMandiPrices(params = {}) {
  const apiKey = process.env.DATA_GOV_IN_API_KEY;

  if (!apiKey || apiKey === 'your_data_gov_in_api_key_here') {
    return {
      success: false,
      error: 'DATA_GOV_IN_API_KEY is not configured. Register at https://data.gov.in to obtain a free API key.',
      errorCode: 'MISSING_API_KEY',
      records: [],
      total: 0,
    };
  }

  // ── Check cache ──
  const cacheKey = buildCacheKey(params);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return { ...cached.data, fromCache: true };
  }

  // ── Build URL ──
  const url = new URL(`${DATA_GOV_BASE_URL}/${DATA_GOV_RESOURCE_ID}`);
  url.searchParams.set('api-key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', String(params.limit || 50));
  url.searchParams.set('offset', String(params.offset || 0));

  if (params.state) url.searchParams.set('filters[state]', params.state);
  if (params.district) url.searchParams.set('filters[district]', params.district);
  if (params.market) url.searchParams.set('filters[market]', params.market);
  if (params.commodity) url.searchParams.set('filters[commodity]', params.commodity);

  // ── Fetch with timeout ──
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return {
        success: false,
        error: 'Request to data.gov.in timed out. The government API may be slow or unavailable.',
        errorCode: 'TIMEOUT',
        records: [],
        total: 0,
      };
    }
    return {
      success: false,
      error: `Could not reach data.gov.in: ${err.message}`,
      errorCode: 'NETWORK_ERROR',
      records: [],
      total: 0,
    };
  } finally {
    clearTimeout(timeout);
  }

  // ── Handle HTTP errors ──
  if (!response.ok) {
    const status = response.status;
    let errorMsg = `data.gov.in returned HTTP ${status}`;
    let errorCode = 'API_ERROR';

    if (status === 401 || status === 403) {
      errorMsg = 'API key is invalid or expired. Please check your DATA_GOV_IN_API_KEY.';
      errorCode = 'AUTH_ERROR';
    } else if (status === 429) {
      errorMsg = 'Rate limit exceeded on data.gov.in. Please try again later.';
      errorCode = 'RATE_LIMITED';
    } else if (status >= 500) {
      errorMsg = 'data.gov.in is experiencing server issues. Please try again later.';
      errorCode = 'SERVER_ERROR';
    }

    return { success: false, error: errorMsg, errorCode, records: [], total: 0 };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return {
      success: false,
      error: 'Invalid JSON response from data.gov.in.',
      errorCode: 'PARSE_ERROR',
      records: [],
      total: 0,
    };
  }

  if (body.status !== 'ok') {
    return {
      success: false,
      error: body.message || 'Unexpected response from data.gov.in.',
      errorCode: 'API_ERROR',
      records: [],
      total: 0,
    };
  }

  // ── Normalize records ──
  const records = (body.records || []).map(normalizeRecord);

  const result = {
    success: true,
    total: body.total || 0,
    count: records.length,
    limit: parseInt(body.limit, 10) || 50,
    offset: parseInt(body.offset, 10) || 0,
    records,
    dataSource: 'data.gov.in (Ministry of Agriculture / AGMARKNET)',
    dataFreshness: 'Daily — updated once per trading day by AGMARKNET',
    priceUnit: '₹ per Quintal',
    lastFetched: new Date().toISOString(),
  };

  // ── Store in cache ──
  cache.set(cacheKey, { data: result, timestamp: Date.now() });

  return result;
}

/**
 * Normalize a raw API record into a consistent format.
 */
function normalizeRecord(raw) {
  return {
    state: (raw.state || '').trim(),
    district: (raw.district || '').trim(),
    market: (raw.market || '').trim(),
    commodity: (raw.commodity || '').trim(),
    variety: (raw.variety || '').trim(),
    grade: (raw.grade || '').trim(),
    arrivalDate: (raw.arrival_date || '').replace(/\\\//g, '/'),
    minPrice: raw.min_price != null ? Number(raw.min_price) : null,
    maxPrice: raw.max_price != null ? Number(raw.max_price) : null,
    modalPrice: raw.modal_price != null ? Number(raw.modal_price) : null,
  };
}

/**
 * Get the list of distinct states from a recent fetch (for filter dropdowns).
 * Uses a cached full-fetch approach.
 */
async function getFilterOptions() {
  const apiKey = process.env.DATA_GOV_IN_API_KEY;
  if (!apiKey || apiKey === 'your_data_gov_in_api_key_here') {
    return {
      success: false,
      error: 'API key not configured.',
      states: [],
      commodities: [],
    };
  }

  const cacheKey = 'filter_options';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS * 4) {
    return { ...cached.data, fromCache: true };
  }

  // Fetch a large batch to extract unique values
  const result = await fetchMandiPrices({ limit: 500 });
  if (!result.success) {
    return { success: false, error: result.error, states: [], commodities: [] };
  }

  const states = [...new Set(result.records.map(r => r.state).filter(Boolean))].sort();
  const commodities = [...new Set(result.records.map(r => r.commodity).filter(Boolean))].sort();
  const districts = [...new Set(result.records.map(r => r.district).filter(Boolean))].sort();

  const data = {
    success: true,
    states,
    commodities,
    districts,
    dataSource: 'data.gov.in (Ministry of Agriculture / AGMARKNET)',
  };

  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

/**
 * Clear the entire price cache (useful for admin/testing).
 */
function clearCache() {
  cache.clear();
}

module.exports = {
  fetchMandiPrices,
  getFilterOptions,
  clearCache,
};
