const { v2: cloudinary } = require('cloudinary');

let configuredSignature = '';

function readCloudinaryConfig() {
  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  const folder = String(process.env.CLOUDINARY_FOLDER || 'risingstar').trim() || 'risingstar';

  return {
    cloudName,
    apiKey,
    apiSecret,
    folder,
  };
}

function assertCloudinaryConfigured() {
  const config = readCloudinaryConfig();

  if (!config.cloudName || !config.apiKey || !config.apiSecret) {
    const error = new Error(
      'Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.'
    );
    error.statusCode = 503;
    throw error;
  }

  const signature = `${config.cloudName}:${config.apiKey}`;
  if (configuredSignature !== signature) {
    cloudinary.config({
      cloud_name: config.cloudName,
      api_key: config.apiKey,
      api_secret: config.apiSecret,
      secure: true,
    });
    configuredSignature = signature;
  }

  return config;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'avatar';
}

async function uploadProfileAvatar({ userId, imageDataUrl, fileName }) {
  const config = assertCloudinaryConfigured();
  const cleanUserId = slugify(userId);
  const originalFileName = String(fileName || 'avatar').slice(0, 120);

  let result;

  try {
    result = await cloudinary.uploader.upload(imageDataUrl, {
      folder: config.folder,
      public_id: `avatars/${cleanUserId}`,
      resource_type: 'image',
      overwrite: true,
      invalidate: true,
      context: {
        alt: 'Profile photo',
        original_filename: originalFileName,
      },
    });
  } catch (error) {
    const uploadError = new Error('Unable to upload profile photo to Cloudinary');
    uploadError.statusCode = 502;
    uploadError.cause = error;
    throw uploadError;
  }

  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: Number(result.bytes || 0),
  };
}

module.exports = {
  uploadProfileAvatar,
};
