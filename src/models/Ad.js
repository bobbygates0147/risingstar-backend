const mongoose = require('mongoose');

const adSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    brand: { type: String, default: 'Partner Brand' },
    provider: { type: String, default: 'google-sample' },
    sourceUrl: { type: String, required: true, unique: true },
    localFile: { type: String, required: true },
    durationSeconds: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Ad', adSchema);
