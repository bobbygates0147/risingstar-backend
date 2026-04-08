const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const express = require('express');

const { requireAuth } = require('../middleware/auth');
const TaskCompletion = require('../models/TaskCompletion');
const WalletTransaction = require('../models/WalletTransaction');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const { toPublicUser } = require('../services/auth-service');

const router = express.Router();
const SUPPORTED_NETWORKS = new Set(['TRC20', 'ERC20', 'BEP20', 'BTC', 'ETH', 'SOL']);
const PROOF_DIR = path.resolve(__dirname, '..', '..', 'downloads', 'proofs');
const rawProofLimit = Number.parseInt(process.env.WALLET_PROOF_MAX_BYTES || '', 10);
const WALLET_PROOF_MAX_BYTES = Number.isFinite(rawProofLimit)
  ? Math.min(Math.max(rawProofLimit, 200 * 1024), 10 * 1024 * 1024)
  : 4 * 1024 * 1024;
const SUPPORTED_PROOF_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['application/pdf', '.pdf'],
]);

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
};

const DEPOSIT_MIN_USD = parseEnvFloat('DEPOSIT_MIN_USD', 1, 0.1, 1000);
const DEPOSIT_MAX_USD = parseEnvFloat('DEPOSIT_MAX_USD', 5000, 10, 100000);
const DEPOSIT_USD_PER_EXTRA_TASK = parseEnvFloat('DEPOSIT_USD_PER_EXTRA_TASK', 5, 0.5, 1000);
const DEPOSIT_EXTRA_TASKS_MAX = parseEnvInteger('DEPOSIT_EXTRA_TASKS_MAX', 200, 0, 2000);
const WITHDRAW_MIN_USD = parseEnvFloat('WITHDRAW_MIN_USD', 1, 0.1, 1000);
const WITHDRAW_MAX_USD = parseEnvFloat('WITHDRAW_MAX_USD', 5000, 10, 100000);
const HISTORY_LIMIT_DEFAULT = 120;
const HISTORY_LIMIT_MAX = 300;

function toUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

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

  const header = raw.slice(5, commaIndex); // after "data:"
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

function toProofUrl(proofFile) {
  if (!proofFile) {
    return '';
  }

  return `/media/${proofFile.replace(/\\/g, '/')}`;
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
    return 'tier3';
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

  return 'tier1';
}

function getUserExtraTaskSlots(user) {
  const parsed = Number.parseInt(String(user.extraTaskSlots || 0), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(parsed, DEPOSIT_EXTRA_TASKS_MAX);
}

function getDailyLimit(user) {
  const tierId = resolveTierId(user);
  const baseLimit = DAILY_LIMIT_BY_TIER[tierId] || DAILY_LIMIT_BY_TIER.tier1;
  return baseLimit + getUserExtraTaskSlots(user);
}

function parseHistoryLimit(value) {
  const parsed = Number.parseInt(String(value || ''), 10);

  if (!Number.isFinite(parsed)) {
    return HISTORY_LIMIT_DEFAULT;
  }

  return Math.min(Math.max(parsed, 1), HISTORY_LIMIT_MAX);
}

function mapDepositEntry(doc) {
  const detailParts = [];

  if (doc.network) {
    detailParts.push(`${doc.network} deposit`);
  }

  if (doc.reference) {
    detailParts.push(doc.reference);
  }

  if (doc.note) {
    detailParts.push(doc.note);
  }

  return {
    id: `deposit-${doc._id}`,
    title: 'USDT Deposit',
    detail: detailParts.join(' | ') || 'Wallet top-up',
    amount: toUsd(doc.amount),
    status: doc.status || 'Completed',
    timeLabel: formatTimeLabel(doc.occurredAt || doc.createdAt),
    kind: 'deposit',
    network: doc.network || undefined,
    proofUrl: toProofUrl(doc.proofFile) || undefined,
    occurredAt: doc.occurredAt || doc.createdAt,
  };
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
  const detail = doc.artist ? `${doc.title} by ${doc.artist}` : doc.title;

  return {
    id: `task-${doc._id}`,
    title: `${doc.type} Task Earnings`,
    detail,
    amount: toUsd(doc.reward),
    status: 'Completed',
    timeLabel: formatTimeLabel(doc.completedAt || doc.createdAt),
    kind: 'music',
    occurredAt: doc.completedAt || doc.createdAt,
  };
}

router.get('/summary', requireAuth, async (req, res) => {
  const tierId = resolveTierId(req.user);
  const baseDailyLimit = DAILY_LIMIT_BY_TIER[tierId] || DAILY_LIMIT_BY_TIER.tier1;
  const extraTaskSlots = getUserExtraTaskSlots(req.user);
  const pendingDeposits = await WalletTransaction.countDocuments({
    userId: req.user._id,
    kind: 'deposit',
    status: 'Pending',
  });

  res.json({
    wallet: {
      balance: toUsd(req.user.walletBalance),
      withdrawable: toUsd(req.user.withdrawableBalance),
      totalDepositedUsd: toUsd(req.user.depositTotalUsd),
      lastDepositAt: req.user.lastDepositAt || null,
      pendingDeposits,
    },
    taskCapacity: {
      baseDailyLimit,
      extraTaskSlots,
      dailyLimit: getDailyLimit(req.user),
      usdPerExtraTask: DEPOSIT_USD_PER_EXTRA_TASK,
      maxExtraTaskSlots: DEPOSIT_EXTRA_TASKS_MAX,
    },
  });
});

router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const limit = parseHistoryLimit(req.query?.limit);

    const [deposits, withdrawals, completions] = await Promise.all([
      WalletTransaction.find({
        userId: req.user._id,
        kind: 'deposit',
      })
        .sort({ occurredAt: -1, createdAt: -1 })
        .limit(limit)
        .lean(),
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
      ...deposits.map(mapDepositEntry),
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

router.post('/deposit', requireAuth, async (req, res, next) => {
  try {
    const amountUsd = Number(req.body?.amountUsd);
    const network = String(req.body?.network || '')
      .trim()
      .toUpperCase();
    const reference = String(req.body?.reference || '').trim();
    const note = String(req.body?.note || '')
      .trim()
      .slice(0, 180);
    const proofDataUrl = req.body?.proofDataUrl;

    if (!Number.isFinite(amountUsd) || amountUsd < DEPOSIT_MIN_USD || amountUsd > DEPOSIT_MAX_USD) {
      return res.status(400).json({
        message: `Deposit amount should be between ${DEPOSIT_MIN_USD.toFixed(2)} and ${DEPOSIT_MAX_USD.toFixed(2)} USD`,
      });
    }

    if (!SUPPORTED_NETWORKS.has(network)) {
      return res.status(400).json({ message: 'Valid crypto network is required' });
    }

    if (reference.length < 3) {
      return res.status(400).json({ message: 'Payment reference should be at least 3 characters' });
    }

    let proofFile = '';

    if (proofDataUrl) {
      const parsed = parseProofDataUrl(proofDataUrl);

      if (!parsed) {
        return res.status(400).json({ message: 'Proof of payment must be a valid image or PDF' });
      }

      if (parsed.buffer.length > WALLET_PROOF_MAX_BYTES) {
        return res.status(400).json({
          message: `Proof file should be ${Math.floor(WALLET_PROOF_MAX_BYTES / (1024 * 1024))}MB or less`,
        });
      }

      await fs.mkdir(PROOF_DIR, { recursive: true });
      const fileName = `${req.user._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${parsed.extension}`;
      const filePath = path.join(PROOF_DIR, fileName);
      await fs.writeFile(filePath, parsed.buffer);
      proofFile = path.join('proofs', fileName);
    }

    const normalizedAmount = toUsd(amountUsd);

    const depositDoc = await WalletTransaction.create({
      userId: req.user._id,
      kind: 'deposit',
      amount: normalizedAmount,
      status: 'Pending',
      network,
      reference,
      note,
      proofFile,
      occurredAt: new Date(),
    });

    return res.status(201).json({
      message: 'Deposit submitted and pending admin approval.',
      deposit: {
        amountUsd: normalizedAmount,
        network,
        reference,
        note,
        ...(proofFile ? { proofUrl: toProofUrl(proofFile) } : {}),
        status: 'Pending',
        depositedAt: depositDoc.occurredAt,
        historyId: `deposit-${depositDoc._id}`,
      },
      wallet: {
        balance: toUsd(req.user.walletBalance),
        withdrawable: toUsd(req.user.withdrawableBalance),
      },
      taskCapacity: {
        dailyLimit: getDailyLimit(req.user),
        extraTaskSlots: getUserExtraTaskSlots(req.user),
        usdPerExtraTask: DEPOSIT_USD_PER_EXTRA_TASK,
      },
      user: toPublicUser(req.user),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/withdraw', requireAuth, async (req, res, next) => {
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
