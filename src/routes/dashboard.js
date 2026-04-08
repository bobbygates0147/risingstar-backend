const express = require('express');

const { getCheckpointIntervalMinutes } = require('../config/ai-bot');
const {
  ensureAIBotSubscriptionState,
  getAIBotStatusLabel,
} = require('../services/ai-bot-status');
const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const ACTIVITY_ITEM_LIMIT = 8;
const ACTIVITY_LOG_LIMIT = 200;

function parseEnvInteger(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);

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

function getNextTierLabel(user) {
  if (user.role === 'admin') {
    return 'Tier 3';
  }

  const tier = String(user.tier || 'Tier 1');

  if (/tier\s*1/i.test(tier)) {
    return 'Tier 2';
  }

  if (/tier\s*2/i.test(tier)) {
    return 'Tier 3';
  }

  return 'Tier 3';
}

function startOfToday(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfWeek(date = new Date()) {
  const start = startOfToday(date);
  start.setDate(start.getDate() - 6);
  return start;
}

function formatRelativeTime(value, now = new Date()) {
  const completedAt = new Date(value);
  const deltaMs = now.getTime() - completedAt.getTime();

  if (deltaMs < 60 * 1000) {
    return 'Just now';
  }

  if (deltaMs < 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(deltaMs / (60 * 1000)))}m ago`;
  }

  if (deltaMs < 24 * 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(deltaMs / (60 * 60 * 1000)))}h ago`;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(completedAt);
}

function formatDateLabel(value, now = new Date()) {
  const date = new Date(value);
  const today = startOfToday(now);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date >= today) {
    return 'Today';
  }

  if (date >= yesterday && date < today) {
    return 'Yesterday';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function formatTimeLabel(value) {
  const date = new Date(value);

  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function toActivityKind(type) {
  if (type === 'Music') {
    return 'music';
  }

  if (type === 'Ads') {
    return 'ads';
  }

  return 'art';
}

function toDashboardCategory(type) {
  if (type === 'Music' || type === 'Ads' || type === 'Art') {
    return type;
  }

  return 'Music';
}

function sumRewards(completions) {
  return Number(
    completions
      .reduce((total, completion) => total + Number(completion.reward || 0), 0)
      .toFixed(2)
  );
}

function buildDashboardSummary(user, todayCompletions, weeklyCompletions) {
  const dailyLimit = getDailyLimit(user);
  const effectiveTodayCompletions =
    dailyLimit > 0 ? todayCompletions.slice(0, dailyLimit) : todayCompletions;
  const todayEarnings = sumRewards(effectiveTodayCompletions);
  const weeklyEarnings = sumRewards(weeklyCompletions);
  const completionRate =
    dailyLimit > 0
      ? Math.min(100, Math.round((effectiveTodayCompletions.length / dailyLimit) * 100))
      : 0;

  const aiBotStatus = getAIBotStatusLabel(user, new Date());

  return {
    balance: Number(user.walletBalance || 0),
    withdrawable: Number(user.withdrawableBalance || 0),
    todayEarnings,
    weeklyEarnings,
    dailyLimit,
    streak: Number(user.streak || 0),
    taskCompletionRate: completionRate,
    activeQueue: Math.max(0, dailyLimit - effectiveTodayCompletions.length),
    currentTier: user.tier || 'Tier 1',
    nextTier: getNextTierLabel(user),
    tierProgress: Math.min(92, Math.max(12, completionRate)),
    aiBotStatus,
    aiBotCheckpointIntervalMinutes: getCheckpointIntervalMinutes(),
  };
}

function buildDashboardActivity(completions) {
  const now = new Date();

  return completions.slice(0, ACTIVITY_ITEM_LIMIT).map((completion) => {
    const category = toDashboardCategory(completion.type);
    const detail = completion.artist ? `${completion.title} by ${completion.artist}` : completion.title;

    return {
      id: `activity-${completion._id}`,
      label: `${category} task completed`,
      category,
      amount: Number(completion.reward || 0),
      time: formatRelativeTime(completion.completedAt, now),
      detail,
    };
  });
}

function buildActivityLog(completions) {
  const now = new Date();

  return completions.slice(0, ACTIVITY_LOG_LIMIT).map((completion) => {
    const title = completion.artist
      ? `${completion.title} - ${completion.artist}`
      : completion.title;

    return {
      id: `log-${completion._id}`,
      amount: Number(completion.reward || 0),
      category: 'Tasks',
      dateLabel: formatDateLabel(completion.completedAt, now),
      detail: `${completion.type} reward credited to wallet`,
      kind: toActivityKind(completion.type),
      timeLabel: formatTimeLabel(completion.completedAt),
      title,
    };
  });
}

router.get('/dashboard', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const aiStateChanged = ensureAIBotSubscriptionState(req.user, now);
    if (aiStateChanged || req.user.isModified()) {
      await req.user.save();
    }
    const startTodayAt = startOfToday(now);
    const startWeekAt = startOfWeek(now);

    const recentCompletions = await TaskCompletion.find({
      userId: req.user._id,
      completedAt: { $gte: startWeekAt },
    })
      .sort({ completedAt: -1 })
      .lean();

    const todayCompletions = recentCompletions.filter(
      (completion) => new Date(completion.completedAt).getTime() >= startTodayAt.getTime()
    );

    const summary = buildDashboardSummary(req.user, todayCompletions, recentCompletions);
    const activity = buildDashboardActivity(recentCompletions);

    res.json({ summary, activity });
  } catch (error) {
    next(error);
  }
});

router.get('/activity/log', requireAuth, async (req, res, next) => {
  try {
    const completions = await TaskCompletion.find({ userId: req.user._id })
      .sort({ completedAt: -1 })
      .limit(ACTIVITY_LOG_LIMIT)
      .lean();

    res.json(buildActivityLog(completions));
  } catch (error) {
    next(error);
  }
});

module.exports = router;
