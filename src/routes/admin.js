const express = require('express');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const WalletTransaction = require('../models/WalletTransaction');

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

const DEPOSIT_USD_PER_EXTRA_TASK = parseEnvFloat('DEPOSIT_USD_PER_EXTRA_TASK', 5, 0.5, 1000);
const DEPOSIT_EXTRA_TASKS_MAX = parseEnvInteger('DEPOSIT_EXTRA_TASKS_MAX', 200, 0, 2000);

function toUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getUserExtraTaskSlots(user) {
  const parsed = Number.parseInt(String(user.extraTaskSlots || 0), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(parsed, DEPOSIT_EXTRA_TASKS_MAX);
}

function toProofUrl(proofFile) {
  if (!proofFile) {
    return '';
  }

  return `/media/${String(proofFile).replace(/\\/g, '/')}`;
}

const router = express.Router();

function mapWithdrawalRequest(doc) {
  const userName =
    doc.userId && typeof doc.userId === 'object'
      ? doc.userId.name || doc.userId.email || 'Unknown User'
      : 'Unknown User';

  const userEmail =
    doc.userId && typeof doc.userId === 'object' ? doc.userId.email || '' : '';

  return {
    id: String(doc._id),
    userName,
    userEmail,
    amount: Number(doc.amount || 0),
    paymentMethod: doc.paymentMethod || 'crypto',
    paymentReference: doc.paymentReference || '',
    status: doc.status || 'pending',
    requestedAt: doc.requestedAt || doc.createdAt || null,
    processedAt: doc.processedAt || null,
  };
}

function mapDeposit(doc) {
  const userName =
    doc.userId && typeof doc.userId === 'object'
      ? doc.userId.name || doc.userId.email || 'Unknown User'
      : 'Unknown User';

  const userEmail =
    doc.userId && typeof doc.userId === 'object' ? doc.userId.email || '' : '';

  return {
    id: String(doc._id),
    userName,
    userEmail,
    amount: Number(doc.amount || 0),
    network: doc.network || '',
    reference: doc.reference || '',
    note: doc.note || '',
    status: doc.status || 'Pending',
    requestedAt: doc.occurredAt || doc.createdAt || null,
    processedAt: doc.processedAt || null,
    proofUrl: toProofUrl(doc.proofFile) || '',
  };
}

router.get('/overview', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [totalUsers, totalTasks, activeUsers, totalTransactions, pendingWithdrawals, pendingDeposits] = await Promise.all([
      User.countDocuments(),
      Task.countDocuments(),
      User.countDocuments({ isActive: true }),
      TaskCompletion.countDocuments(),
      WithdrawalRequest.countDocuments({ status: 'pending' }),
      WalletTransaction.countDocuments({ kind: 'deposit', status: 'Pending' }),
    ]);

    const users = await User.find().sort({ createdAt: -1 }).limit(20).lean();
    const completions = await TaskCompletion.find()
      .sort({ completedAt: -1 })
      .limit(25)
      .populate({ path: 'userId', select: 'email name', options: { lean: true } })
      .lean();
    const withdrawalRequests = await WithdrawalRequest.find()
      .sort({ requestedAt: -1, createdAt: -1 })
      .limit(25)
      .populate({ path: 'userId', select: 'email name', options: { lean: true } })
      .lean();
    const deposits = await WalletTransaction.find({ kind: 'deposit' })
      .sort({ occurredAt: -1, createdAt: -1 })
      .limit(25)
      .populate({ path: 'userId', select: 'email name', options: { lean: true } })
      .lean();

    const userRows = users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      tier: user.tier || (user.role === 'admin' ? 'Admin' : 'Tier 1'),
      status: user.isActive ? 'Active' : 'Suspended',
      role: user.role,
    }));

    const transactions = completions.slice(0, 10).map((completion) => {
      const ownerName =
        completion.userId && typeof completion.userId === 'object'
          ? completion.userId.email || completion.userId.name || 'User'
          : 'User';

      return {
        id: `txn-${completion._id}`,
        type: `${completion.type} Reward - ${ownerName}`,
        amount: `+$${Number(completion.reward || 0).toFixed(2)}`,
        status: 'Completed',
      };
    });

    const withdrawals = withdrawalRequests.map(mapWithdrawalRequest);
    const depositRows = deposits.map(mapDeposit);

    res.json({
      users: userRows,
      transactions,
      withdrawals,
      deposits: depositRows,
      stats: {
        totalUsers,
        totalTasks,
        activeUsers,
        totalTransactions,
        pendingWithdrawals,
        pendingDeposits,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/deposits/:depositId/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const depositId = String(req.params.depositId || '').trim();
    const deposit = await WalletTransaction.findById(depositId).populate({
      path: 'userId',
      select: 'email name walletBalance withdrawableBalance depositTotalUsd extraTaskSlots lastDepositAt',
    });

    if (!deposit || deposit.kind !== 'deposit') {
      return res.status(404).json({ message: 'Deposit request not found' });
    }

    if (deposit.status !== 'Pending') {
      return res.status(400).json({ message: 'Only pending deposits can be approved' });
    }

    const user = await User.findById(deposit.userId);
    if (!user) {
      return res.status(404).json({ message: 'Deposit owner not found' });
    }

    const amount = Number(deposit.amount || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: 'Invalid deposit amount' });
    }

    const previousDepositTotalUsd = toUsd(user.depositTotalUsd);
    const currentExtraTaskSlots = getUserExtraTaskSlots(user);
    const nextDepositTotalUsd = toUsd(previousDepositTotalUsd + amount);
    const eligibleExtraTaskSlots = Math.min(
      DEPOSIT_EXTRA_TASKS_MAX,
      Math.floor(nextDepositTotalUsd / DEPOSIT_USD_PER_EXTRA_TASK)
    );
    const nextExtraTaskSlots = Math.max(currentExtraTaskSlots, eligibleExtraTaskSlots);
    const grantedTaskSlots = Math.max(0, nextExtraTaskSlots - currentExtraTaskSlots);

    user.depositTotalUsd = nextDepositTotalUsd;
    user.extraTaskSlots = nextExtraTaskSlots;
    user.lastDepositAt = deposit.occurredAt || new Date();
    user.walletBalance = toUsd(user.walletBalance + amount);
    user.withdrawableBalance = toUsd(user.withdrawableBalance + amount);
    await user.save();

    deposit.status = 'Completed';
    deposit.processedAt = new Date();
    deposit.processedBy = req.user._id;
    deposit.decisionNote = String(req.body?.decisionNote || '').trim();
    await deposit.save();

    return res.json({
      message: grantedTaskSlots > 0
        ? `Deposit approved. +${grantedTaskSlots} extra daily tasks unlocked.`
        : 'Deposit approved and wallet credited.',
      deposit: mapDeposit(await deposit.populate({ path: 'userId', select: 'email name' })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/deposits/:depositId/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const depositId = String(req.params.depositId || '').trim();
    const deposit = await WalletTransaction.findById(depositId).populate({
      path: 'userId',
      select: 'email name',
    });

    if (!deposit || deposit.kind !== 'deposit') {
      return res.status(404).json({ message: 'Deposit request not found' });
    }

    if (deposit.status !== 'Pending') {
      return res.status(400).json({ message: 'Only pending deposits can be rejected' });
    }

    deposit.status = 'Failed';
    deposit.processedAt = new Date();
    deposit.processedBy = req.user._id;
    deposit.decisionNote = String(req.body?.decisionNote || '').trim();
    await deposit.save();

    return res.json({
      message: 'Deposit rejected',
      deposit: mapDeposit(deposit),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/withdrawals/:requestId/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const requestId = String(req.params.requestId || '').trim();
    const request = await WithdrawalRequest.findById(requestId);

    if (!request) {
      return res.status(404).json({ message: 'Withdrawal request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    const user = await User.findById(request.userId);
    if (!user) {
      return res.status(404).json({ message: 'Request owner not found' });
    }

    const amount = Number(request.amount || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: 'Invalid withdrawal amount' });
    }

    if (Number(user.withdrawableBalance || 0) < amount) {
      return res
        .status(400)
        .json({ message: 'Insufficient withdrawable balance for this request' });
    }

    user.withdrawableBalance = Number((Number(user.withdrawableBalance || 0) - amount).toFixed(2));
    user.walletBalance = Number(Math.max(0, Number(user.walletBalance || 0) - amount).toFixed(2));
    await user.save();

    request.status = 'approved';
    request.processedAt = new Date();
    request.processedBy = req.user._id;
    request.decisionNote = String(req.body?.decisionNote || '').trim();
    await request.save();

    return res.json({
      message: 'Withdrawal approved',
      request: mapWithdrawalRequest(await request.populate({ path: 'userId', select: 'email name' })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/withdrawals/:requestId/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const requestId = String(req.params.requestId || '').trim();
    const request = await WithdrawalRequest.findById(requestId).populate({
      path: 'userId',
      select: 'email name',
    });

    if (!request) {
      return res.status(404).json({ message: 'Withdrawal request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    request.status = 'rejected';
    request.processedAt = new Date();
    request.processedBy = req.user._id;
    request.decisionNote = String(req.body?.decisionNote || '').trim();
    await request.save();

    return res.json({
      message: 'Withdrawal rejected',
      request: mapWithdrawalRequest(request),
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
