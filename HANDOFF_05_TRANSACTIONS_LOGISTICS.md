# Milestone Handoff 05: Deals, Canonical Transactions & Logistics

## 1. Overview
This milestone establishes the transaction lifecycle for confirmed deals and logistics operations in SHIVAR.

## 2. Implemented Architecture

### 2.1 The Deal Lifecycle
1. **Farmer Posts Listing** -> Initial status: `'available'`.
2. **Buyer Submits Bid** -> `POST /api/bids` creates a pending bid linked to `listing`, `buyer`, and `farmer`.
3. **Farmer Accepts Bid** -> `PUT /api/bids/:id/accept`:
   - Idempotency Guard: Checks if a canonical transaction already exists for `bid._id`. If so, returns the existing transaction immediately.
   - Updates `bid.status = 'accepted'`.
   - Transitions `listing.status = 'sold'`.
   - Rejects other competing pending bids on the same listing (`status = 'rejected'`).
   - Automatically generates a unique business transaction ID (`TRxxxxx`).
   - Formats pickup and delivery locations from profiles and listing geography.
   - Creates a canonical `Transaction` in collection `transactions` with `status: 'confirmed'`.
   - Strictly omits `demand_id` (as dictated by architectural constraints).
   - Initializes a `farmer_buyer` thread in `Conversation`.

### 2.2 Logistics Portal Integration
- **Canonical Transactions Route (`shivar-backend/routes/transactions.js`)**:
  - `GET /api/transactions`: Role-scoped query (farmers see their sales, buyers see their purchases, logistics see all claimable confirmed deals).
  - `POST /api/transactions/:id/claim`: Logistics partner claims delivery.
- **Logistics Delivery Board (`shivar-backend/routes/logisticsTransactions.js`)**:
  - `GET /api/logistics/deliveries`: Paginated delivery board for logistics partners.
  - `POST /api/logistics/deliveries/:id/claim`: Sets `logisticsPartner: req.user.id`, `status: 'assigned'`.
  - Concurrency Guard: Returns HTTP 409 Conflict if already claimed by another partner.
- **Order Model Compatibility (`shivar-backend/models/Order.js` & `routes/orders.js`)**:
  - `Order` model now directly aliases the canonical `Transaction` collection, guaranteeing zero state divergence between old order endpoints and new transactions.

## 3. Verification
Verified via automated E2E test suite:
- Deal confirmation successfully created `Transaction` with status `'confirmed'`.
- Verified strictly no `demand_id` was written to `Transaction`.
- Listing status changed to `'sold'`.
- Repeated bid acceptance was 100% idempotent (returned existing transaction, exact count in DB remained 1).
- Logistics partner saw confirmed transaction on delivery board and claimed it.
- Transaction status transitioned to `'assigned'` and linked `logisticsPartner` ObjectId.
