const fs = require('fs');
const path = require('path');

const defaultMapPath = path.resolve(__dirname, '..', 'data', 'cloudinary-media-map.json');

let cachedMapPath = '';
let cachedMtimeMs = 0;
let cachedAssets = {};

function resolveMapPath() {
  const configuredPath = String(process.env.CLOUDINARY_MEDIA_MAP_PATH || '').trim();
  if (!configuredPath) {
    return defaultMapPath;
  }

  return path.resolve(configuredPath);
}

function normalizeAssetPath(assetPath) {
  if (!assetPath || typeof assetPath !== 'string') {
    return '';
  }

  const trimmed = assetPath.trim();
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.startsWith('/')) {
    return trimmed;
  }

  return `/${trimmed}`;
}

function loadAssets() {
  const mapPath = resolveMapPath();

  if (!fs.existsSync(mapPath)) {
    cachedMapPath = mapPath;
    cachedMtimeMs = 0;
    cachedAssets = {};
    return cachedAssets;
  }

  const stat = fs.statSync(mapPath);
  const mtimeMs = Number(stat.mtimeMs || 0);

  if (cachedMapPath === mapPath && cachedMtimeMs === mtimeMs) {
    return cachedAssets;
  }

  try {
    const raw = fs.readFileSync(mapPath, 'utf8');
    const parsed = JSON.parse(raw);
    const assets =
      parsed &&
      typeof parsed === 'object' &&
      parsed.assets &&
      typeof parsed.assets === 'object' &&
      !Array.isArray(parsed.assets)
        ? parsed.assets
        : {};

    cachedMapPath = mapPath;
    cachedMtimeMs = mtimeMs;
    cachedAssets = assets;
    return cachedAssets;
  } catch {
    cachedMapPath = mapPath;
    cachedMtimeMs = mtimeMs;
    cachedAssets = {};
    return cachedAssets;
  }
}

function getCloudinaryUrl(assetPath) {
  const normalized = normalizeAssetPath(assetPath);
  if (!normalized || /^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const assets = loadAssets();
  const direct = assets[normalized];
  if (direct && typeof direct.url === 'string' && direct.url.trim().length > 0) {
    return direct.url.trim();
  }

  try {
    const decoded = decodeURI(normalized);
    if (decoded !== normalized) {
      const decodedEntry = assets[decoded];
      if (
        decodedEntry &&
        typeof decodedEntry.url === 'string' &&
        decodedEntry.url.trim().length > 0
      ) {
        return decodedEntry.url.trim();
      }
    }
  } catch {
    // Keep default fallback.
  }

  return normalized;
}

function getMappedUrlsByFolder(folderName) {
  const folder = String(folderName || '').trim();
  if (!folder) {
    return [];
  }

  const prefix = `/${folder}/`;
  const assets = loadAssets();

  return Object.entries(assets)
    .filter(([key, value]) => key.startsWith(prefix) && value && typeof value.url === 'string')
    .sort((left, right) => left[0].localeCompare(right[0], undefined, { numeric: true, sensitivity: 'base' }))
    .map(([, value]) => value.url.trim())
    .filter(Boolean);
}

module.exports = {
  getCloudinaryUrl,
  getMappedUrlsByFolder,
  normalizeAssetPath,
};