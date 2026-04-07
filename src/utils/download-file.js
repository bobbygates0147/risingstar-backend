const fs = require('fs');
const path = require('path');
const axios = require('axios');

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70);
}

function extensionFromUrl(url, fallback = '.bin') {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname);
    return ext || fallback;
  } catch {
    return fallback;
  }
}

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function downloadFile(url, destination, force = false) {
  await ensureDir(path.dirname(destination));

  if (!force && fs.existsSync(destination)) {
    return { downloaded: false, path: destination };
  }

  const response = await axios.get(url, { responseType: 'stream' });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destination);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  return { downloaded: true, path: destination };
}

module.exports = {
  downloadFile,
  ensureDir,
  extensionFromUrl,
  slugify,
};
