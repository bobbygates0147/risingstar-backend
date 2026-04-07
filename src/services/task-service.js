const fs = require('fs');
const path = require('path');

const Task = require('../models/Task');

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
    return preferred.slice(0, 3).map((fileName) => toPublicAssetPath('images', fileName));
  }

  if (images.length >= 3) {
    return images.slice(0, 3).map((fileName) => toPublicAssetPath('images', fileName));
  }

  return ['/images/mc20.jpg', '/images/mc21.webp', '/images/mc22.webp'];
}

function listAdMediaUrls() {
  const publicDir = getFrontendPublicDir();
  const adVideoFiles = safeListFiles(path.join(publicDir, 'ads')).filter((fileName) =>
    /\.(mp4|mov|mkv|webm|avi)$/i.test(fileName)
  );

  return adVideoFiles.map((fileName) => toPublicAssetPath('ads', fileName));
}

function buildDummyTasks() {
  const publicDir = getFrontendPublicDir();
  const imageFiles = safeListFiles(path.join(publicDir, 'images'));
  const artFiles = safeListFiles(path.join(publicDir, 'arts'));
  const adVideoFiles = safeListFiles(path.join(publicDir, 'ads')).filter((fileName) =>
    /\.(mp4|mov|mkv|webm|avi)$/i.test(fileName)
  );

  const adCovers = pickAdCover(imageFiles);
  const tasks = [];
  let sortOrder = 1;

  imageFiles.forEach((fileName, index) => {
    const sessionNo = index + 1;

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
      coverImage: toPublicAssetPath('images', fileName),
      mediaUrl: '',
      reach: reachFromIndex(index),
      engagement: engagementFromIndex(index + 2),
    });

    sortOrder += 1;
  });

  artFiles.forEach((fileName, index) => {
    const sessionNo = index + 1;
    const globalIndex = imageFiles.length + index;

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
      coverImage: toPublicAssetPath('arts', fileName),
      mediaUrl: '',
      reach: reachFromIndex(globalIndex),
      engagement: engagementFromIndex(globalIndex + 1),
    });

    sortOrder += 1;
  });

  const adCount = Math.max(3, adVideoFiles.length || 0);

  for (let index = 0; index < adCount; index += 1) {
    const sessionNo = index + 1;
    const globalIndex = imageFiles.length + artFiles.length + index;
    const mediaUrl =
      adVideoFiles.length > 0
        ? toPublicAssetPath('ads', adVideoFiles[index % adVideoFiles.length])
        : '';

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
  return {
    id: doc.taskId,
    title: doc.title,
    artist: doc.artist,
    duration: doc.duration,
    reward: Number(doc.reward || 0),
    type: doc.type,
    status: doc.status,
    mood: doc.mood,
    coverImage: doc.coverImage,
    mediaUrl: doc.mediaUrl || undefined,
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
  const mappedTasks = tasks.map((task) => {
    if (task.type !== 'Ads' || adMediaUrls.length === 0) {
      return mapTaskDoc(task);
    }

    const mapped = mapTaskDoc(task);
    return mapped;
  });

  if (adMediaUrls.length === 0) {
    return mappedTasks;
  }

  const adTasks = mappedTasks.filter((task) => task.type === 'Ads');
  const fallbackCover = adTasks[0]?.coverImage || '/images/mc20.jpg';

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

  const nonAdTasks = mappedTasks.filter((task) => task.type !== 'Ads');
  return [...nonAdTasks, ...normalizedAdTasks];
}

module.exports = {
  buildDummyTasks,
  seedDummyTasks,
  listTasks,
  mapTaskDoc,
};
