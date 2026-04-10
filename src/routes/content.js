const path = require('path');
const crypto = require('crypto');
const fs = require('fs/promises');
const express = require('express');

const Music = require('../models/Music');
const Ad = require('../models/Ad');
const Task = require('../models/Task');
const TaskCompletion = require('../models/TaskCompletion');
const TaskPackPurchase = require('../models/TaskPackPurchase');
const { syncAllContent, mapMusicDoc, mapAdDoc } = require('../services/sync-content');
const { listTasks, seedDummyTasks } = require('../services/task-service');
const {
  resolveTaskArtist,
  resolveTaskTitle,
} = require('../services/task-catalog-metadata');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const router = express.Router();
const TASK_TYPES = new Set(['Music', 'Ads', 'Art']);
const MAX_TASK_REWARD_USD = 1;
const DEFAULT_TASK_PACKS = [
  { id: 'pack-5', label: '5 tasks', tasks: 5, priceUsd: 2 },
  { id: 'pack-10', label: '10 tasks', tasks: 10, priceUsd: 4 },
  { id: 'pack-25', label: '25 tasks', tasks: 25, priceUsd: 10 },
  { id: 'pack-50', label: '50 tasks', tasks: 50, priceUsd: 20 },
  { id: 'pack-75', label: '75 tasks', tasks: 75, priceUsd: 30 },
  { id: 'pack-100', label: '100 tasks', tasks: 100, priceUsd: 40 },
  { id: 'pack-125', label: '125 tasks', tasks: 125, priceUsd: 50 },
];
const TASK_PACKS = (() => {
  const raw = String(process.env.TASK_PACKS || '').trim();
  if (!raw) {
    return DEFAULT_TASK_PACKS;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return DEFAULT_TASK_PACKS;
    }

    const normalized = parsed
      .map((item) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const pack = item;
        const id = String(pack.id || '').trim();
        const label = String(pack.label || '').trim();
        const tasks = Number(pack.tasks || 0);
        const priceUsd = Number(pack.priceUsd || 0);

        if (!id || !label || !Number.isFinite(tasks) || tasks <= 0 || !Number.isFinite(priceUsd) || priceUsd <= 0) {
          return null;
        }

        return { id, label, tasks, priceUsd };
      })
      .filter((item) => item !== null);

    return normalized.length > 0 ? normalized : DEFAULT_TASK_PACKS;
  } catch {
    return DEFAULT_TASK_PACKS;
  }
})();
const TASK_PACK_PROOF_DIR = path.resolve(__dirname, '..', '..', 'downloads', 'task-pack-proofs');
const rawPackProofLimit = Number.parseInt(process.env.TASK_PACK_PROOF_MAX_BYTES || '', 10);
const TASK_PACK_PROOF_MAX_BYTES = Number.isFinite(rawPackProofLimit)
  ? Math.min(Math.max(rawPackProofLimit, 200 * 1024), 10 * 1024 * 1024)
  : 4 * 1024 * 1024;
const SUPPORTED_PACK_PROOF_TYPES = new Map([
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

const TASK_REWARD_MULTIPLIER_BY_TIER = {
  tier1: parseEnvFloat('TASK_REWARD_MULTIPLIER_TIER1', 0.55, 0.1, 2),
  tier2: parseEnvFloat('TASK_REWARD_MULTIPLIER_TIER2', 0.8, 0.1, 2),
  tier3: parseEnvFloat('TASK_REWARD_MULTIPLIER_TIER3', 1, 0.1, 2),
};

function hasRequiredTaskTypes(tasks) {
  const types = new Set(tasks.map((task) => task.type));
  return types.has('Music') && types.has('Art') && types.has('Ads');
}

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

function getTaskPack(packId) {
  return TASK_PACKS.find((pack) => pack.id === packId) || null;
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

  const header = raw.slice(5, commaIndex);
  const payload = raw.slice(commaIndex + 1);
  const headerParts = header.split(';').filter(Boolean);
  const mimeType = (headerParts[0] || '').toLowerCase();
  const isBase64 = headerParts.some((part) => part.toLowerCase() === 'base64');

  if (!mimeType || !isBase64 || !SUPPORTED_PACK_PROOF_TYPES.has(mimeType)) {
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
    extension: SUPPORTED_PACK_PROOF_TYPES.get(mimeType),
    buffer,
  };
}

function getDailyLimit(user) {
  const tierLimit = DAILY_LIMIT_BY_TIER[resolveTierId(user)] || DAILY_LIMIT_BY_TIER.tier1;
  const creditSlots = Math.max(
    0,
    Number.parseInt(String(user.taskCredits || 0), 10) || 0
  );

  return tierLimit + creditSlots;
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

    if (tasks.length === 0 || !hasRequiredTaskTypes(tasks)) {
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

router.get('/tasks/packs', requireAuth, (req, res) => {
  res.json({ packs: TASK_PACKS });
});

router.get('/tasks/packs/history', requireAuth, async (req, res, next) => {
  try {
    const statusFilter = String(req.query?.status || '').trim();
    const limitRaw = Number.parseInt(String(req.query?.limit || ''), 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 50) : 12;

    const filter = {
      userId: req.user._id,
      ...(statusFilter ? { status: statusFilter } : {}),
    };

    const purchases = await TaskPackPurchase.find(filter)
      .sort({ requestedAt: -1, createdAt: -1 })
      .limit(limit)
      .lean();

    const history = purchases.map((purchase) => ({
      id: String(purchase._id),
      packLabel: purchase.packLabel || '',
      tasks: Number(purchase.tasks || 0),
      priceUsd: Number(purchase.priceUsd || 0),
      status: purchase.status || 'Pending',
      requestedAt: purchase.requestedAt || purchase.createdAt || null,
      processedAt: purchase.processedAt || null,
    }));

    return res.json({ history });
  } catch (error) {
    return next(error);
  }
});

router.post('/tasks/purchase-pack', requireAuth, async (req, res, next) => {
  try {
    const packId = String(req.body?.packId || '').trim();
    const paymentMethod = String(req.body?.paymentMethod || '').trim().toLowerCase();
    const paymentTxHash = String(req.body?.paymentTxHash || '').trim();
    const paymentNetworkRaw = String(req.body?.paymentNetwork || '').trim();
    const paymentProofDataUrl = req.body?.paymentProofDataUrl;
    const pack = getTaskPack(packId);

    if (!pack) {
      return res.status(400).json({ message: 'Invalid task pack selected' });
    }

    if (paymentMethod !== 'crypto') {
      return res.status(400).json({ message: 'Crypto payment is required for task packs' });
    }

    let proofFile = '';
    let status = 'Pending';

    if (!paymentTxHash || paymentTxHash.length < 8) {
      return res.status(400).json({ message: 'Transaction hash is required for crypto payments' });
    }

    const allowedNetworks = new Set([
      'USDT-TRC20',
      'USDT-ERC20',
      'USDT-BEP20',
      'BTC',
      'ETH',
      'SOL',
    ]);
    const paymentNetwork = paymentNetworkRaw.toUpperCase();
    const normalizedNetwork = allowedNetworks.has(paymentNetwork) ? paymentNetwork : '';

    if (paymentProofDataUrl) {
      const parsed = parseProofDataUrl(paymentProofDataUrl);

      if (!parsed) {
        return res.status(400).json({ message: 'Proof of payment must be a valid image or PDF' });
      }

      if (parsed.buffer.length > TASK_PACK_PROOF_MAX_BYTES) {
        return res.status(400).json({
          message: `Proof file should be ${Math.floor(TASK_PACK_PROOF_MAX_BYTES / (1024 * 1024))}MB or less`,
        });
      }

      await fs.mkdir(TASK_PACK_PROOF_DIR, { recursive: true });
      const fileName = `${req.user._id}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${parsed.extension}`;
      const filePath = path.join(TASK_PACK_PROOF_DIR, fileName);
      await fs.writeFile(filePath, parsed.buffer);
      proofFile = path.join('task-pack-proofs', fileName);
    }

    const purchase = await TaskPackPurchase.create({
      userId: req.user._id,
      packId: pack.id,
      packLabel: pack.label,
      tasks: pack.tasks,
      priceUsd: pack.priceUsd,
      paymentMethod,
      paymentTxHash,
      paymentNetwork: normalizedNetwork,
      paymentProofFile: proofFile,
      status,
      requestedAt: new Date(),
      ...(status === 'Completed' ? { processedAt: new Date(), processedBy: req.user._id } : {}),
    });

    await req.user.save();

    return res.status(201).json({
      message: 'Task pack submitted and pending verification.',
      pack: {
        id: pack.id,
        tasks: pack.tasks,
        priceUsd: pack.priceUsd,
      },
      purchase: {
        id: String(purchase._id),
        status: purchase.status,
      },
      wallet: {
        balance: Number(req.user.walletBalance || 0),
        withdrawable: Number(req.user.withdrawableBalance || 0),
      },
      taskCredits: Number(req.user.taskCredits || 0),
    });
  } catch (error) {
    return next(error);
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
    const normalizedType = String(sourceTask?.type || type).trim();

    if (!TASK_TYPES.has(normalizedType)) {
      return res.status(400).json({ message: 'Valid task type is required' });
    }

    const rawTitle = String(sourceTask?.title || title).trim();
    const rawArtist = String(sourceTask?.artist || artist).trim();
    const normalizedTitle = resolveTaskTitle(normalizedType, sourceTaskId || sessionTaskId, rawTitle);
    const normalizedArtist = resolveTaskArtist(
      normalizedType,
      sourceTaskId || sessionTaskId,
      rawTitle,
      rawArtist
    );

    if (!normalizedTitle) {
      return res.status(400).json({ message: 'Task title is required' });
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
    const taskCredits = Number(req.user.taskCredits || 0);

    if (taskCredits <= 0) {
      return res.status(402).json({
        message: 'No task credits available. Purchase a task pack to continue.',
        wallet: {
          balance: Number(req.user.walletBalance || 0),
          withdrawable: Number(req.user.withdrawableBalance || 0),
        },
        taskCredits: Math.max(0, taskCredits),
      });
    }

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

    req.user.taskCredits = Math.max(0, taskCredits - 1);

    if (reward > 0) {
      req.user.walletBalance = Number((Number(req.user.walletBalance || 0) + reward).toFixed(2));
      req.user.withdrawableBalance = Number(
        (Number(req.user.withdrawableBalance || 0) + reward).toFixed(2)
      );
    }

    await req.user.save();

    return res.status(201).json({
      created: true,
      message: 'Task completion recorded',
      completion: mapCompletionDoc(completion),
      wallet: {
        balance: Number(req.user.walletBalance || 0),
        withdrawable: Number(req.user.withdrawableBalance || 0),
      },
      taskCredits: Number(req.user.taskCredits || 0),
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
