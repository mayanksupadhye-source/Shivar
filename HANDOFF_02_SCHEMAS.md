# HANDOFF 02: Canonical Schemas & Models

## 1. What was changed
- Refactored `User` schema:
  - Added `marketplaceId` (`F####`, `B####`, `L####`) with sparse unique index.
  - Added compound unique index `{ mobile: 1, role: 1 }` to resolve the 199 shared mobile numbers between farmer and buyer roles without duplicate key errors.
  - Updated mobile regex to accept both 10-digit and standard `+91` prefixed numbers.
- Refactored `Listing` schema:
  - Added business `listing_id` (e.g. `L0001`), `farmer_id` (mirror), `variety`, `cluster`, `harvest_date`, and `listed_at`.
  - Added frontend compatibility virtuals (`quantity`, `pricePerUnit`, `unit`).
- Created `Demand` schema:
  - Added business `demand_id` (e.g. `D0001`), `buyer` (ObjectId ref), `buyer_id` (mirror), `crop`, `variety`, `required_quantity_tons`, `maximum_price_per_quintal`, `cluster`, `district`, `taluka`, `village`, and `status`.
  - Added compatibility virtuals for frontend rendering.
- Created canonical `Transaction` schema (`transactions` collection):
  - Bridges Farmer, Buyer, and Logistics Partner.
  - Retains internal MongoDB ObjectIds (`listing`, `farmer`, `buyer`, `logisticsPartner`) alongside business identifiers (`TR0001`, `L5084`, `F3242`, `B2549`).
  - Does NOT contain `demand_id` per strict specification.
  - Contains full delivery route metadata (`pickup_location`, `delivery_location`).
  - Explicit status: `pending`, `confirmed`, `assigned`, `in_transit`, `delivered`, `completed`, `cancelled`.
- Created unified `Conversation` schema:
  - Supports 3 conversation types: `farmer_buyer`, `farmer_logistics`, `buyer_logistics`.
  - References `transaction` or `listing` and array of `participants` (User `_id`).
- Refactored `Message` schema:
  - Tied directly to `Conversation` via ObjectId ref with `conversationId` string compatibility mirror.
- Updated `Bid` schema:
  - Added `transaction` ObjectId reference for accepted deals.
- Bridged `TransactionReadOnly` directly to `Transaction`.

## 2. Why it was changed
- Replaced the disconnected silos where logistics could not see deals created by farmers and buyers.
- Created a single source of truth for transactions and unified messaging.

## 3. Files changed / created
- `shivar-backend/models/User.js`
- `shivar-backend/models/Listing.js`
- `shivar-backend/models/Demand.js`
- `shivar-backend/models/Transaction.js`
- `shivar-backend/models/Conversation.js`
- `shivar-backend/models/Message.js`
- `shivar-backend/models/Bid.js`
- `shivar-backend/models/TransactionReadOnly.js`

## 4. Verification Performed
- **Automated test**: Loaded and validated all 8 models against Mongoose in Node.js.
- **Result**: `ALL MODELS COMPILED CLEANLY WITH ZERO WARNINGS!`

## 5. What the next step should do
- Proceed to **Phase 3: Auth & Identity Resolution Layer** (including `marketplaceId` mapping and `GET /api/auth/me`).
