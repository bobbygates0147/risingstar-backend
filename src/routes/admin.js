const express = require('express');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const User = require('../models/User');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const WithdrawalRequest = require('../models/WithdrawalRequest');

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

router.get('/overview', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [totalUsers, totalTasks, activeUsers, totalTransactions, pendingWithdrawals] = await Promise.all([
      User.countDocuments(),
      Task.countDocuments(),
      User.countDocuments({ isActive: true }),
      TaskCompletion.countDocuments(),
      WithdrawalRequest.countDocuments({ status: 'pending' }),
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

    res.json({
      users: userRows,
      transactions,
      withdrawals,
      stats: {
        totalUsers,
        totalTasks,
        activeUsers,
        totalTransactions,
        pendingWithdrawals,
      },
    });
  } catch (error) {
    next(error);
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
