const express = require('express');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const WithdrawalRequest = require('../models/WithdrawalRequest');
const TaskPackPurchase = require('../models/TaskPackPurchase');

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

function mapTaskPackPurchase(doc) {
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
    packLabel: doc.packLabel || '',
    tasks: Number(doc.tasks || 0),
    priceUsd: Number(doc.priceUsd || 0),
    paymentMethod: doc.paymentMethod || 'crypto',
    paymentTxHash: doc.paymentTxHash || '',
    paymentNetwork: doc.paymentNetwork || '',
    status: doc.status || 'Pending',
    requestedAt: doc.requestedAt || doc.createdAt || null,
    processedAt: doc.processedAt || null,
    proofUrl: toProofUrl(doc.paymentProofFile) || '',
  };
}

router.get('/overview', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [totalUsers, totalTasks, activeUsers, totalTransactions, pendingWithdrawals, pendingTaskPacks] = await Promise.all([
      User.countDocuments(),
      Task.countDocuments(),
      User.countDocuments({ isActive: true }),
      TaskCompletion.countDocuments(),
      WithdrawalRequest.countDocuments({ status: 'pending' }),
      TaskPackPurchase.countDocuments({ status: 'Pending' }),
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
    const taskPackPurchases = await TaskPackPurchase.find()
      .sort({ requestedAt: -1, createdAt: -1 })
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
      aiBotStatus: user.aiBotEnabled ? 'Active' : 'Inactive',
      aiBotVerificationStatus: user.aiBotVerificationStatus || 'verified',
      aiBotPaymentTxHash: user.aiBotPaymentTxHash || user.aiBotPaymentReference || '',
      aiBotProofUrl: toProofUrl(user.aiBotPaymentProofFile) || '',
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
    const taskPackRows = taskPackPurchases.map(mapTaskPackPurchase);

    res.json({
      users: userRows,
      transactions,
      withdrawals,
      taskPacks: taskPackRows,
      stats: {
        totalUsers,
        totalTasks,
        activeUsers,
        totalTransactions,
        pendingWithdrawals,
        pendingTaskPacks,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/task-packs/:purchaseId/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const purchaseId = String(req.params.purchaseId || '').trim();
    const purchase = await TaskPackPurchase.findById(purchaseId).populate({
      path: 'userId',
      select: 'email name taskCredits',
    });

    if (!purchase) {
      return res.status(404).json({ message: 'Task pack purchase not found' });
    }

    if (purchase.status !== 'Pending') {
      return res.status(400).json({ message: 'Only pending purchases can be approved' });
    }

    const user = await User.findById(purchase.userId);
    if (!user) {
      return res.status(404).json({ message: 'Purchase owner not found' });
    }

    user.taskCredits = Math.max(0, Number(user.taskCredits || 0)) + Number(purchase.tasks || 0);
    await user.save();

    purchase.status = 'Completed';
    purchase.processedAt = new Date();
    purchase.processedBy = req.user._id;
    purchase.decisionNote = String(req.body?.decisionNote || '').trim();
    await purchase.save();

    return res.json({
      message: 'Task pack approved and credits added.',
      purchase: mapTaskPackPurchase(await purchase.populate({ path: 'userId', select: 'email name' })),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/task-packs/:purchaseId/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const purchaseId = String(req.params.purchaseId || '').trim();
    const purchase = await TaskPackPurchase.findById(purchaseId).populate({
      path: 'userId',
      select: 'email name',
    });

    if (!purchase) {
      return res.status(404).json({ message: 'Task pack purchase not found' });
    }

    if (purchase.status !== 'Pending') {
      return res.status(400).json({ message: 'Only pending purchases can be rejected' });
    }

    purchase.status = 'Rejected';
    purchase.processedAt = new Date();
    purchase.processedBy = req.user._id;
    purchase.decisionNote = String(req.body?.decisionNote || '').trim();
    await purchase.save();

    return res.json({
      message: 'Task pack rejected',
      purchase: mapTaskPackPurchase(purchase),
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

router.post('/ai-bot/:userId/verify', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.aiBotVerificationStatus = 'verified';
    user.aiBotVerifiedAt = new Date();
    user.aiBotVerifiedBy = req.user._id;
    await user.save();

    return res.json({
      message: 'AI Bot payment verified',
      user: {
        id: String(user._id),
        aiBotVerificationStatus: user.aiBotVerificationStatus,
        aiBotVerifiedAt: user.aiBotVerifiedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/ai-bot/:userId/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const userId = String(req.params.userId || '').trim();
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.aiBotVerificationStatus = 'rejected';
    user.aiBotVerifiedAt = new Date();
    user.aiBotVerifiedBy = req.user._id;
    await user.save();

    return res.json({
      message: 'AI Bot payment rejected',
      user: {
        id: String(user._id),
        aiBotVerificationStatus: user.aiBotVerificationStatus,
        aiBotVerifiedAt: user.aiBotVerifiedAt,
      },
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
