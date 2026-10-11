// Uses the global fetch() built into Node 18+. If you're on an older Node
// version, global fetch is undefined and every geocode call fails — this
// throws a clear, specific error instead of a cryptic 500 so it's obvious
// what to fix (upgrade Node, or `npm install node-fetch` and uncomment the
// fallback below).
const fetchFn = typeof fetch === 'function' ? fetch : null;
// const fetchFn = require('node-fetch'); // ← uncomment this line instead if you're on Node < 18

const LocationCache = require('../models/LocationCache');

function assertFetchAvailable() {
  if (!fetchFn) {
    throw new Error(
      'global fetch() is not available in this Node version. Run `node -v` — if it\'s below 18, either upgrade Node or run `npm install node-fetch` and switch the fetchFn line at the top of utils/geocode.js.',
    );
  }
}

// Assumption (per spec §3): no GOOGLE_MAPS_API_KEY was provided, so this
// defaults to OpenStreetMap Nominatim (free, no key). If you later add
// GOOGLE_MAPS_API_KEY to your env, this file automatically switches to the
// Google Geocoding API — it's a drop-in swap, nothing else needs to change.
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || null;

/**
 * Real pickup/delivery strings look like:
 *   "Sakur, Sangamner, Ahilyanagar (Ahmednagar), Western Maharashtra (Desh)"
 * Nominatim's free-text search chokes on the "(old name)" and broad region
 * labels ("Western Maharashtra (Desh)") — those aren't real administrative
 * units it recognizes. Build a list of progressively simplified candidates
 * (strip parentheticals, drop the region label, fall back toward just
 * district + state) and try each until one resolves.
 */
function buildCandidateQueries(raw) {
  const stripParens = (s) => s.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const parts = stripParens(raw).split(',').map((p) => p.trim()).filter(Boolean);

  const candidates = [];
  candidates.push(`${parts.join(', ')}, India`); // full, cleaned
  for (let i = parts.length - 1; i >= 2; i--) {
    candidates.push(`${parts.slice(0, i).join(', ')}, Maharashtra, India`); // drop trailing segments one at a time — always keeps the village name (parts[0])
  }
  if (parts.length >= 1) candidates.push(`${parts[0]}, Maharashtra, India`); // village name alone, last resort
  // Deliberately NOT falling back further to "district alone" (e.g. just
  // "Ahilyanagar, Maharashtra, India"): districts always resolve in Nominatim,
  // so that fallback used to silently succeed with the DISTRICT CENTROID
  // whenever the specific village failed — meaning two different villages in
  // the same district would collapse onto the identical lat/lng and produce
  // a bogus "0 km" distance between them. An honest "could not geocode" error
  // (thrown below when every candidate here fails) is safer than a
  // convincing-looking wrong coordinate feeding into cost/time estimates.

  return [...new Set(candidates)];
}

async function geocodeViaNominatim(placeText) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(placeText)}`;

  assertFetchAvailable();
  const res = await fetchFn(url, {
    headers: {
      // Nominatim's usage policy requires a descriptive User-Agent identifying the app.
      'User-Agent': 'NexoraLogisticsPortal/1.0 (agri-marketplace logistics feature)',
    },
  });

  if (!res.ok) throw new Error(`Nominatim request failed: ${res.status}`);
  const data = await res.json();
  if (!data.length) return null;

  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), source: 'nominatim' };
}

async function geocodeViaGoogle(placeText) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(placeText)}&key=${GOOGLE_MAPS_API_KEY}`;

  assertFetchAvailable();
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Google Geocoding request failed: ${res.status}`);
  const data = await res.json();
  if (data.status !== 'OK' || !data.results.length) return null;

  const { lat, lng } = data.results[0].geometry.location;
  return { lat, lng, source: 'google' };
}

/**
 * Resolve a hierarchical place string (e.g. "Deogaon, Murbad, Thane, Konkan")
 * to { lat, lng }, checking LocationCache first and only calling the
 * external geocoding API on a cache miss. Passing the full hierarchical
 * string as one query (rather than splitting it) improves accuracy for
 * small villages that share names across districts.
 */
async function geocodePlace(placeText) {
  const cleaned = placeText.trim();
  if (!cleaned) throw new Error('geocodePlace: empty place text');

  const cached = await LocationCache.findOne({ placeText: cleaned });
  if (cached) return { lat: cached.lat, lng: cached.lng, cached: true };

  const candidates = buildCandidateQueries(cleaned);

  let result = null;
  let lastErr = null;
  for (const candidate of candidates) {
    try {
      result = GOOGLE_MAPS_API_KEY
        ? await geocodeViaGoogle(candidate)
        : await geocodeViaNominatim(candidate);
      if (result) break;
    } catch (err) {
      lastErr = err;
    }
    // Nominatim's usage policy requires max 1 request/second.
    await new Promise((r) => setTimeout(r, 1100));
  }

  if (!result) {
    throw new Error(
      lastErr
        ? `Could not geocode "${cleaned}" after trying ${candidates.length} simplified variants — last error: ${lastErr.message}`
        : `Could not geocode "${cleaned}" after trying ${candidates.length} simplified variants`,
    );
  }

  // Cache under the ORIGINAL string so every future lookup of this exact
  // pickup/delivery value is instant, even though we resolved it via a
  // simplified fallback query.
  await LocationCache.create({
    placeText: cleaned,
    lat: result.lat,
    lng: result.lng,
    source: result.source,
  });

  return { lat: result.lat, lng: result.lng, cached: false };
}

/**
 * Geocode several place strings in parallel, de-duplicating identical
 * strings within the batch (e.g. pickup === delivery for a same-village
 * transaction) so we don't fire two identical lookups at once.
 */
async function geocodeMany(placeTexts) {
  const unique = [...new Set(placeTexts.map((p) => p.trim()))];

  // Sequential, not Promise.all — Nominatim's usage policy caps requests at
  // 1/second, and geocodePlace already sleeps between its own retry
  // attempts. Running pickup/delivery/base in parallel risks tripping that
  // limit and causing the exact "could not geocode" failures we're trying
  // to eliminate. Cached lookups return instantly regardless, so this only
  // adds latency on genuine cache misses.
  const resolved = [];
  for (const p of unique) {
    resolved.push(await geocodePlace(p));
  }

  const byPlace = {};
  unique.forEach((p, i) => { byPlace[p] = resolved[i]; });

  return placeTexts.map((p) => byPlace[p.trim()]);
}

module.exports = { geocodePlace, geocodeMany };