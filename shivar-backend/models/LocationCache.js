const mongoose = require('mongoose');

// One document per unique place-text string we've ever geocoded.
// Checked before every external geocoding call — see utils/geocode.js.
const locationCacheSchema = new mongoose.Schema({
  placeText: { type: String, required: true, unique: true, trim: true },
  lat: { type: Number, required: true },
  lng: { type: Number, required: true },

  // Which provider resolved this, useful if you later add a Google Maps
  // fallback and want to know which cached rows came from which source.
  source: { type: String, enum: ['nominatim', 'google'], default: 'nominatim' },
}, { timestamps: true });

module.exports = mongoose.model('LocationCache', locationCacheSchema);
