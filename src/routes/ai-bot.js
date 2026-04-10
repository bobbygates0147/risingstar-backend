const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const express = require('express');

const {
  getCheckpointIntervalMinutes,
  getDailyMaxRuns,
  getSubscriptionMonths,
  toDayKey,
} = require('../config/ai-bot');
const {
  addMonths,
  ensureAIBotSubscriptionState,
  getAIBotSubscriptionState,
  getNextCheckpointDate,
  requiresAIBotCheckpoint,
} = require('../services/ai-bot-status');
const {
  getSignupPricingConfig,
  isSupportedAIBotPaymentMethod,
  isSupportedPaymentMethod,
  normalizePaymentMethod,
  toUsd,
} = require('../config/pricing');
const { requireAuth } = require('../middleware/auth');
const { toPublicUser } = require('../services/auth-service');

const router = express.Router();
const PROOF_DIR = path.resolve(__dirname, '..', '..', 'downloads', 'ai-bot-proofs');
const rawProofLimit = Number.parseInt(process.env.AI_BOT_PROOF_MAX_BYTES || '', 10);
const AI_BOT_PROOF_MAX_BYTES = Number.isFinite(rawProofLimit)
  ? Math.min(Math.max(rawProofLimit, 200 * 1024), 10 * 1024 * 1024)
  : 4 * 1024 * 1024;
const SUPPORTED_PROOF_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);

function parseProofDataUrl(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }

  const raw = dataUrl.trim();
  if (!raw.toLowerCase().startsWith('data:')) {
    return null;
  }

  const commaIndex = raw.indexOf(',');
  if (commaIndex === -1) {
    return null;
  }

  const header = raw.slice(5, commaIndex);
  const payload = raw.slice(commaIndex + 1);
  const headerParts = header.split(';').filter(Boolean);
  const mimeType = (headerParts[0] || '').toLowerCase();
  const isBase64 = headerParts.some((part) => part.toLowerCase() === 'base64');

  if (!mimeType || !isBase64 || !SUPPORTED_PROOF_TYPES.has(mimeType)) {
    return null;
  }

  const base64Value = payload.replace(/\s+/g, '');

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
    extension: SUPPORTED_PROOF_TYPES.get(mimeType),
    buffer,
  };
}

function getPaymentConfig() {
  const signupConfig = getSignupPricingConfig();
  return {
    currency: signupConfig.currency,
    aiBotFeeUsd: signupConfig.aiBotFeeUsd,
    paymentMethods: signupConfig.paymentMethods,
    paymentInstructions: signupConfig.paymentInstructions,
    checkpointIntervalMinutes: getCheckpointIntervalMinutes(),
    dailyMaxRuns: getDailyMaxRuns(),
    subscriptionMonths: getSubscriptionMonths(),
  };
}

function normalizeDailyRuns(user) {
  const today = toDayKey();
  if (user.aiBotDailyRunsDate !== today) {
    user.aiBotDailyRunsDate = today;
    user.aiBotDailyRunsCount = 0;
  }
}

function requiresCheckpoint(user) {
  return requiresAIBotCheckpoint(user);
}

function buildBotStatus(user) {
  const now = new Date();
  const subscription = getAIBotSubscriptionState(user, now);
  const maxRuns = getDailyMaxRuns();
  const usageCount = Number(user.aiBotDailyRunsCount || 0);
  const usagePercent = maxRuns > 0 ? Math.min(100, Math.round((usageCount / maxRuns) * 100)) : 0;
  const checkpointRequired = requiresAIBotCheckpoint(user, now);
  const enabled = Boolean(user.aiBotEnabled) && subscription.active;

  return {
    enabled,
    feeUsd: Number(user.aiBotFeeUsd || getSignupPricingConfig().aiBotFeeUsd),
    paymentMethod: user.aiBotPaymentMethod || '',
    activatedAt: user.aiBotActivatedAt || null,
    subscription: {
      months: subscription.months,
      active: subscription.active,
      expired: subscription.expired,
      verified: subscription.verified,
      expiresAt: subscription.expiresAt,
      remainingDays: subscription.remainingDays,
    },
    checkpoint: {
      required: enabled ? checkpointRequired : false,
      lastCheckpointAt: user.aiBotLastCheckpointAt || null,
      nextCheckpointAt: user.aiBotNextCheckpointAt || null,
      intervalMinutes: getCheckpointIntervalMinutes(),
    },
    usage: {
      count: usageCount,
      max: maxRuns,
      percent: usagePercent,
      remaining: maxRuns > 0 ? Math.max(0, maxRuns - usageCount) : 0,
    },
  };
}

router.get('/config', requireAuth, (req, res) => {
  res.json(getPaymentConfig());
});

router.get('/status', requireAuth, async (req, res, next) => {
  try {
    const changed = ensureAIBotSubscriptionState(req.user);
    normalizeDailyRuns(req.user);
    if (changed || req.user.isModified()) {
      await req.user.save();
    }

    res.json(buildBotStatus(req.user));
  } catch (error) {
    next(error);
  }
});

router.post('/activate', requireAuth, async (req, res, next) => {
  try {
    const paymentMethod = req.body?.paymentMethod;
    const paymentReference = String(req.body?.paymentReference || '').trim();
    const paymentTxHash = String(req.body?.paymentTxHash || paymentReference || '').trim();
    const paymentProofDataUrl = req.body?.paymentProofDataUrl;
    const paymentAmount = Number(req.body?.paymentAmountUsd);
    const config = getPaymentConfig();
    const expectedAmount = toUsd(config.aiBotFeeUsd);

    if (!isSupportedAIBotPaymentMethod(paymentMethod)) {
      return res.status(400).json({ message: 'Valid payment method is required' });
    }

    if (!paymentReference || paymentReference.length < 3) {
      return res.status(400).json({ message: 'Payment reference should be at least 3 characters' });
    }

    if (normalizePaymentMethod(paymentMethod) === 'crypto') {
      if (!paymentTxHash || paymentTxHash.length < 8) {
        return res.status(400).json({ message: 'Transaction hash is required for crypto payments' });
      }
    }

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount is required' });
    }

    if (Math.abs(toUsd(paymentAmount) - expectedAmount) > 0.01) {
      return res
        .status(400)
        .json({ message: `Payment amount must match ${expectedAmount.toFixed(2)} USD for AI Bot` });
    }

    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const now = new Date();
    const currentExpiryAt = req.user.aiBotExpiresAt ? new Date(req.user.aiBotExpiresAt) : null;
    const renewFrom =
      currentExpiryAt && Number.isFinite(currentExpiryAt.getTime()) && currentExpiryAt.getTime() > now.getTime()
        ? currentExpiryAt
        : now;
    const nextExpiryAt = addMonths(renewFrom, config.subscriptionMonths);

    let proofFile = '';

    if (normalizedPaymentMethod === 'crypto' && paymentProofDataUrl) {
      const parsed = parseProofDataUrl(paymentProofDataUrl);

      if (!parsed) {
        return res.status(400).json({ message: 'Proof of payment must be a valid image or PDF' });
      }

      if (parsed.buffer.length > AI_BOT_PROOF_MAX_BYTES) {
        return res.status(400).json({
          message: `Proof file should be ${Math.floor(AI_BOT_PROOF_MAX_BYTES / (1024 * 1024))}MB or less`,
        });
      }

      await fs.mkdir(PROOF_DIR, { recursive: true });
      const fileName = `${req.user._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${parsed.extension}`;
      const filePath = path.join(PROOF_DIR, fileName);
      await fs.writeFile(filePath, parsed.buffer);
      proofFile = path.join('ai-bot-proofs', fileName);
    }

    if (normalizedPaymentMethod === 'wallet') {
      const walletBalance = Number(req.user.walletBalance || 0);
      const withdrawableBalance = Number(req.user.withdrawableBalance || 0);

      if (walletBalance < expectedAmount) {
        return res.status(400).json({ message: 'Insufficient wallet balance for AI Bot activation' });
      }

      if (withdrawableBalance < expectedAmount) {
        return res.status(400).json({ message: 'Insufficient withdrawable balance for AI Bot activation' });
      }

      req.user.walletBalance = toUsd(walletBalance - expectedAmount);
      req.user.withdrawableBalance = toUsd(withdrawableBalance - expectedAmount);
    }

    req.user.aiBotFeeUsd = expectedAmount;
    req.user.aiBotSubscriptionMonths = config.subscriptionMonths;
    req.user.aiBotEnabled = true;
    req.user.aiBotPaymentMethod = normalizedPaymentMethod;
    req.user.aiBotPaymentReference = paymentReference;
    req.user.aiBotPaymentTxHash = paymentTxHash;
    req.user.aiBotPaymentProofFile = proofFile;
    req.user.aiBotVerificationStatus = normalizedPaymentMethod === 'wallet' ? 'verified' : 'unverified';
    req.user.aiBotVerifiedAt = normalizedPaymentMethod === 'wallet' ? now : null;
    req.user.aiBotVerifiedBy = null;
    req.user.aiBotActivatedAt = now;
    req.user.aiBotExpiresAt = nextExpiryAt;
    req.user.aiBotLastCheckpointAt = now;
    req.user.aiBotNextCheckpointAt = getNextCheckpointDate(now);
    req.user.aiBotDailyRunsDate = toDayKey(now);
    req.user.aiBotDailyRunsCount = 0;

    await req.user.save();

    return res.json({
      message: `AI Bot activated for ${config.subscriptionMonths} month${config.subscriptionMonths === 1 ? '' : 's'}`,
      status: buildBotStatus(req.user),
      user: toPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/checkpoint', requireAuth, async (req, res, next) => {
  try {
    const changed = ensureAIBotSubscriptionState(req.user);

    if (!req.user.aiBotEnabled) {
      if (changed) {
        await req.user.save();
      }
      return res.status(400).json({ message: 'AI Bot is not active for this account' });
    }

    const subscription = getAIBotSubscriptionState(req.user);
    if (!subscription.verified) {
      await req.user.save();
      return res.status(403).json({ message: 'AI Bot payment is not verified yet.' });
    }

    if (!subscription.active) {
      await req.user.save();
      return res.status(402).json({ message: 'AI Bot subscription expired. Renew to continue.' });
    }

    const now = new Date();
    req.user.aiBotLastCheckpointAt = now;
    req.user.aiBotNextCheckpointAt = getNextCheckpointDate(now);
    await req.user.save();

    return res.json({
      message: 'Manual checkpoint completed',
      status: buildBotStatus(req.user),
      user: toPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/toggle', requireAuth, async (req, res, next) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    ensureAIBotSubscriptionState(req.user);

    if (!req.user.aiBotActivatedAt) {
      return res.status(400).json({ message: 'Activate AI Bot before changing auto mode' });
    }

    const subscription = getAIBotSubscriptionState(req.user);
    if (enabled && !subscription.verified) {
      await req.user.save();
      return res.status(403).json({ message: 'AI Bot payment is not verified yet.' });
    }

    if (enabled && !subscription.active) {
      await req.user.save();
      return res.status(402).json({ message: 'AI Bot subscription expired. Renew to continue.' });
    }

    if (enabled && !req.user.aiBotLastCheckpointAt) {
      const now = new Date();
      req.user.aiBotLastCheckpointAt = now;
      req.user.aiBotNextCheckpointAt = getNextCheckpointDate(now);
    }

    req.user.aiBotEnabled = enabled;
    await req.user.save();

    return res.json({
      message: enabled ? 'Auto mode enabled' : 'Auto mode paused',
      status: buildBotStatus(req.user),
      user: toPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/run-daily', requireAuth, async (req, res, next) => {
  try {
    ensureAIBotSubscriptionState(req.user);

    if (!req.user.aiBotEnabled) {
      return res.status(400).json({ message: 'Activate AI Bot before running automation' });
    }

    const subscription = getAIBotSubscriptionState(req.user);
    if (!subscription.verified) {
      await req.user.save();
      return res.status(403).json({
        message: 'AI Bot payment is not verified yet.',
        status: buildBotStatus(req.user),
      });
    }

    if (!subscription.active) {
      await req.user.save();
      return res.status(402).json({
        message: 'AI Bot subscription expired. Renew to continue.',
        status: buildBotStatus(req.user),
      });
    }

    normalizeDailyRuns(req.user);

    if (requiresCheckpoint(req.user)) {
      await req.user.save();
      return res.status(409).json({
        message: 'Manual checkpoint required before running automation',
        status: buildBotStatus(req.user),
      });
    }

    const maxRuns = getDailyMaxRuns();
    if (maxRuns > 0 && req.user.aiBotDailyRunsCount >= maxRuns) {
      await req.user.save();
      return res.status(429).json({
        message: 'Daily automation quota reached',
        status: buildBotStatus(req.user),
      });
    }

    req.user.aiBotDailyRunsCount += 1;
    await req.user.save();

    return res.json({
      message: 'AI Bot ran your daily automation batch successfully',
      status: buildBotStatus(req.user),
      user: toPublicUser(req.user),
      runSummary: {
        tasksProcessed: 3,
        requiresCheckpoint: requiresCheckpoint(req.user),
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
