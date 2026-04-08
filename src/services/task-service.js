const fs = require('fs');
const path = require('path');

const Task = require('../models/Task');
const { getCloudinaryUrl, getMappedUrlsByFolder } = require('./cloudinary-media-map');

const musicArtists = [
  'Nova Kade',
  'Zuri Vale',
  'AYR',
  'Kairo',
  'Juno Redd',
  'Ari Moss',
  'Nexus Nine',
  'Luna Shore',
];

const artArtists = ['Mira Sol', 'Arlo Muse', 'Nia Hart', 'Kai Dune', 'Rumi Ash', 'Lio Voss', 'Ana Crest'];

const musicMoods = [
  'Synthwave pulse',
  'Afro-fusion anthem',
  'Late-night drill',
  'Soul-pop crossover',
  'High-energy campaign',
  'Melodic street vibe',
];

const artMoods = [
  'Like abstract showcase',
  'Like modern gallery post',
  'Curated visual drop',
  'Studio color study',
  'Concept portrait set',
];

const adMoods = ['Sponsored ad clip', 'Product ad clip', 'Brand promo clip'];

function getFrontendPublicDir() {
  if (process.env.FRONTEND_PUBLIC_DIR) {
    return path.resolve(process.env.FRONTEND_PUBLIC_DIR);
  }

  return path.resolve(__dirname, '..', '..', '..', 'rising-star', 'public');
}

function safeListFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function toPublicAssetPath(folder, fileName) {
  return `/${folder}/${encodeURIComponent(fileName)}`;
}

function toTaskAssetPath(folder, fileName) {
  return getCloudinaryUrl(toPublicAssetPath(folder, fileName));
}

function mapMediaValue(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return getCloudinaryUrl(trimmed);
}

function toDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function statusFromIndex(index) {
  if (index % 5 === 0) {
    return 'live';
  }

  return 'available';
}

function reachFromIndex(index) {
  return `${(2.2 + index * 0.14).toFixed(1)}K`;
}

function engagementFromIndex(index) {
  return `${74 + (index % 22)}%`;
}

function pickAdCover(images) {
  const preferred = images.filter((value) => /\/mc2[0-5]\./i.test(value));

  if (preferred.length >= 3) {
    return preferred.slice(0, 3).map((fileName) => toTaskAssetPath('images', fileName));
  }

  if (images.length >= 3) {
    return images.slice(0, 3).map((fileName) => toTaskAssetPath('images', fileName));
  }

  return [
    getCloudinaryUrl('/images/mc20.jpg'),
    getCloudinaryUrl('/images/mc21.webp'),
    getCloudinaryUrl('/images/mc22.webp'),
  ];
}

function listAdMediaUrls() {
  const mapped = getMappedUrlsByFolder('ads');
  if (mapped.length > 0) {
    return mapped;
  }

  const publicDir = getFrontendPublicDir();
  const adVideoFiles = safeListFiles(path.join(publicDir, 'ads')).filter((fileName) =>
    /\.(mp4|mov|mkv|webm|avi)$/i.test(fileName)
  );

  return adVideoFiles.map((fileName) => toTaskAssetPath('ads', fileName));
}

function listMusicMediaUrls() {
  const mapped = getMappedUrlsByFolder('musiclist');
  if (mapped.length > 0) {
    return mapped;
  }

  const publicDir = getFrontendPublicDir();
  const musicAudioFiles = safeListFiles(path.join(publicDir, 'musiclist')).filter((fileName) =>
    /\.(mp3|m4a|wav|ogg|aac)$/i.test(fileName)
  );

  return musicAudioFiles.map((fileName) => toTaskAssetPath('musiclist', fileName));
}

function buildDummyTasks() {
  const publicDir = getFrontendPublicDir();
  const imageFiles = safeListFiles(path.join(publicDir, 'images'));
  const artFiles = safeListFiles(path.join(publicDir, 'arts'));
  const adVideoFiles = safeListFiles(path.join(publicDir, 'ads')).filter((fileName) =>
    /\.(mp4|mov|mkv|webm|avi)$/i.test(fileName)
  );
  const musicAudioFiles = safeListFiles(path.join(publicDir, 'musiclist')).filter((fileName) =>
    /\.(mp3|m4a|wav|ogg|aac)$/i.test(fileName)
  );

  const imageCoverUrls = imageFiles.length > 0
    ? imageFiles.map((fileName) => toTaskAssetPath('images', fileName))
    : getMappedUrlsByFolder('images');
  const artCoverUrls = artFiles.length > 0
    ? artFiles.map((fileName) => toTaskAssetPath('arts', fileName))
    : getMappedUrlsByFolder('arts');
  const adMediaUrls = adVideoFiles.length > 0
    ? adVideoFiles.map((fileName) => toTaskAssetPath('ads', fileName))
    : getMappedUrlsByFolder('ads');
  const musicMediaUrls = musicAudioFiles.length > 0
    ? musicAudioFiles.map((fileName) => toTaskAssetPath('musiclist', fileName))
    : getMappedUrlsByFolder('musiclist');

  const adCovers = pickAdCover(imageFiles);
  const tasks = [];
  let sortOrder = 1;

  imageCoverUrls.forEach((coverImage, index) => {
    const sessionNo = index + 1;
    const musicMedia = musicMediaUrls.length > 0
      ? musicMediaUrls[index % musicMediaUrls.length]
      : '';

    tasks.push({
      taskId: `music-${sessionNo}`,
      sortOrder,
      title: `Music Session ${sessionNo}`,
      artist: musicArtists[index % musicArtists.length],
      duration: toDuration(30 + ((index % 6) * 4 + 6)),
      reward: Number((0.62 + (index % 8) * 0.04).toFixed(2)),
      type: 'Music',
      status: statusFromIndex(index),
      mood: musicMoods[index % musicMoods.length],
      coverImage,
      mediaUrl: musicMedia,
      reach: reachFromIndex(index),
      engagement: engagementFromIndex(index + 2),
    });

    sortOrder += 1;
  });

  artCoverUrls.forEach((coverImage, index) => {
    const sessionNo = index + 1;
    const globalIndex = imageCoverUrls.length + index;

    tasks.push({
      taskId: `art-${sessionNo}`,
      sortOrder,
      title: `Art Session ${sessionNo}`,
      artist: artArtists[index % artArtists.length],
      duration: toDuration(16 + ((index % 4) * 3 + 2)),
      reward: Number((0.45 + (index % 7) * 0.05).toFixed(2)),
      type: 'Art',
      status: statusFromIndex(globalIndex),
      mood: artMoods[index % artMoods.length],
      coverImage,
      mediaUrl: '',
      reach: reachFromIndex(globalIndex),
      engagement: engagementFromIndex(globalIndex + 1),
    });

    sortOrder += 1;
  });

  const adCount = Math.max(3, adMediaUrls.length || 0);

  for (let index = 0; index < adCount; index += 1) {
    const sessionNo = index + 1;
    const globalIndex = imageCoverUrls.length + artCoverUrls.length + index;
    const mediaUrl = adMediaUrls.length > 0 ? adMediaUrls[index % adMediaUrls.length] : '';

    tasks.push({
      taskId: `ad-${sessionNo}`,
      sortOrder,
      title: `Sponsored Slot ${sessionNo}`,
      artist: 'Brand Partner',
      duration: toDuration(15 + (index % 3) * 5),
      reward: Number((0.45 + (index % 4) * 0.08).toFixed(2)),
      type: 'Ads',
      status: statusFromIndex(globalIndex),
      mood: adMoods[index % adMoods.length],
      coverImage: adCovers[index % adCovers.length],
      mediaUrl,
      reach: reachFromIndex(globalIndex),
      engagement: engagementFromIndex(globalIndex + 3),
    });

    sortOrder += 1;
  }

  return tasks;
}

async function seedDummyTasks() {
  const tasks = buildDummyTasks();
  const taskIds = tasks.map((task) => task.taskId);

  for (const task of tasks) {
    await Task.findOneAndUpdate(
      { taskId: task.taskId },
      { $set: task },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  }

  const deleted = await Task.deleteMany({ taskId: { $nin: taskIds } });

  return {
    seededCount: tasks.length,
    deletedCount: deleted.deletedCount || 0,
  };
}

function mapTaskDoc(doc) {
  const mappedCoverImage = mapMediaValue(doc.coverImage);
  const mappedMediaUrl = mapMediaValue(doc.mediaUrl);

  return {
    id: doc.taskId,
    title: doc.title,
    artist: doc.artist,
    duration: doc.duration,
    reward: Number(doc.reward || 0),
    type: doc.type,
    status: doc.status,
    mood: doc.mood,
    coverImage: mappedCoverImage || doc.coverImage,
    mediaUrl: mappedMediaUrl || undefined,
    reach: doc.reach,
    engagement: doc.engagement,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function buildGeneratedAdTask(index, mediaUrl, fallbackCover) {
  const slotNumber = index + 1;
  const reward = Number((0.45 + ((index % 6) * 0.06)).toFixed(2));

  return {
    id: `ad-generated-${slotNumber}`,
    title: `Sponsored Slot ${slotNumber}`,
    artist: 'Brand Partner',
    duration: toDuration(15 + (index % 4) * 5),
    reward,
    type: 'Ads',
    status: 'available',
    mood: adMoods[index % adMoods.length],
    coverImage: fallbackCover,
    mediaUrl,
    reach: reachFromIndex(100 + index),
    engagement: engagementFromIndex(100 + index),
  };
}

async function listTasks() {
  const tasks = await Task.find().sort({ sortOrder: 1, createdAt: 1 }).lean();
  const adMediaUrls = listAdMediaUrls();
  const musicMediaUrls = listMusicMediaUrls();
  const mappedTasks = tasks.map((task) => mapTaskDoc(task));

  let musicMediaCursor = 0;
  const withMusicMedia = mappedTasks.map((task) => {
    if (task.type !== 'Music') {
      return task;
    }

    const fallbackMedia =
      musicMediaUrls.length > 0
        ? musicMediaUrls[musicMediaCursor % musicMediaUrls.length]
        : '';
    musicMediaCursor += 1;

    if (task.mediaUrl || !fallbackMedia) {
      return task;
    }

    return {
      ...task,
      mediaUrl: fallbackMedia,
    };
  });

  if (adMediaUrls.length === 0) {
    return withMusicMedia;
  }

  const adTasks = withMusicMedia.filter((task) => task.type === 'Ads');
  const fallbackCover = adTasks[0]?.coverImage || getCloudinaryUrl('/images/mc20.jpg');

  // Ensure every discovered ad file is represented by at least one ad task response.
  const normalizedAdTasks = adMediaUrls.map((mediaUrl, index) => {
    if (index < adTasks.length) {
      return {
        ...adTasks[index],
        mediaUrl,
      };
    }

    return buildGeneratedAdTask(index, mediaUrl, fallbackCover);
  });

  const nonAdTasks = withMusicMedia.filter((task) => task.type !== 'Ads');
  return [...nonAdTasks, ...normalizedAdTasks];
}

module.exports = {
  buildDummyTasks,
  seedDummyTasks,
  listTasks,
  mapTaskDoc,
};