const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  order:   { type: mongoose.Schema.Types.ObjectId, ref: 'Order', required: true, unique: true }, // one feedback per order
  farmer:  { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  buyer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',  required: true },
  quality:   { type: Number, required: true, min: 1, max: 5 },
  packaging: { type: Number, required: true, min: 1, max: 5 },
  honesty:   { type: Number, required: true, min: 1, max: 5 },
  average:   { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Feedback', feedbackSchema);