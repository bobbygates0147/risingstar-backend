const express = require('express');

const Music = require('../models/Music');
const Ad = require('../models/Ad');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const { syncAllContent, mapMusicDoc, mapAdDoc } = require('../services/sync-content');
const { listTasks, seedDummyTasks } = require('../services/task-service');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();
const TASK_TYPES = new Set(['Music', 'Ads', 'Art']);
const MAX_TASK_REWARD_USD = 1;

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
const DEPOSIT_EXTRA_TASKS_MAX = parseEnvInteger('DEPOSIT_EXTRA_TASKS_MAX', 200, 0, 2000);

const TASK_REWARD_MULTIPLIER_BY_TIER = {
  tier1: parseEnvFloat('TASK_REWARD_MULTIPLIER_TIER1', 0.55, 0.1, 2),
  tier2: parseEnvFloat('TASK_REWARD_MULTIPLIER_TIER2', 0.8, 0.1, 2),
  tier3: parseEnvFloat('TASK_REWARD_MULTIPLIER_TIER3', 1, 0.1, 2),
};

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

function resolveSourceTaskId(sessionTaskId, sourceTaskId) {
  if (sourceTaskId) {
    return sourceTaskId;
  }

  const match = /^\d{4}-\d{2}-\d{2}-\d+-(.+)$/.exec(sessionTaskId);
  return match ? String(match[1] || '').trim() : '';
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

function getDailyLimit(user) {
  const tierLimit = DAILY_LIMIT_BY_TIER[resolveTierId(user)] || DAILY_LIMIT_BY_TIER.tier1;
  const extraTaskSlots = Math.max(
    0,
    Math.min(
      DEPOSIT_EXTRA_TASKS_MAX,
      Number.parseInt(String(user.extraTaskSlots || 0), 10) || 0
    )
  );

  return tierLimit + extraTaskSlots;
}

function resolveRewardForTier(baseReward, user) {
  const tierId = resolveTierId(user);
  const multiplier = TASK_REWARD_MULTIPLIER_BY_TIER[tierId] || 1;
  const normalizedBase = Math.max(0, Number(baseReward || 0));
  const scaled = normalizedBase * multiplier;
  return Number(Math.min(MAX_TASK_REWARD_USD, scaled).toFixed(2));
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
    const requestedSourceTaskId = String(req.body?.sourceTaskId || '').trim();
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

    const sourceTaskId = resolveSourceTaskId(sessionTaskId, requestedSourceTaskId);
    const sourceTask = sourceTaskId ? await Task.findOne({ taskId: sourceTaskId }).lean() : null;
    const fallbackReward = Math.min(MAX_TASK_REWARD_USD, Math.max(0, Number(rewardValue.toFixed(2))));
    const reward = resolveRewardForTier(Number(sourceTask?.reward ?? fallbackReward), req.user);
    const normalizedTitle = String(sourceTask?.title || title).trim();
    const normalizedArtist = String(sourceTask?.artist || artist).trim();
    const normalizedType = String(sourceTask?.type || type).trim();

    if (!normalizedTitle) {
      return res.status(400).json({ message: 'Task title is required' });
    }

    if (!TASK_TYPES.has(normalizedType)) {
      return res.status(400).json({ message: 'Valid task type is required' });
    }

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

    const dailyLimit = getDailyLimit(req.user);
    if (dailyLimit > 0) {
      const todayCompletionCount = await TaskCompletion.countDocuments({
        userId: req.user._id,
        dayKey,
      });

      if (todayCompletionCount >= dailyLimit) {
        return res.status(429).json({
          message: `Daily task quota reached (${dailyLimit} tasks)`,
          wallet: {
            balance: Number(req.user.walletBalance || 0),
            withdrawable: Number(req.user.withdrawableBalance || 0),
          },
        });
      }
    }

    let completion;

    try {
      completion = await TaskCompletion.create({
        userId: req.user._id,
        sessionTaskId,
        sourceTaskId,
        title: normalizedTitle,
        artist: normalizedArtist,
        type: normalizedType,
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
