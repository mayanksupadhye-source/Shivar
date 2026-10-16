/**
 * SHIVAR — Mandi Price Service & Route Tests
 *
 * Run with:  node shivar-backend/tests/mandiPrices.test.js
 *
 * These tests mock the fetch() global to avoid calling the live
 * data.gov.in API. They validate response normalization, error handling,
 * caching, and route behaviour.
 */

const assert = require('assert');

// ── Mock helpers ──
let mockFetchResponse = null;
let mockFetchError = null;
let fetchCallCount = 0;
let lastFetchUrl = '';

// Save and replace global fetch
const originalFetch = globalThis.fetch;

function installMockFetch() {
  fetchCallCount = 0;
  lastFetchUrl = '';
  globalThis.fetch = async (url, opts) => {
    fetchCallCount++;
    lastFetchUrl = url;
    if (mockFetchError) throw mockFetchError;
    return {
      ok: mockFetchResponse.ok ?? true,
      status: mockFetchResponse.status ?? 200,
      json: async () => mockFetchResponse.body,
    };
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ── Load the service ──
// Set a fake API key so the service doesn't short-circuit
process.env.DATA_GOV_IN_API_KEY = 'test_key_for_unit_tests';

const {
  fetchMandiPrices,
  getFilterOptions,
  clearCache,
} = require('../services/mandiPriceService');

// ── Test runner ──
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function runTests() {
  console.log('\n🧪 Mandi Price Tests\n' + '═'.repeat(50));
  let passed = 0, failed = 0;

  for (const t of tests) {
    clearCache();
    installMockFetch();
    mockFetchResponse = null;
    mockFetchError = null;

    try {
      await t.fn();
      console.log(`  ✅ ${t.name}`);
      passed++;
    } catch (err) {
      console.log(`  ❌ ${t.name}`);
      console.log(`     ${err.message}`);
      failed++;
    }
  }

  restoreFetch();
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  ${passed} passed, ${failed} failed, ${tests.length} total`);
  console.log('═'.repeat(50) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

// ══════════════════════════════════════
// TESTS
// ══════════════════════════════════════

test('successful fetch returns normalized records', async () => {
  mockFetchResponse = {
    ok: true,
    status: 200,
    body: {
      status: 'ok',
      total: 2,
      limit: '50',
      offset: '0',
      records: [
        {
          state: 'Maharashtra',
          district: 'Nashik',
          market: 'APMC Nasik',
          commodity: 'Onion',
          variety: 'Red',
          grade: 'FAQ',
          arrival_date: '16/10/2026',
          min_price: 1500,
          max_price: 5000,
          modal_price: 3000,
        },
        {
          state: 'Maharashtra',
          district: 'Pune',
          market: 'APMC Pune',
          commodity: 'Soyabean',
          variety: 'Yellow',
          grade: 'FAQ',
          arrival_date: '16/10/2026',
          min_price: 6500,
          max_price: 7000,
          modal_price: 6800,
        },
      ],
    },
  };

  const result = await fetchMandiPrices({ state: 'Maharashtra' });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.records.length, 2);
  assert.strictEqual(result.total, 2);

  const r0 = result.records[0];
  assert.strictEqual(r0.state, 'Maharashtra');
  assert.strictEqual(r0.commodity, 'Onion');
  assert.strictEqual(r0.minPrice, 1500);
  assert.strictEqual(r0.maxPrice, 5000);
  assert.strictEqual(r0.modalPrice, 3000);
  assert.strictEqual(r0.market, 'APMC Nasik');
  assert.strictEqual(r0.variety, 'Red');

  assert.ok(result.dataSource.includes('AGMARKNET'));
  assert.strictEqual(result.priceUnit, '₹ per Quintal');
});

test('state filter is passed as URL parameter', async () => {
  mockFetchResponse = { ok: true, status: 200, body: { status: 'ok', total: 0, records: [] } };

  await fetchMandiPrices({ state: 'Maharashtra', commodity: 'Onion' });

  assert.ok(lastFetchUrl.includes('filters%5Bstate%5D=Maharashtra'));
  assert.ok(lastFetchUrl.includes('filters%5Bcommodity%5D=Onion'));
});

test('empty results return success with empty array', async () => {
  mockFetchResponse = { ok: true, status: 200, body: { status: 'ok', total: 0, limit: '50', offset: '0', records: [] } };

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.records.length, 0);
  assert.strictEqual(result.total, 0);
});

test('missing API key returns descriptive error', async () => {
  const saved = process.env.DATA_GOV_IN_API_KEY;
  process.env.DATA_GOV_IN_API_KEY = '';

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'MISSING_API_KEY');
  assert.ok(result.error.includes('not configured'));

  process.env.DATA_GOV_IN_API_KEY = saved;
});

test('HTTP 401 returns AUTH_ERROR', async () => {
  mockFetchResponse = { ok: false, status: 401, body: { message: 'Unauthorized' } };

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'AUTH_ERROR');
});

test('HTTP 429 returns RATE_LIMITED', async () => {
  mockFetchResponse = { ok: false, status: 429, body: {} };

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'RATE_LIMITED');
});

test('HTTP 500 returns SERVER_ERROR', async () => {
  mockFetchResponse = { ok: false, status: 500, body: {} };

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'SERVER_ERROR');
});

test('network error returns NETWORK_ERROR', async () => {
  mockFetchError = new Error('ECONNREFUSED');

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.errorCode, 'NETWORK_ERROR');
  assert.ok(result.error.includes('ECONNREFUSED'));
});

test('caching returns fromCache on second call', async () => {
  mockFetchResponse = {
    ok: true,
    status: 200,
    body: { status: 'ok', total: 1, limit: '50', offset: '0', records: [{ state: 'Test', commodity: 'Rice', min_price: 100, max_price: 200, modal_price: 150 }] },
  };

  const r1 = await fetchMandiPrices({ state: 'Test' });
  assert.strictEqual(r1.success, true);
  assert.strictEqual(r1.fromCache, undefined);
  assert.strictEqual(fetchCallCount, 1);

  const r2 = await fetchMandiPrices({ state: 'Test' });
  assert.strictEqual(r2.success, true);
  assert.strictEqual(r2.fromCache, true);
  assert.strictEqual(fetchCallCount, 1); // should NOT have called fetch again
});

test('clearCache forces refetch', async () => {
  mockFetchResponse = {
    ok: true,
    status: 200,
    body: { status: 'ok', total: 1, limit: '50', offset: '0', records: [{ state: 'A', commodity: 'B', min_price: 1, max_price: 2, modal_price: 1 }] },
  };

  await fetchMandiPrices({ state: 'A' });
  assert.strictEqual(fetchCallCount, 1);

  clearCache();
  await fetchMandiPrices({ state: 'A' });
  assert.strictEqual(fetchCallCount, 2);
});

test('normalizeRecord handles missing fields gracefully', async () => {
  mockFetchResponse = {
    ok: true,
    status: 200,
    body: {
      status: 'ok',
      total: 1,
      limit: '50',
      offset: '0',
      records: [{ state: 'X' }], // missing almost everything
    },
  };

  const result = await fetchMandiPrices();
  assert.strictEqual(result.success, true);
  const r = result.records[0];
  assert.strictEqual(r.state, 'X');
  assert.strictEqual(r.commodity, '');
  assert.strictEqual(r.minPrice, null);
  assert.strictEqual(r.maxPrice, null);
  assert.strictEqual(r.modalPrice, null);
});

test('pagination offset and limit are passed correctly', async () => {
  mockFetchResponse = { ok: true, status: 200, body: { status: 'ok', total: 0, records: [] } };

  await fetchMandiPrices({ limit: 25, offset: 50 });
  assert.ok(lastFetchUrl.includes('limit=25'));
  assert.ok(lastFetchUrl.includes('offset=50'));
});

test('getFilterOptions extracts unique states and commodities', async () => {
  mockFetchResponse = {
    ok: true,
    status: 200,
    body: {
      status: 'ok',
      total: 3,
      limit: '500',
      offset: '0',
      records: [
        { state: 'Maharashtra', commodity: 'Onion', district: 'Nashik' },
        { state: 'Karnataka', commodity: 'Rice', district: 'Mysore' },
        { state: 'Maharashtra', commodity: 'Rice', district: 'Pune' },
      ],
    },
  };

  const result = await getFilterOptions();
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.states, ['Karnataka', 'Maharashtra']);
  assert.deepStrictEqual(result.commodities, ['Onion', 'Rice']);
});

// ── Run ──
runTests();
