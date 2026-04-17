const express = require('express');

const { requireAuth, requireRegistrationVerified } = require('../middleware/auth');
const TaskCompletion = require('../models/TaskCompletion');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const {
  resolveTaskArtist,
  resolveTaskTitle,
} = require('../services/task-catalog-metadata');

const router = express.Router();
const SUPPORTED_NETWORKS = new Set(['TRC20', 'ERC20', 'BEP20', 'BTC', 'ETH', 'SOL']);

function parseEnvInteger(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function parseEnvFloat(name, fallback, min, max) {
  const parsed = Number.parseFloat(process.env[name] || '');

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

const DAILY_LIMIT_BY_TIER = {
  tier1: parseEnvInteger('DAILY_TASK_LIMIT_TIER1', 8, 1, 100),
  tier2: parseEnvInteger('DAILY_TASK_LIMIT_TIER2', 12, 1, 120),
  tier3: parseEnvInteger('DAILY_TASK_LIMIT_TIER3', 16, 1, 150),
  tier4: parseEnvInteger('DAILY_TASK_LIMIT_TIER4', 22, 1, 200),
};

const WITHDRAW_MIN_USD = parseEnvFloat('WITHDRAW_MIN_USD', 1, 0.1, 1000);
const WITHDRAW_MAX_USD = parseEnvFloat('WITHDRAW_MAX_USD', 5000, 10, 100000);
const HISTORY_LIMIT_DEFAULT = 120;
const HISTORY_LIMIT_MAX = 300;

function toUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatTimeLabel(value) {
  const date = new Date(value);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function resolveTierId(user) {
  if (user.role === 'admin') {
    return 'tier4';
  }

  const normalizedTier = String(user.tier || '')
    .trim()
    .toLowerCase();

  if (normalizedTier === 'tier2' || normalizedTier === '2' || normalizedTier === 'tier 2') {
    return 'tier2';
  }

  if (normalizedTier === 'tier3' || normalizedTier === '3' || normalizedTier === 'tier 3') {
    return 'tier3';
  }

  if (normalizedTier === 'tier4' || normalizedTier === '4' || normalizedTier === 'tier 4') {
    return 'tier4';
  }

  return 'tier1';
}

function getDailyLimit(user) {
  const tierId = resolveTierId(user);
  const baseLimit = DAILY_LIMIT_BY_TIER[tierId] || DAILY_LIMIT_BY_TIER.tier1;
  const creditSlots = Math.max(
    0,
    Number.parseInt(String(user.taskCredits || 0), 10) || 0
  );
  return baseLimit + creditSlots;
}

function parseHistoryLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);

  if (!Number.isFinite(parsed)) {
    return HISTORY_LIMIT_DEFAULT;
  }

  return Math.min(Math.max(parsed, 1), HISTORY_LIMIT_MAX);
}

function mapWithdrawalEntry(doc) {
  const detailParts = [];

  if (doc.network) {
    detailParts.push(`${doc.network} withdrawal`);
  }

  if (doc.walletAddress) {
    detailParts.push(`To ${doc.walletAddress}`);
  }

  if (doc.memo) {
    detailParts.push(doc.memo);
  }

  const status =
    doc.status === 'approved'
      ? 'Completed'
      : doc.status === 'rejected'
      ? 'Failed'
      : 'Pending';

  return {
    id: `withdrawal-${doc._id}`,
    title: 'USDT Withdrawal',
    detail: detailParts.join(' | ') || 'Withdrawal request',
    amount: -Math.abs(toUsd(doc.amount)),
    status,
    timeLabel: formatTimeLabel(doc.requestedAt || doc.createdAt),
    kind: 'withdrawal',
    network: doc.network || undefined,
    occurredAt: doc.requestedAt || doc.createdAt,
  };
}

function mapTaskCompletionEntry(doc) {
  const sourceTaskId = doc.sourceTaskId || doc.sessionTaskId || String(doc._id);
  const title = resolveTaskTitle(doc.type, sourceTaskId, doc.title);
  const artist = resolveTaskArtist(doc.type, sourceTaskId, doc.title, doc.artist);
  const detail = artist ? `${title} by ${artist}` : title;

  return {
    id: `task-${doc._id}`,
    title: `${doc.type} Task Earnings`,
    detail,
    amount: toUsd(doc.reward),
    status: 'Completed',
    timeLabel: formatTimeLabel(doc.completedAt || doc.createdAt),
    kind:
      doc.type === 'Ads'
        ? 'ads'
        : doc.type === 'Art'
        ? 'art'
        : doc.type === 'Social'
        ? 'social'
        : 'music',
    occurredAt: doc.completedAt || doc.createdAt,
  };
}

router.get('/summary', requireAuth, requireRegistrationVerified, async (req, res) => {
  const tierId = resolveTierId(req.user);
  const baseDailyLimit = DAILY_LIMIT_BY_TIER[tierId] || DAILY_LIMIT_BY_TIER.tier1;
  const creditSlots = Math.max(
    0,
    Number.parseInt(String(req.user.taskCredits || 0), 10) || 0
  );

  res.json({
    wallet: {
      balance: toUsd(req.user.walletBalance),
      withdrawable: toUsd(req.user.withdrawableBalance),
    },
    taskCapacity: {
      baseDailyLimit,
      creditSlots,
      dailyLimit: getDailyLimit(req.user),
    },
  });
});

router.get('/history', requireAuth, requireRegistrationVerified, async (req, res, next) => {
  try {
    const limit = parseHistoryLimit(req.query?.limit);

    const [withdrawals, completions] = await Promise.all([
      WithdrawalRequest.find({ userId: req.user._id })
        .sort({ requestedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
      TaskCompletion.find({ userId: req.user._id })
        .sort({ completedAt: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
    ]);

    const entries = [
      ...withdrawals.map(mapWithdrawalEntry),
      ...completions.map(mapTaskCompletionEntry),
    ]
      .sort((left, right) => {
        const leftTime = new Date(left.occurredAt || 0).getTime();
        const rightTime = new Date(right.occurredAt || 0).getTime();
        return rightTime - leftTime;
      })
      .slice(0, limit);

    return res.json({ entries });
  } catch (error) {
    return next(error);
  }
});

router.post('/withdraw', requireAuth, requireRegistrationVerified, async (req, res, next) => {
  try {
    const amountUsd = Number(req.body?.amountUsd);
    const network = String(req.body?.network || '')
      .trim()
      .toUpperCase();
    const walletAddress = String(req.body?.walletAddress || '')
      .trim()
      .slice(0, 120);
    const memo = String(req.body?.memo || '')
      .trim()
      .slice(0, 180);

    if (!Number.isFinite(amountUsd) || amountUsd < WITHDRAW_MIN_USD || amountUsd > WITHDRAW_MAX_USD) {
      return res.status(400).json({
        message: `Withdrawal amount should be between ${WITHDRAW_MIN_USD.toFixed(2)} and ${WITHDRAW_MAX_USD.toFixed(2)} USD`,
      });
    }

    if (!SUPPORTED_NETWORKS.has(network)) {
      return res.status(400).json({ message: 'Valid crypto network is required' });
    }

    if (walletAddress.length < 10) {
      return res.status(400).json({ message: 'Enter a valid destination wallet address' });
    }

    const normalizedAmount = toUsd(amountUsd);
    const withdrawable = toUsd(req.user.withdrawableBalance);

    if (withdrawable < normalizedAmount) {
      return res.status(400).json({
        message: `Insufficient withdrawable balance. Available: ${withdrawable.toFixed(2)} USD`,
      });
    }

    const request = await WithdrawalRequest.create({
      userId: req.user._id,
      amount: normalizedAmount,
      paymentMethod: 'crypto',
      paymentReference: `${network}:${walletAddress}`,
      network,
      walletAddress,
      memo,
      status: 'pending',
      requestedAt: new Date(),
    });

    return res.status(201).json({
      message: 'Withdrawal request submitted and pending admin approval.',
      withdrawal: {
        id: `withdrawal-${request._id}`,
        amountUsd: normalizedAmount,
        network,
        walletAddress,
        memo,
        status: 'Pending',
        requestedAt: request.requestedAt,
      },
      wallet: {
        balance: toUsd(req.user.walletBalance),
        withdrawable,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
