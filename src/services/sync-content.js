const path = require('path');
const axios = require('axios');

const Music = require('../models/Music');
const Ad = require('../models/Ad');
const { downloadFile, ensureDir, extensionFromUrl, slugify } = require('../utils/download-file');

const downloadsRoot = path.resolve(__dirname, '..', '..', 'downloads');
const musicDir = path.join(downloadsRoot, 'music');
const adsDir = path.join(downloadsRoot, 'ads');

const musicTerms = ['afrobeats', 'lofi', 'rnb'];
const maxTracks = 12;

const adSources = [
  {
    title: 'Summer Sale Teaser',
    brand: 'Rising Star Ads',
    durationSeconds: 5,
    url: 'https://samplelib.com/lib/preview/mp4/sample-5s.mp4',
  },
  {
    title: 'Fashion Promo Cut',
    brand: 'Rising Star Ads',
    durationSeconds: 10,
    url: 'https://samplelib.com/lib/preview/mp4/sample-10s.mp4',
  },
  {
    title: 'Concert Push Clip',
    brand: 'Rising Star Ads',
    durationSeconds: 15,
    url: 'https://samplelib.com/lib/preview/mp4/sample-15s.mp4',
  },
];

function toRelativeMediaPath(absolutePath) {
  return path.relative(downloadsRoot, absolutePath).split(path.sep).join('/');
}

function publicMediaUrl(relativePath) {
  return `/media/${relativePath}`;
}

async function fetchMusicCandidates() {
  const results = [];
  const seen = new Set();

  for (const term of musicTerms) {
    const response = await axios.get('https://itunes.apple.com/search', {
      params: {
        term,
        entity: 'song',
        media: 'music',
        limit: 10,
      },
    });

    const tracks = Array.isArray(response.data?.results) ? response.data.results : [];

    for (const track of tracks) {
      if (!track.previewUrl || seen.has(track.previewUrl)) {
        continue;
      }

      seen.add(track.previewUrl);

      results.push({
        title: track.trackName || 'Untitled',
        artist: track.artistName || 'Unknown Artist',
        album: track.collectionName || 'Unknown Album',
        sourceUrl: track.previewUrl,
        artworkUrl: track.artworkUrl100 || '',
        durationMs: Number(track.trackTimeMillis || 0),
        stableId: track.trackId || track.collectionId || seen.size,
      });

      if (results.length >= maxTracks) {
        return results;
      }
    }
  }

  return results;
}

async function syncMusic(force = false, saveToDb = true) {
  await ensureDir(musicDir);
  const candidates = await fetchMusicCandidates();
  const saved = [];
  let failedCount = 0;

  for (const track of candidates) {
    try {
      const ext = extensionFromUrl(track.sourceUrl, '.m4a');
      const baseName = `${slugify(track.title)}-${track.stableId}`;
      const audioAbsolutePath = path.join(musicDir, `${baseName}${ext}`);
      await downloadFile(track.sourceUrl, audioAbsolutePath, force);

      let artworkRelativePath = '';
      if (track.artworkUrl) {
        const artworkExt = extensionFromUrl(track.artworkUrl, '.jpg');
        const artworkAbsolutePath = path.join(musicDir, `${baseName}-artwork${artworkExt}`);
        await downloadFile(track.artworkUrl, artworkAbsolutePath, force);
        artworkRelativePath = toRelativeMediaPath(artworkAbsolutePath);
      }

      const audioRelativePath = toRelativeMediaPath(audioAbsolutePath);

      if (saveToDb) {
        const doc = await Music.findOneAndUpdate(
          { sourceUrl: track.sourceUrl },
          {
            $set: {
              title: track.title,
              artist: track.artist,
              album: track.album,
              provider: 'itunes',
              sourceUrl: track.sourceUrl,
              localFile: audioRelativePath,
              artworkUrl: track.artworkUrl,
              artworkLocalFile: artworkRelativePath,
              durationMs: track.durationMs,
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        saved.push(doc);
      }
    } catch (error) {
      failedCount += 1;
      console.warn(`Music download skipped (${track.title}): ${error.message}`);
    }
  }

  return {
    totalCandidates: candidates.length,
    savedCount: saveToDb ? saved.length : 0,
    failedCount,
  };
}

async function syncAds(force = false, saveToDb = true) {
  await ensureDir(adsDir);
  const saved = [];
  let failedCount = 0;

  for (const ad of adSources) {
    try {
      const ext = extensionFromUrl(ad.url, '.mp4');
      const baseName = slugify(ad.title);
      const adAbsolutePath = path.join(adsDir, `${baseName}${ext}`);
      await downloadFile(ad.url, adAbsolutePath, force);

      const adRelativePath = toRelativeMediaPath(adAbsolutePath);

      if (saveToDb) {
        const doc = await Ad.findOneAndUpdate(
          { sourceUrl: ad.url },
          {
            $set: {
              title: ad.title,
              brand: ad.brand,
              provider: 'samplelib',
              sourceUrl: ad.url,
              localFile: adRelativePath,
              durationSeconds: ad.durationSeconds,
            },
          },
          { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
        );

        saved.push(doc);
      }
    } catch (error) {
      failedCount += 1;
      console.warn(`Ad download skipped (${ad.title}): ${error.message}`);
    }
  }

  return {
    totalCandidates: adSources.length,
    savedCount: saveToDb ? saved.length : 0,
    failedCount,
  };
}

async function syncAllContent({ force = false, saveToDb = true } = {}) {
  const [musicReport, adsReport] = await Promise.all([
    syncMusic(force, saveToDb),
    syncAds(force, saveToDb),
  ]);
  return {
    music: musicReport,
    ads: adsReport,
  };
}

function mapMusicDoc(doc) {
  return {
    id: doc._id,
    title: doc.title,
    artist: doc.artist,
    album: doc.album,
    sourceUrl: doc.sourceUrl,
    audioUrl: publicMediaUrl(doc.localFile),
    artworkUrl: doc.artworkLocalFile ? publicMediaUrl(doc.artworkLocalFile) : doc.artworkUrl,
    durationMs: doc.durationMs,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function mapAdDoc(doc) {
  return {
    id: doc._id,
    title: doc.title,
    brand: doc.brand,
    sourceUrl: doc.sourceUrl,
    mediaUrl: publicMediaUrl(doc.localFile),
    durationSeconds: doc.durationSeconds,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

module.exports = {
  syncAllContent,
  mapMusicDoc,
  mapAdDoc,
};
