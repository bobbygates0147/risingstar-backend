const mongoose = require('mongoose');

const taskCompletionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sessionTaskId: {
      type: String,
      required: true,
      trim: true,
    },
    sourceTaskId: {
      type: String,
      default: '',
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    artist: {
      type: String,
      default: '',
      trim: true,
    },
    type: {
      type: String,
      enum: ['Music', 'Ads', 'Art'],
      required: true,
      index: true,
    },
    reward: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    dayKey: {
      type: String,
      required: true,
      index: true,
    },
    scheduledAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true,
    },
  },
  { timestamps: true }
);

taskCompletionSchema.index({ userId: 1, sessionTaskId: 1 }, { unique: true });
taskCompletionSchema.index({ userId: 1, completedAt: -1 });

module.exports = mongoose.model('TaskCompletion', taskCompletionSchema);
