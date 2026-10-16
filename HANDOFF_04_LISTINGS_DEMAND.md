# Milestone Handoff 04: Listings & Demand Subsystems

## 1. Overview
This milestone establishes the agricultural marketplace listing and crop demand APIs for SHIVAR, bridging farmer crop supply and buyer industrial demand.

## 2. Implemented Components

### 2.1 Listings API (`shivar-backend/routes/listings.js`)
- **GET `/api/listings`**:
  - Filterable by `crop`, `variety`, `cluster`, `district`, and `farmer` (supporting both MongoDB `_id` and business ID `F0001`).
  - Safe default bounded query (100 items) to prevent UI lockup when querying 7,000+ listings.
  - Optional pagination parameters (`page`, `limit`) returning `{ page, limit, total, totalPages, listings }`.
  - Exposes total count in HTTP header `X-Total-Count`.
- **GET `/api/listings/:id`**: Populates farmer details (`name`, `district`, `village`, `taluka`, `mobile`, `marketplaceId`).
- **POST `/api/listings`** (Farmer only):
  - Validates crop, quantity, and price.
  - Automatically enriches listing with farmer profile location hierarchy (`cluster`, `district`, `taluka`, `village`).
  - Sets initial status to `'available'`.
- **PUT `/api/listings/:id`** (Farmer only, Owner only):
  - Strict ownership check preventing Insecure Direct Object References (IDOR).
  - Strict field allowlist: only allows updating `crop`, `variety`, `quantity_tonnes`, `price_per_quintal`, `description`, `harvest_date`, `cluster`, `district`, `taluka`, `village`, `status`. Blocked from modifying `farmer`, `_id`, or `listing_id`.
- **DELETE `/api/listings/:id`** (Farmer only, Owner only): Idempotent deletion after ownership verification.

### 2.2 Buyer Demand API (`shivar-backend/routes/demand.js`)
- **GET `/api/demand`**:
  - Open to both Farmers and Buyers.
  - Filterable by `crop`, `variety`, `cluster`, `district`, and `buyer`.
  - Supports both bounded raw array and paginated metadata response.
- **GET `/api/demand/:id`**: Fetches single demand and populates buyer company info.
- **POST `/api/demand`** (Buyer only):
  - Accepts `required_quantity_tons` / `quantity` and `maximum_price_per_quintal` / `maxPrice`.
  - Enriches demand with buyer's business profile and location hierarchy.
  - Sets initial status to `'open'`.
- **PUT `/api/demand/:id`** & **DELETE `/api/demand/:id`** (Buyer only, Owner only): Strict ownership check and field allowlist.

### 2.3 Compatibility Virtuals
Both Mongoose models expose getter virtuals so legacy frontend components function without modification:
- `Listing`: `quantity` -> `quantity_tonnes`, `pricePerUnit` -> `price_per_quintal`, `unit` -> `'tonne'`.
- `Demand`: `quantity` -> `required_quantity_tons`, `maxPrice` -> `maximum_price_per_quintal`.

## 3. Verification
Verified via automated E2E test suite:
- Farmer F0001 created listing via `POST /api/listings`.
- Buyer discovered listing using filters (`crop=Soybean&district=Nanded`).
- Buyer B0001 created crop demand via `POST /api/demand`.
- Farmer discovered demand using filter (`crop=Cotton`).
- IDOR attack verified: Farmer F0002 blocked with HTTP 403 when attempting to tamper with F0001's listing.
