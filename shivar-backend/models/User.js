const mongoose = require('mongoose');

// Sub-document: a logistics partner can register multiple vehicles
const vehicleSchema = new mongoose.Schema({
  vehicleNumber: { type: String, required: true, trim: true, uppercase: true },
  vehicleType: {
    type: String,
    required: true,
    enum: ['mini_truck', 'small_pickup', 'light_pickup', 'medium_truck', 'heavy_truck'],
  },
}, { _id: true });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  mobile: {
    type: String,
    required: true,
    trim: true,
    // Accepts 10-digit Indian mobile with or without leading +91 or 0
    match: [/^(?:\+91|0)?[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'],
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Enter a valid email'],
  },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['farmer', 'buyer', 'logistics'], required: true },
  
  marketplaceId: {
    type: String,
    trim: true,
    uppercase: true,
  },

  // Agricultural / Geographic cluster info
  vibhagCluster: { type: String, trim: true },
  district: { type: String, default: 'India', trim: true },
  taluka: { type: String, trim: true },
  village: { type: String, trim: true },
  primaryCrop: { type: String, trim: true },

  // Email verification & OTP
  isVerified: { type: Boolean, default: false },
  otpCode: { type: String },
  otpExpiresAt: { type: Date },

  // Identity documents (display last 4 only)
  aadhaarLast4: { type: String },
  panNumber: { type: String },

  // Farmer specific profile fields
  state: { type: String, trim: true },
  landRecord: { type: String, trim: true },
  landAreaAcres: { type: Number },
  ownershipNo: { type: String, trim: true },

  // Buyer specific profile fields
  companyName: { type: String, trim: true },
  gstNumber: { type: String, trim: true },
  industryType: { type: String, trim: true },

  // Logistics partner specific fields
  baseLocation: { type: String, trim: true },
  vehicles: { type: [vehicleSchema], default: undefined },

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
});

// Partial unique index for marketplaceId (only when non-null)
userSchema.index({ marketplaceId: 1 }, { unique: true, sparse: true });

// Compound unique index for mobile + role (allows 199 shared contacts between farmer and buyer roles)
userSchema.index({ mobile: 1, role: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);