const express = require('express');

const {
  getCheckpointIntervalMinutes,
  getDailyMaxRuns,
  getSubscriptionMonths,
  toDayKey,
} = require('../config/ai-bot');
const {
  getSignupPricingConfig,
  isSupportedPaymentMethod,
  normalizePaymentMethod,
  toUsd,
} = require('../config/pricing');
const { requireAuth } = require('../middleware/auth');
const { toPublicUser } = require('../services/auth-service');

const router = express.Router();

function getNextCheckpointDate(fromDate = new Date()) {
  const intervalMinutes = getCheckpointIntervalMinutes();
  return new Date(fromDate.getTime() + intervalMinutes * 60 * 1000);
}

function addMonths(fromDate = new Date(), months = 1) {
  const safeMonths = Number.isFinite(months) && months > 0 ? Math.floor(months) : 1;
  const next = new Date(fromDate);
  next.setMonth(next.getMonth() + safeMonths);
  return next;
}

function getSubscriptionState(user, now = new Date()) {
  const activatedAt = user.aiBotActivatedAt ? new Date(user.aiBotActivatedAt) : null;
  const expiresAt = user.aiBotExpiresAt ? new Date(user.aiBotExpiresAt) : null;
  const activatedAtMs = activatedAt && Number.isFinite(activatedAt.getTime()) ? activatedAt.getTime() : null;
  const expiresAtMs = expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt.getTime() : null;
  const hasPurchased = Boolean(activatedAtMs);
  const active = Boolean(hasPurchased && expiresAtMs && expiresAtMs > now.getTime());
  const expired = Boolean(hasPurchased && expiresAtMs && expiresAtMs <= now.getTime());
  const remainingDays = active && expiresAtMs
    ? Math.max(0, Math.ceil((expiresAtMs - now.getTime()) / (24 * 60 * 60 * 1000)))
    : 0;

  return {
    months: Number(user.aiBotSubscriptionMonths || getSubscriptionMonths()),
    hasPurchased,
    active,
    expired,
    remainingDays,
    expiresAt: expiresAtMs ? new Date(expiresAtMs) : null,
  };
}

function syncSubscriptionState(user, now = new Date()) {
  const subscription = getSubscriptionState(user, now);

  if (subscription.expired && user.aiBotEnabled) {
    user.aiBotEnabled = false;
    return true;
  }

  return false;
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
  const subscription = getSubscriptionState(user);
  if (!user.aiBotEnabled || !subscription.active) {
    return false;
  }

  if (!user.aiBotNextCheckpointAt) {
    return true;
  }

  return new Date(user.aiBotNextCheckpointAt).getTime() <= Date.now();
}

function buildBotStatus(user) {
  const now = new Date();
  const subscription = getSubscriptionState(user, now);
  const maxRuns = getDailyMaxRuns();
  const usageCount = Number(user.aiBotDailyRunsCount || 0);
  const usagePercent = maxRuns > 0 ? Math.min(100, Math.round((usageCount / maxRuns) * 100)) : 0;
  const checkpointRequired = requiresCheckpoint(user);
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
    const changed = syncSubscriptionState(req.user);
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
    const paymentAmount = Number(req.body?.paymentAmountUsd);
    const config = getPaymentConfig();
    const expectedAmount = toUsd(config.aiBotFeeUsd);

    if (!isSupportedPaymentMethod(paymentMethod)) {
      return res.status(400).json({ message: 'Valid payment method is required' });
    }

    if (!paymentReference || paymentReference.length < 3) {
      return res.status(400).json({ message: 'Payment reference should be at least 3 characters' });
    }

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ message: 'Payment amount is required' });
    }

    if (Math.abs(toUsd(paymentAmount) - expectedAmount) > 0.01) {
      return res
        .status(400)
        .json({ message: `Payment amount must match ${expectedAmount.toFixed(2)} USD for AI Bot` });
    }

    const now = new Date();
    const currentExpiryAt = req.user.aiBotExpiresAt ? new Date(req.user.aiBotExpiresAt) : null;
    const renewFrom =
      currentExpiryAt && Number.isFinite(currentExpiryAt.getTime()) && currentExpiryAt.getTime() > now.getTime()
        ? currentExpiryAt
        : now;
    const nextExpiryAt = addMonths(renewFrom, config.subscriptionMonths);

    req.user.aiBotFeeUsd = expectedAmount;
    req.user.aiBotSubscriptionMonths = config.subscriptionMonths;
    req.user.aiBotEnabled = true;
    req.user.aiBotPaymentMethod = normalizePaymentMethod(paymentMethod);
    req.user.aiBotPaymentReference = paymentReference;
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
    const changed = syncSubscriptionState(req.user);

    if (!req.user.aiBotEnabled) {
      if (changed) {
        await req.user.save();
      }
      return res.status(400).json({ message: 'AI Bot is not active for this account' });
    }

    if (!getSubscriptionState(req.user).active) {
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
    syncSubscriptionState(req.user);

    if (!req.user.aiBotActivatedAt) {
      return res.status(400).json({ message: 'Activate AI Bot before changing auto mode' });
    }

    if (enabled && !getSubscriptionState(req.user).active) {
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
    syncSubscriptionState(req.user);

    if (!req.user.aiBotEnabled) {
      return res.status(400).json({ message: 'Activate AI Bot before running automation' });
    }

    if (!getSubscriptionState(req.user).active) {
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
