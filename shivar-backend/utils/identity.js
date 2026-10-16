const mongoose = require('mongoose');
const User = require('../models/User');

/**
 * Resolves an identifier (either a MongoDB ObjectId or a business marketplaceId like F0001, B0001, L0001)
 * into a verified MongoDB User document.
 * @param {string|mongoose.Types.ObjectId} identifier
 * @returns {Promise<import('../models/User')|null>}
 */
async function resolveUser(identifier) {
  if (!identifier) return null;
  const str = String(identifier).trim();
  
  if (mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str) {
    const user = await User.findById(str);
    if (user) return user;
  }
  return await User.findOne({ marketplaceId: str.toUpperCase() });
}

/**
 * Resolves an identifier into a MongoDB ObjectId string.
 * @param {string|mongoose.Types.ObjectId} identifier
 * @returns {Promise<string|null>}
 */
async function resolveUserId(identifier) {
  if (!identifier) return null;
  const str = String(identifier).trim();
  
  if (mongoose.Types.ObjectId.isValid(str) && String(new mongoose.Types.ObjectId(str)) === str) {
    return str;
  }
  const u = await User.findOne({ marketplaceId: str.toUpperCase() }).select('_id').lean();
  return u ? String(u._id) : null;
}

module.exports = { resolveUser, resolveUserId };
