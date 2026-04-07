const express = require('express');

const Music = require('../models/Music');
const Ad = require('../models/Ad');
const TaskCompletion = require('../models/TaskCompletion');
const { syncAllContent, mapMusicDoc, mapAdDoc } = require('../services/sync-content');
const { listTasks, seedDummyTasks } = require('../services/task-service');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();
const TASK_TYPES = new Set(['Music', 'Ads', 'Art']);

function toDayKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isDayKey(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function resolveDayKeyFromSessionId(sessionTaskId) {
  const match = /^(\d{4}-\d{2}-\d{2})-/.exec(sessionTaskId);
  return match ? match[1] : '';
}

function parseDateInput(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapCompletionDoc(doc) {
  return {
    id: String(doc._id),
    sessionTaskId: doc.sessionTaskId,
    sourceTaskId: doc.sourceTaskId || '',
    title: doc.title,
    artist: doc.artist || '',
    type: doc.type,
    reward: Number(doc.reward || 0),
    dayKey: doc.dayKey,
    scheduledAt: doc.scheduledAt || null,
    completedAt: doc.completedAt,
    createdAt: doc.createdAt,
  };
}

router.get('/music', requireAuth, async (req, res, next) => {
  try {
    const list = await Music.find().sort({ updatedAt: -1 }).lean();
    res.json(list.map(mapMusicDoc));
  } catch (error) {
    next(error);
  }
});

router.get('/ads', requireAuth, async (req, res, next) => {
  try {
    const list = await Ad.find().sort({ updatedAt: -1 }).lean();
    res.json(list.map(mapAdDoc));
  } catch (error) {
    next(error);
  }
});

router.get('/tasks', requireAuth, async (req, res, next) => {
  try {
    let tasks = await listTasks();

    if (tasks.length === 0) {
      await seedDummyTasks();
      tasks = await listTasks();
    }

    res.json(tasks);
  } catch (error) {
    next(error);
  }
});

router.get('/tasks/completions', requireAuth, async (req, res, next) => {
  try {
    const dayKey =
      typeof req.query?.dayKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.dayKey)
        ? req.query.dayKey
        : '';

    const filter = {
      userId: req.user._id,
      ...(dayKey ? { dayKey } : {}),
    };

    const completions = await TaskCompletion.find(filter).sort({ completedAt: -1 }).lean();
    const normalized = completions.map(mapCompletionDoc);

    res.json({
      dayKey: dayKey || null,
      ids: normalized.map((entry) => entry.sessionTaskId),
      completions: normalized,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/tasks/complete', requireAuth, async (req, res, next) => {
  try {
    const sessionTaskId = String(req.body?.sessionTaskId || '').trim();
    const sourceTaskId = String(req.body?.sourceTaskId || '').trim();
    const title = String(req.body?.title || '').trim();
    const artist = String(req.body?.artist || '').trim();
    const type = String(req.body?.type || '').trim();
    const rewardValue = Number(req.body?.reward);
    const completedAt = parseDateInput(req.body?.completedAt) || new Date();
    const scheduledAt = parseDateInput(req.body?.scheduledAt);
    const requestedDayKey = String(req.body?.dayKey || '').trim();

    if (!sessionTaskId || sessionTaskId.length < 3) {
      return res.status(400).json({ message: 'Valid sessionTaskId is required' });
    }

    if (!title) {
      return res.status(400).json({ message: 'Task title is required' });
    }

    if (!TASK_TYPES.has(type)) {
      return res.status(400).json({ message: 'Valid task type is required' });
    }

    if (!Number.isFinite(rewardValue) || rewardValue < 0 || rewardValue > 1000) {
      return res.status(400).json({ message: 'Valid reward amount is required' });
    }

    const reward = Number(rewardValue.toFixed(2));
    const dayKey =
      (isDayKey(requestedDayKey) && requestedDayKey) ||
      resolveDayKeyFromSessionId(sessionTaskId) ||
      toDayKey(completedAt);
    const existing = await TaskCompletion.findOne({
      userId: req.user._id,
      sessionTaskId,
    }).lean();

    if (existing) {
      return res.json({
        created: false,
        message: 'Completion already recorded',
        completion: mapCompletionDoc(existing),
        wallet: {
          balance: Number(req.user.walletBalance || 0),
          withdrawable: Number(req.user.withdrawableBalance || 0),
        },
      });
    }

    let completion;

    try {
      completion = await TaskCompletion.create({
        userId: req.user._id,
        sessionTaskId,
        sourceTaskId,
        title,
        artist,
        type,
        reward,
        dayKey,
        scheduledAt,
        completedAt,
      });
    } catch (writeError) {
      if (writeError && writeError.code === 11000) {
        const duplicate = await TaskCompletion.findOne({
          userId: req.user._id,
          sessionTaskId,
        }).lean();

        return res.json({
          created: false,
          message: 'Completion already recorded',
          completion: duplicate ? mapCompletionDoc(duplicate) : null,
          wallet: {
            balance: Number(req.user.walletBalance || 0),
            withdrawable: Number(req.user.withdrawableBalance || 0),
          },
        });
      }

      throw writeError;
    }

    if (reward > 0) {
      req.user.walletBalance = Number((Number(req.user.walletBalance || 0) + reward).toFixed(2));
      req.user.withdrawableBalance = Number(
        (Number(req.user.withdrawableBalance || 0) + reward).toFixed(2)
      );
      await req.user.save();
    }

    return res.status(201).json({
      created: true,
      message: 'Task completion recorded',
      completion: mapCompletionDoc(completion),
      wallet: {
        balance: Number(req.user.walletBalance || 0),
        withdrawable: Number(req.user.withdrawableBalance || 0),
      },
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/tasks/seed', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const report = await seedDummyTasks();
    res.json({
      message: 'Dummy tasks seeded',
      report,
    });
  } catch (error) {
    next(error);
  }
});

router.post('/sync', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const force = Boolean(req.body?.force);
    const report = await syncAllContent({ force });
    res.json({
      message: 'Content synced',
      report,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
