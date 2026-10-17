const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { sendOtpEmail, generateOtp } = require("../utils/sendEmail");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const VALID_VEHICLE_TYPES = [
  "mini_truck",
  "small_pickup",
  "light_pickup",
  "medium_truck",
  "heavy_truck",
];

function signToken(user) {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,
      name: user.name,
      mobile: user.mobile,
      marketplaceId: user.marketplaceId || null,
    },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );
}

// Fields safe to send back to the frontend (never passwordHash, never full Aadhaar)
function publicUser(user) {
  return {
    id: user._id,
    marketplaceId: user.marketplaceId || null,
    name: user.name,
    role: user.role,
    mobile: user.mobile,
    email: user.email,
    vibhagCluster: user.vibhagCluster,
    district: user.district,
    village: user.village,
    taluka: user.taluka,
    state: user.state,
    primaryCrop: user.primaryCrop,
    landRecord: user.landRecord,
    landAreaAcres: user.landAreaAcres,
    ownershipNo: user.ownershipNo,
    companyName: user.companyName,
    gstNumber: user.gstNumber,
    industryType: user.industryType,
    honourScore: user.honourScore ?? 50,
    reviewedOrders: user.reviewedOrders ?? 0,
    isBlacklisted: !!user.isBlacklisted,
    aadhaarLast4: user.aadhaarLast4,
    panNumber: user.panNumber,
    baseLocation: user.baseLocation,
    vehicles: user.vehicles,
    createdAt: user.createdAt,
  };
}

// ── SIGNUP ── creates an unverified account and emails a real OTP
router.post("/signup", async (req, res) => {
  try {
    const {
      name,
      mobile,
      email,
      password,
      role,
      district,
      aadhaar,
      panNumber,
      village,
      taluka,
      state,
      landRecord,
      primaryCrop,
      landAreaAcres,
      ownershipNo,
      companyName,
      gstNumber,
      industryType,
      baseLocation,
      vehicles,
    } = req.body;

    if (!name || !mobile || !email || !password || !role) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ── Logistics Partner specific validation ──
    // Mirrors what the old standalone logisticsAuth.js used to check,
    // now living in the one shared signup path.
    let cleanVehicles;
    if (role === "logistics") {
      if (!baseLocation || !String(baseLocation).trim()) {
        return res
          .status(400)
          .json({ error: "baseLocation is required for logistics partners" });
      }

      cleanVehicles = Array.isArray(vehicles)
        ? vehicles
            .filter((v) => v && v.vehicleNumber && v.vehicleType)
            .map((v) => ({
              vehicleNumber: String(v.vehicleNumber).trim().toUpperCase(),
              vehicleType: v.vehicleType,
            }))
        : [];

      if (cleanVehicles.length === 0) {
        return res
          .status(400)
          .json({ error: "At least one vehicle is required" });
      }
      for (const v of cleanVehicles) {
        if (!VALID_VEHICLE_TYPES.includes(v.vehicleType)) {
          return res
            .status(400)
            .json({ error: `Unknown vehicleType "${v.vehicleType}"` });
        }
      }
    }

    const existing = await User.findOne({ $or: [{ email }, { mobile }] });
    if (existing) {
      return res
        .status(409)
        .json({ error: "Account with this email or mobile already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const otpCode = generateOtp();
    const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Never store the full Aadhaar number — only the last 4 digits, for display purposes
    const aadhaarLast4 = aadhaar
      ? String(aadhaar).replace(/\D/g, "").slice(-4)
      : undefined;

    const user = await User.create({
      name,
      mobile,
      email,
      passwordHash,
      role,
      district,
      otpCode,
      otpExpiresAt,
      isVerified: false,
      aadhaarLast4,
      panNumber,
      village,
      taluka,
      state,
      landRecord,
      primaryCrop,
      landAreaAcres,
      ownershipNo,
      companyName,
      gstNumber,
      industryType,
      baseLocation: role === "logistics" ? baseLocation : undefined,
      vehicles: role === "logistics" ? cleanVehicles : undefined,
    });

    // Email sending is separated from account creation: if it fails, we roll back
    // the user we just created instead of leaving an orphaned unverified account
    // that would block every future signup attempt with a 409.
    try {
      await sendOtpEmail(email, otpCode, name);
    } catch (emailErr) {
      console.error("OTP email failed, rolling back user:", emailErr);
      await User.findByIdAndDelete(user._id);
      return res.status(502).json({
        error:
          "Could not send verification email. Please try signing up again.",
        detail: emailErr.message,
      });
    }

    res.status(201).json({
      message: "Account created. Check your email for the verification code.",
      userId: user._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Signup failed", detail: err.message });
  }
});

// ── VERIFY OTP ── confirms the email code and logs the user in
router.post("/verify-otp", async (req, res) => {
  try {
    const { userId, otp } = req.body;
    const user = await User.findById(userId);

    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.isVerified)
      return res.status(400).json({ error: "Already verified" });
    if (!user.otpCode || user.otpCode !== otp) {
      return res.status(400).json({ error: "Incorrect code" });
    }
    if (user.otpExpiresAt < new Date()) {
      return res
        .status(400)
        .json({ error: "Code expired. Request a new one." });
    }

    user.isVerified = true;
    user.otpCode = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    const token = signToken(user);
    res.json({
      message: "Verified successfully",
      token,
      user: publicUser(user),
    });
  } catch (err) {
    res.status(500).json({ error: "Verification failed", detail: err.message });
  }
});

// ── RESEND OTP ──
router.post("/resend-otp", async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const otpCode = generateOtp();
    user.otpCode = otpCode;
    user.otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    try {
      await sendOtpEmail(user.email, otpCode, user.name);
    } catch (emailErr) {
      console.error("Resend OTP email failed:", emailErr);
      return res.status(502).json({
        error: "Could not send email. Please try again in a moment.",
        detail: emailErr.message,
      });
    }

    res.json({ message: "New code sent" });
  } catch (err) {
    res
      .status(500)
      .json({ error: "Could not resend code", detail: err.message });
  }
});

// ── LOGIN ── email, mobile, or marketplaceId (F0001, B0001) + password
router.post("/login", async (req, res) => {
  try {
    const { identifier, password, role } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: "Identifier and password are required" });
    }

    const cleanId = String(identifier).trim();
    const digits = cleanId.replace(/\D/g, "");

    const searchConditions = [
      { email: cleanId.toLowerCase() },
      { mobile: cleanId },
      { marketplaceId: cleanId.toUpperCase() },
    ];

    if (digits.length === 10) {
      searchConditions.push({ mobile: `+91${digits}` }, { mobile: digits });
    }

    // If role is provided, search matching role first
    let user = null;
    if (role && ["farmer", "buyer", "logistics"].includes(role)) {
      user = await User.findOne({ $and: [{ role }, { $or: searchConditions }] });
    }
    if (!user) {
      user = await User.findOne({ $or: searchConditions });
    }

    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    // ── ROLE CHECK (if role specified, enforce correct portal) ──
    if (role && user.role !== role) {
      const labels = { farmer: "Farmer", buyer: "Buyer", logistics: "Logistics" };
      return res.status(403).json({
        error: `This account is registered as ${labels[user.role] || user.role}. Please log in from the ${labels[user.role] || user.role} portal.`,
        code: "ROLE_MISMATCH",
      });
    }

    if (!user.isVerified) {
      return res.status(403).json({
        error: "Email not verified",
        userId: user._id,
        needsVerification: true,
      });
    }

    const token = signToken(user);
    res.json({ message: "Login successful", token, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Login failed", detail: err.message });
  }
});

// ── GET CURRENT USER ──
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user profile", detail: err.message });
  }
});

module.exports = router;