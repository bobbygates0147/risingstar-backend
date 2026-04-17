const path = require('path');
const fs = require('fs/promises');
const bcrypt = require('bcryptjs');
const express = require('express');

const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');
const { toPublicUser } = require('../services/auth-service');
const { uploadProfileAvatar } = require('../services/cloudinary-upload');
const {
  isSupportedPaymentMethod,
  normalizePaymentMethod,
  resolveTier,
  toUsd,
} = require('../config/pricing');

const router = express.Router();

const rawAvatarLimit = Number.parseInt(process.env.PROFILE_AVATAR_MAX_BYTES || '', 10);
const PROFILE_AVATAR_MAX_BYTES = Number.isFinite(rawAvatarLimit)
  ? Math.min(Math.max(rawAvatarLimit, 200 * 1024), 10 * 1024 * 1024)
  : 2 * 1024 * 1024;

const SUPPORTED_AVATAR_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const avatarsDirectory = path.resolve(__dirname, '..', '..', 'downloads', 'avatars');
const TIER_ORDER = {
  tier1: 1,
  tier2: 2,
  tier3: 3,
  tier4: 4,
};

function clampText(value, maxLength = 120) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeNotificationSettings(source, current) {
  const payload = source && typeof source === 'object' ? source : {};
  const existing =
    current && typeof current === 'object'
      ? current
      : {
          taskAlerts: true,
          securityAlerts: true,
          payoutAlerts: true,
          marketing: false,
        };

  return {
    taskAlerts:
      typeof payload.taskAlerts === 'boolean'
        ? payload.taskAlerts
        : Boolean(existing.taskAlerts),
    securityAlerts:
      typeof payload.securityAlerts === 'boolean'
        ? payload.securityAlerts
        : Boolean(existing.securityAlerts),
    payoutAlerts:
      typeof payload.payoutAlerts === 'boolean'
        ? payload.payoutAlerts
        : Boolean(existing.payoutAlerts),
    marketing:
      typeof payload.marketing === 'boolean'
        ? payload.marketing
        : Boolean(existing.marketing),
  };
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '').trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);

  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const base64Value = match[2].replace(/\s+/g, '');

  if (!SUPPORTED_AVATAR_TYPES.has(mimeType)) {
    return null;
  }

  let buffer;

  try {
    buffer = Buffer.from(base64Value, 'base64');
  } catch {
    return null;
  }

  if (!buffer || buffer.length === 0) {
    return null;
  }

  return {
    mimeType,
    extension: SUPPORTED_AVATAR_TYPES.get(mimeType),
    buffer,
  };
}

async function removeLocalAvatar(avatarUrl) {
  const previousAvatarUrl = String(avatarUrl || '');
  if (!previousAvatarUrl.startsWith('/media/avatars/')) {
    return;
  }

  const previousFile = path.basename(previousAvatarUrl);
  if (!previousFile) {
    return;
  }

  const previousPath = path.join(avatarsDirectory, previousFile);
  await fs.unlink(previousPath).catch(() => undefined);
}

function getProfileStats(user, aggregateResult) {
  const aggregate = aggregateResult || {
    totalEarnings: 0,
    tasksCompleted: 0,
    firstCompletionAt: null,
  };

  const totalEarnings = Number(Number(aggregate.totalEarnings || 0).toFixed(2));
  const tasksCompleted = Math.max(0, Number.parseInt(String(aggregate.tasksCompleted || 0), 10) || 0);

  const now = new Date();
  const createdAt = user.createdAt ? new Date(user.createdAt) : now;
  const firstCompletionAt = aggregate.firstCompletionAt ? new Date(aggregate.firstCompletionAt) : null;

  const startDate =
    firstCompletionAt && Number.isFinite(firstCompletionAt.getTime()) && firstCompletionAt < createdAt
      ? firstCompletionAt
      : createdAt;

  const startAtMs = Number.isFinite(startDate.getTime()) ? startDate.getTime() : now.getTime();
  const daysActive = Math.max(1, Math.ceil((now.getTime() - startAtMs + 1) / (24 * 60 * 60 * 1000)));

  return {
    totalEarnings,
    tasksCompleted,
    daysActive,
  };
}

function resolveTierIdFromLabel(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (normalized === 'tier1' || normalized === '1') {
    return 'tier1';
  }

  if (normalized === 'tier2' || normalized === '2') {
    return 'tier2';
  }

  if (normalized === 'tier3' || normalized === '3') {
    return 'tier3';
  }

  if (normalized === 'tier4' || normalized === '4') {
    return 'tier4';
  }

  return 'tier1';
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const statsRows = await TaskCompletion.aggregate([
      {
        $match: {
          userId: req.user._id,
        },
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$reward' },
          tasksCompleted: { $sum: 1 },
          firstCompletionAt: { $min: '$completedAt' },
        },
      },
    ]);

    const stats = getProfileStats(req.user, statsRows[0]);

    res.json({
      user: toPublicUser(req.user),
      stats,
    });
  } catch (error) {
    next(error);
  }
});

router.patch('/', requireAuth, async (req, res, next) => {
  try {
    const payload = req.body && typeof req.body === 'object' ? req.body : {};

    if ('phone' in payload) {
      req.user.phone = clampText(payload.phone, 30);
    }

    if ('country' in payload) {
      req.user.country = clampText(payload.country, 60);
    }

    if ('bio' in payload) {
      req.user.bio = clampText(payload.bio, 320);
    }

    if ('language' in payload) {
      const language = clampText(payload.language, 30);
      if (language) {
        req.user.language = language;
      }
    }

    if ('timezone' in payload) {
      const timezone = clampText(payload.timezone, 80);
      if (timezone) {
        req.user.timezone = timezone;
      }
    }

    if ('notificationSettings' in payload) {
      req.user.notificationSettings = normalizeNotificationSettings(
        payload.notificationSettings,
        req.user.notificationSettings
      );
    }

    await req.user.save();

    res.json({
      message: 'Profile updated successfully',
      user: toPublicUser(req.user),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }

    if (newPassword.length < 4) {
      return res.status(400).json({ message: 'New password should be at least 4 characters' });
    }

    const validPassword = await bcrypt.compare(currentPassword, req.user.passwordHash);

    if (!validPassword) {
      return res.status(400).json({ message: 'Current password is incorrect' });
    }

    req.user.passwordHash = await bcrypt.hash(newPassword, 10);
    await req.user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
});

router.post('/avatar', requireAuth, async (req, res, next) => {
  try {
    const imageDataUrl = req.body?.imageDataUrl;
    const parsedImage = parseDataUrl(imageDataUrl);

    if (!parsedImage) {
      return res.status(400).json({ message: 'A valid image is required' });
    }

    if (parsedImage.buffer.length > PROFILE_AVATAR_MAX_BYTES) {
      return res
        .status(400)
        .json({ message: `Avatar should be ${Math.floor(PROFILE_AVATAR_MAX_BYTES / (1024 * 1024))}MB or less` });
    }

    const previousAvatarUrl = String(req.user.avatarUrl || '');
    const uploadedAvatar = await uploadProfileAvatar({
      userId: req.user._id,
      imageDataUrl,
      fileName: req.body?.fileName,
    });

    req.user.avatarUrl = uploadedAvatar.url;
    await req.user.save();
    await removeLocalAvatar(previousAvatarUrl);

    res.json({
      message: 'Profile photo updated',
      user: toPublicUser(req.user),
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tier-upgrade', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(400).json({ message: 'Admin account tier cannot be upgraded' });
    }

    const targetTier = resolveTier(req.body?.tier);
    const paymentMethod = req.body?.paymentMethod;
    const paymentReference = String(req.body?.paymentReference || '').trim();
    const paymentAmountRaw = Number(req.body?.paymentAmountUsd);

    if (!targetTier) {
      return res.status(400).json({ message: 'Valid upgrade tier is required' });
    }

    const currentTierId = resolveTierIdFromLabel(req.user.tier || 'Tier 1');
    const currentOrder = TIER_ORDER[currentTierId] || TIER_ORDER.tier1;
    const targetOrder = TIER_ORDER[targetTier.id] || TIER_ORDER.tier1;

    if (targetOrder <= currentOrder) {
      return res.status(400).json({ message: 'Please choose a higher tier to upgrade' });
    }

    if (!isSupportedPaymentMethod(paymentMethod)) {
      return res.status(400).json({ message: 'Valid payment method is required' });
    }

    if (!paymentReference || paymentReference.length < 3) {
      return res.status(400).json({ message: 'Payment reference should be at least 3 characters' });
    }

    if (!Number.isFinite(paymentAmountRaw) || paymentAmountRaw <= 0) {
      return res.status(400).json({ message: 'Payment amount is required' });
    }

    const expectedAmount = toUsd(targetTier.feeUsd);
    const providedAmount = toUsd(paymentAmountRaw);

    if (Math.abs(expectedAmount - providedAmount) > 0.01) {
      return res
        .status(400)
        .json({ message: `Payment amount must match ${expectedAmount.toFixed(2)} USD for ${targetTier.label}` });
    }

    req.user.tier = targetTier.label;
    req.user.tierUpgradedAt = new Date();
    req.user.tierUpgradePaymentMethod = normalizePaymentMethod(paymentMethod);
    req.user.tierUpgradePaymentReference = paymentReference;
    req.user.tierUpgradePaymentAmountUsd = providedAmount;
    await req.user.save();

    return res.json({
      message: `Tier upgraded to ${targetTier.label}`,
      user: toPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
