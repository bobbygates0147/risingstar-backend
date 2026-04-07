const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ['user', 'admin'],
      default: 'user',
      index: true,
    },
    walletBalance: { type: Number, default: 0 },
    withdrawableBalance: { type: Number, default: 0 },
    streak: { type: Number, default: 0 },
    tier: { type: String, default: 'Tier 1' },
    registrationFeeUsd: { type: Number, default: 0 },
    registrationPaymentMethod: {
      type: String,
      enum: ['bank_transfer', 'paypal', 'crypto'],
      default: null,
    },
    registrationPaymentReference: { type: String, default: '' },
    registrationPaymentAmountUsd: { type: Number, default: 0 },
    registrationPaidAt: { type: Date, default: null },
    aiBotFeeUsd: { type: Number, default: 0 },
    aiBotEnabled: { type: Boolean, default: false },
    aiBotPaymentMethod: {
      type: String,
      enum: ['bank_transfer', 'paypal', 'crypto'],
      default: null,
    },
    aiBotPaymentReference: { type: String, default: '' },
    aiBotActivatedAt: { type: Date, default: null },
    aiBotLastCheckpointAt: { type: Date, default: null },
    aiBotNextCheckpointAt: { type: Date, default: null },
    aiBotDailyRunsDate: { type: String, default: '' },
    aiBotDailyRunsCount: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
