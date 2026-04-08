const mongoose = require('mongoose');

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    kind: {
      type: String,
      enum: ['deposit'],
      required: true,
      default: 'deposit',
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: ['Completed', 'Pending', 'Failed'],
      default: 'Completed',
      index: true,
    },
    network: {
      type: String,
      default: '',
      trim: true,
    },
    reference: {
      type: String,
      default: '',
      trim: true,
    },
    note: {
      type: String,
      default: '',
      trim: true,
      maxlength: 180,
    },
    occurredAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, occurredAt: -1 });

module.exports = mongoose.model('WalletTransaction', walletTransactionSchema);
