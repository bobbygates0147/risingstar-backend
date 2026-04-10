const mongoose = require('mongoose');

const taskPackPurchaseSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    packId: { type: String, required: true },
    packLabel: { type: String, required: true },
    tasks: { type: Number, required: true },
    priceUsd: { type: Number, required: true },
    paymentMethod: { type: String, enum: ['wallet', 'crypto'], required: true },
    paymentTxHash: { type: String, default: '' },
    paymentNetwork: { type: String, default: '' },
    paymentProofFile: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Completed', 'Rejected'], default: 'Pending' },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date, default: null },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decisionNote: { type: String, default: '' },
  },
  { timestamps: true }
);

taskPackPurchaseSchema.index({ userId: 1, requestedAt: -1 });

module.exports = mongoose.model('TaskPackPurchase', taskPackPurchaseSchema);
