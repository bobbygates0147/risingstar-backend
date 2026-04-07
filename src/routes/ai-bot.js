const express = require('express');

const {
  getCheckpointIntervalMinutes,
  getDailyMaxRuns,
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

function getPaymentConfig() {
  const signupConfig = getSignupPricingConfig();
  return {
    currency: signupConfig.currency,
    aiBotFeeUsd: signupConfig.aiBotFeeUsd,
    paymentMethods: signupConfig.paymentMethods,
    paymentInstructions: signupConfig.paymentInstructions,
    checkpointIntervalMinutes: getCheckpointIntervalMinutes(),
    dailyMaxRuns: getDailyMaxRuns(),
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
  if (!user.aiBotEnabled) {
    return false;
  }

  if (!user.aiBotNextCheckpointAt) {
    return true;
  }

  return new Date(user.aiBotNextCheckpointAt).getTime() <= Date.now();
}

function buildBotStatus(user) {
  const maxRuns = getDailyMaxRuns();
  const usageCount = Number(user.aiBotDailyRunsCount || 0);
  const usagePercent = maxRuns > 0 ? Math.min(100, Math.round((usageCount / maxRuns) * 100)) : 0;
  const checkpointRequired = requiresCheckpoint(user);

  return {
    enabled: Boolean(user.aiBotEnabled),
    feeUsd: Number(user.aiBotFeeUsd || getSignupPricingConfig().aiBotFeeUsd),
    paymentMethod: user.aiBotPaymentMethod || '',
    activatedAt: user.aiBotActivatedAt || null,
    checkpoint: {
      required: checkpointRequired,
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
    normalizeDailyRuns(req.user);
    await req.user.save();

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
    req.user.aiBotFeeUsd = expectedAmount;
    req.user.aiBotEnabled = true;
    req.user.aiBotPaymentMethod = normalizePaymentMethod(paymentMethod);
    req.user.aiBotPaymentReference = paymentReference;
    req.user.aiBotActivatedAt = now;
    req.user.aiBotLastCheckpointAt = now;
    req.user.aiBotNextCheckpointAt = getNextCheckpointDate(now);
    req.user.aiBotDailyRunsDate = toDayKey(now);
    req.user.aiBotDailyRunsCount = 0;

    await req.user.save();

    return res.json({
      message: 'AI Bot activated',
      status: buildBotStatus(req.user),
      user: toPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/checkpoint', requireAuth, async (req, res, next) => {
  try {
    if (!req.user.aiBotEnabled) {
      return res.status(400).json({ message: 'AI Bot is not active for this account' });
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

    if (!req.user.aiBotActivatedAt) {
      return res.status(400).json({ message: 'Activate AI Bot before changing auto mode' });
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
    if (!req.user.aiBotEnabled) {
      return res.status(400).json({ message: 'Activate AI Bot before running automation' });
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
