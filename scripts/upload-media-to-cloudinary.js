const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const dotenv = require('dotenv');
const { v2: cloudinary } = require('cloudinary');

dotenv.config();

function getFrontendPublicDir() {
  if (process.env.FRONTEND_PUBLIC_DIR) {
    return path.resolve(process.env.FRONTEND_PUBLIC_DIR);
  }

  return path.resolve(__dirname, '..', '..', 'rising-star', 'public');
}

function getMapOutputPath() {
  const configured = String(process.env.CLOUDINARY_MEDIA_MAP_PATH || '').trim();
  if (configured) {
    return path.resolve(configured);
  }

  return path.resolve(__dirname, '..', 'src', 'data', 'cloudinary-media-map.json');
}

function slugify(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

  return normalized || 'asset';
}

function toAssetKey(folder, fileName) {
  return `/${folder}/${encodeURIComponent(fileName)}`;
}

function listFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

function createPublicId(folder, fileName) {
  const baseName = path.parse(fileName).name;
  const hash = crypto
    .createHash('sha1')
    .update(`${folder}/${fileName}`)
    .digest('hex')
    .slice(0, 10);

  return `${folder}/${slugify(baseName)}-${hash}`;
}

async function uploadFile(baseFolder, folder, absolutePath, fileName) {
  const publicId = createPublicId(folder, fileName);

  const result = await cloudinary.uploader.upload(absolutePath, {
    folder: baseFolder,
    resource_type: 'auto',
    public_id: publicId,
    overwrite: true,
    invalidate: true,
  });

  return {
    key: toAssetKey(folder, fileName),
    url: result.secure_url,
    publicId: result.public_id,
    resourceType: result.resource_type,
    bytes: Number(result.bytes || 0),
  };
}

function parseArgs(argv) {
  const folderArg = argv.find((entry) => entry.startsWith('--folders='));
  const folders = folderArg
    ? folderArg
        .split('=')[1]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  return {
    force: argv.includes('--force'),
    folders,
  };
}

function assertEnv() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Missing Cloudinary credentials. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in backend .env'
    );
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

function writeMapFile(mapOutputPath, payload) {
  fs.mkdirSync(path.dirname(mapOutputPath), { recursive: true });
  fs.writeFileSync(mapOutputPath, JSON.stringify(payload, null, 2));
}

async function run() {
  const { force, folders } = parseArgs(process.argv.slice(2));
  assertEnv();

  const publicDir = getFrontendPublicDir();
  const mapOutputPath = getMapOutputPath();
  const cloudFolder = String(process.env.CLOUDINARY_FOLDER || 'risingstar').trim() || 'risingstar';

  const folderSpecs = [
    { folder: 'images' },
    { folder: 'arts' },
    { folder: 'ads' },
    { folder: 'musiclist' },
  ].filter((spec) => folders.length === 0 || folders.includes(spec.folder));

  const existingMap = fs.existsSync(mapOutputPath)
    ? (() => {
        try {
          return JSON.parse(fs.readFileSync(mapOutputPath, 'utf8'));
        } catch {
          return {};
        }
      })()
    : {};

  const existingAssets =
    existingMap &&
    typeof existingMap === 'object' &&
    existingMap.assets &&
    typeof existingMap.assets === 'object' &&
    !Array.isArray(existingMap.assets)
      ? existingMap.assets
      : {};

  const nextAssets = { ...existingAssets };
  let uploadedCount = 0;
  let skippedCount = 0;
  let failureCount = 0;
  let processedCount = 0;

  for (const spec of folderSpecs) {
    const folderPath = path.join(publicDir, spec.folder);
    const files = listFiles(folderPath);

    for (const fileName of files) {
      const key = toAssetKey(spec.folder, fileName);
      const absolutePath = path.join(folderPath, fileName);

      if (!force && nextAssets[key] && typeof nextAssets[key].url === 'string' && nextAssets[key].url.trim()) {
        skippedCount += 1;
        processedCount += 1;
        continue;
      }

      try {
        const uploaded = await uploadFile(cloudFolder, spec.folder, absolutePath, fileName);
        nextAssets[key] = {
          url: uploaded.url,
          publicId: uploaded.publicId,
          resourceType: uploaded.resourceType,
          bytes: uploaded.bytes,
          uploadedAt: new Date().toISOString(),
        };
        uploadedCount += 1;
        processedCount += 1;
        console.log(`Uploaded ${key}`);

        if (uploadedCount % 5 === 0) {
          writeMapFile(mapOutputPath, {
            provider: 'cloudinary',
            cloudName: String(process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
            folder: cloudFolder,
            updatedAt: new Date().toISOString(),
            assets: nextAssets,
          });
        }
      } catch (error) {
        failureCount += 1;
        processedCount += 1;
        console.warn(`Failed ${key}: ${error.message}`);
      }
    }
  }

  const payload = {
    provider: 'cloudinary',
    cloudName: String(process.env.CLOUDINARY_CLOUD_NAME || '').trim(),
    folder: cloudFolder,
    updatedAt: new Date().toISOString(),
    assets: nextAssets,
  };

  writeMapFile(mapOutputPath, payload);

  console.log(
    JSON.stringify(
      {
        message: 'Cloudinary media map updated',
        mapOutputPath,
        folders: folderSpecs.map((entry) => entry.folder),
        processedCount,
        uploadedCount,
        skippedCount,
        failureCount,
        totalMapped: Object.keys(nextAssets).length,
      },
      null,
      2
    )
  );
}

run().catch((error) => {
  console.error(`Cloudinary upload failed: ${error.message}`);
  process.exit(1);
});