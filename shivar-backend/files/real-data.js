/**
 * REAL DATA TEMPLATE
 * Fill this in with real farmers, buyers, and crop listings you actually know about.
 * Every array below follows a strict format — copy an existing entry and edit its values,
 * don't invent new field names, or the seed script won't understand it.
 *
 * You can have anywhere from a few entries to 100+ in each array — there's no fixed limit.
 * When you're done editing this file, run: npm run seed:real
 */

// ══════════════════════════════════════════
// FARMERS
// One entry per real (or realistic) farmer. Password is the same for all of them
// unless you want to set individual ones — doesn't matter for a hackathon demo.
// ══════════════════════════════════════════
const farmers = [
  {
    name: "Ramesh Patil",
    mobile: "9876543210",      // must be 10 digits, start with 6-9
    email: "ramesh.demo@nexora.in",
    password: "farm123",       // any password, min 8 characters
    district: "Nashik",
  },
  {
    name: "Suresh Borate",
    mobile: "9822011122",
    email: "suresh.demo@nexora.in",
    password: "farm123",
    district: "Aurangabad",
  },
  // ── ADD MORE FARMERS BELOW, following the exact same shape ──
  // {
  //   name: "",
  //   mobile: "",
  //   email: "",
  //   password: "farm123",
  //   district: "",
  // },
];

// ══════════════════════════════════════════
// BUYERS
// Same idea — real or realistic buyer/company accounts.
// ══════════════════════════════════════════
const buyers = [
  {
    name: "Anjali Traders",
    mobile: "9876500000",
    email: "buyer.demo@nexora.in",
    password: "buy123",
    district: "Pune",
    companyName: "Anjali Agro Traders Pvt Ltd",
  },
  // ── ADD MORE BUYERS BELOW ──
  // {
  //   name: "",
  //   mobile: "",
  //   email: "",
  //   password: "buy123",
  //   district: "",
  //   companyName: "",
  // },
];

// ══════════════════════════════════════════
// LISTINGS
// This is where most of your 100-200 entries will actually come from.
// "farmerMobile" MUST match the "mobile" of a farmer you defined above —
// that's how the script knows which farmer owns which listing.
// ══════════════════════════════════════════
const listings = [
  {
    farmerMobile: "9876543210",   // must match a farmer above
    crop: "Cotton",
    quantity: 50,
    unit: "quintal",              // quintal, kg, ton — your choice
    pricePerUnit: 6800,           // in rupees
    soilType: "Black Cotton Soil",
    region: "Malegaon",
    district: "Nashik",
    description: "Premium BT cotton, harvested this Kharif season.",
  },
  {
    farmerMobile: "9876543210",
    crop: "Onion",
    quantity: 30,
    unit: "quintal",
    pricePerUnit: 1800,
    soilType: "Loamy",
    region: "Lasalgaon",
    district: "Nashik",
    description: "Fresh red onion, well-stored.",
  },
  {
    farmerMobile: "9822011122",
    crop: "Wheat",
    quantity: 100,
    unit: "quintal",
    pricePerUnit: 2450,
    soilType: "Alluvial",
    region: "Aurangabad",
    district: "Aurangabad",
    description: "Sharbati wheat, Grade A.",
  },
  // ── ADD MORE LISTINGS BELOW — this is the array to bulk out to 100-200 ──
  // {
  //   farmerMobile: "",     // must exactly match a mobile from the farmers array above
  //   crop: "",
  //   quantity: 0,
  //   unit: "quintal",
  //   pricePerUnit: 0,
  //   soilType: "",
  //   region: "",
  //   district: "",
  //   description: "",
  // },
];

module.exports = { farmers, buyers, listings };
