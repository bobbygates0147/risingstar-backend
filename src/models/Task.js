const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    title: { type: String, required: true },
    artist: { type: String, default: 'Unknown Artist' },
    duration: { type: String, required: true },
    reward: { type: Number, required: true },
    type: {
      type: String,
      enum: ['Music', 'Ads', 'Art'],
      required: true,
    },
    status: {
      type: String,
      enum: ['available', 'live', 'completed'],
      default: 'available',
    },
    mood: { type: String, default: '' },
    coverImage: { type: String, required: true },
    mediaUrl: { type: String, default: '' },
    reach: { type: String, default: '0' },
    engagement: { type: String, default: '0%' },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Task', taskSchema);
