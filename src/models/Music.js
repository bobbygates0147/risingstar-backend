const mongoose = require('mongoose');

const musicSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    artist: { type: String, default: 'Unknown Artist' },
    album: { type: String, default: 'Unknown Album' },
    provider: { type: String, default: 'itunes' },
    sourceUrl: { type: String, required: true, unique: true },
    localFile: { type: String, required: true },
    artworkUrl: { type: String, default: '' },
    artworkLocalFile: { type: String, default: '' },
    durationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Music', musicSchema);
