const express = require('express');

const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const WithdrawalRequest = require('../models/WithdrawalRequest');

const router = express.Router();
const REFRESH_INTERVAL_MS = 15_000;
const SEEDED_ROTATION_LIMIT = 10;

function parseEnvFloat(name, fallback, min, max) {
  const parsed = Number.parseFloat(process.env[name] || '');

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

const MIN_LEADERBOARD_WITHDRAW_USD = parseEnvFloat(
  'LEADERBOARD_MIN_WITHDRAW_USD',
  500,
  1,
  1000000
);

const DUMMY_WITHDRAWAL_LEADERS = [
  {
    id: 'dummy-maya',
    name: 'Maya Holt',
    country: 'United States',
    tier: 'Tier 3',
    baseWithdrawnUsd: 7840,
    growthUsd: 78,
    withdrawalCount: 16,
    biggestWithdrawalUsd: 1250,
    lastWithdrawalOffsetMinutes: 18,
    badge: 'Top Cashout',
  },
  {
    id: 'dummy-korede',
    name: 'Korede Miles',
    country: 'Nigeria',
    tier: 'Tier 3',
    baseWithdrawnUsd: 6425,
    growthUsd: 94,
    withdrawalCount: 14,
    biggestWithdrawalUsd: 980,
    lastWithdrawalOffsetMinutes: 32,
    badge: 'Fast Payouts',
  },
  {
    id: 'dummy-rina',
    name: 'Rina Banks',
    country: 'United Kingdom',
    tier: 'Tier 2',
    baseWithdrawnUsd: 5890,
    growthUsd: 62,
    withdrawalCount: 11,
    biggestWithdrawalUsd: 720,
    lastWithdrawalOffsetMinutes: 44,
    badge: 'Clean Run',
  },
  {
    id: 'dummy-zane',
    name: 'Zane Carter',
    country: 'Canada',
    tier: 'Tier 2',
    baseWithdrawnUsd: 5340,
    growthUsd: 71,
    withdrawalCount: 8,
    biggestWithdrawalUsd: 640,
    lastWithdrawalOffsetMinutes: 65,
    badge: 'Weekly Climber',
  },
  {
    id: 'dummy-amara',
    name: 'Amara Lee',
    country: 'Ghana',
    tier: 'Tier 1',
    baseWithdrawnUsd: 4680,
    growthUsd: 85,
    withdrawalCount: 9,
    biggestWithdrawalUsd: 580,
    lastWithdrawalOffsetMinutes: 80,
    badge: 'Rising Cashout',
  },
  {
    id: 'dummy-sofia',
    name: 'Sofia Marin',
    country: 'Spain',
    tier: 'Tier 3',
    baseWithdrawnUsd: 6175,
    growthUsd: 88,
    withdrawalCount: 13,
    biggestWithdrawalUsd: 910,
    lastWithdrawalOffsetMinutes: 24,
    badge: 'Global Surge',
  },
  {
    id: 'dummy-hiro',
    name: 'Hiro Tanaka',
    country: 'Japan',
    tier: 'Tier 2',
    baseWithdrawnUsd: 5520,
    growthUsd: 66,
    withdrawalCount: 10,
    biggestWithdrawalUsd: 760,
    lastWithdrawalOffsetMinutes: 52,
    badge: 'Tokyo Cashout',
  },
  {
    id: 'dummy-leila',
    name: 'Leila Haddad',
    country: 'UAE',
    tier: 'Tier 3',
    baseWithdrawnUsd: 7010,
    growthUsd: 73,
    withdrawalCount: 15,
    biggestWithdrawalUsd: 1120,
    lastWithdrawalOffsetMinutes: 38,
    badge: 'Premium Payout',
  },
  {
    id: 'dummy-thabo',
    name: 'Thabo Ndlovu',
    country: 'South Africa',
    tier: 'Tier 2',
    baseWithdrawnUsd: 4915,
    growthUsd: 79,
    withdrawalCount: 9,
    biggestWithdrawalUsd: 690,
    lastWithdrawalOffsetMinutes: 73,
    badge: 'Cape Town Run',
  },
  {
    id: 'dummy-ana',
    name: 'Ana Ribeiro',
    country: 'Brazil',
    tier: 'Tier 2',
    baseWithdrawnUsd: 5135,
    growthUsd: 68,
    withdrawalCount: 10,
    biggestWithdrawalUsd: 705,
    lastWithdrawalOffsetMinutes: 58,
    badge: 'Rio Climber',
  },
  {
    id: 'dummy-noah',
    name: 'Noah Keller',
    country: 'Germany',
    tier: 'Tier 3',
    baseWithdrawnUsd: 6750,
    growthUsd: 57,
    withdrawalCount: 12,
    biggestWithdrawalUsd: 1050,
    lastWithdrawalOffsetMinutes: 29,
    badge: 'Euro Payout',
  },
  {
    id: 'dummy-aisha',
    name: 'Aisha Khan',
    country: 'Pakistan',
    tier: 'Tier 2',
    baseWithdrawnUsd: 4760,
    growthUsd: 82,
    withdrawalCount: 8,
    biggestWithdrawalUsd: 630,
    lastWithdrawalOffsetMinutes: 90,
    badge: 'Fresh Topper',
  },
];

function toUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function formatTimeLabel(value, now = new Date()) {
  const date = new Date(value);
  const deltaMs = now.getTime() - date.getTime();

  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

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
  }).format(date);
}

function buildWithdrawalRow({
  badge,
  biggestWithdrawalUsd,
  id,
  isCurrentUser = false,
  lastWithdrawalAt,
  name,
  country = '',
  source,
  sourceUserId = '',
  tier,
  totalWithdrawnUsd,
  withdrawalCount,
}) {
  const lastWithdrawalDate = lastWithdrawalAt ? new Date(lastWithdrawalAt) : null;
  const safeLastWithdrawalAt =
    lastWithdrawalDate && !Number.isNaN(lastWithdrawalDate.getTime())
      ? lastWithdrawalDate
      : null;

  return {
    id,
    source,
    sourceUserId,
    name,
    country,
    tier,
    totalWithdrawnUsd: toUsd(totalWithdrawnUsd),
    withdrawalCount: Math.max(0, Number(withdrawalCount || 0)),
    biggestWithdrawalUsd: toUsd(biggestWithdrawalUsd),
    lastWithdrawalAt: safeLastWithdrawalAt ? safeLastWithdrawalAt.toISOString() : null,
    lastWithdrawalLabel: safeLastWithdrawalAt
      ? formatTimeLabel(safeLastWithdrawalAt)
      : 'No withdrawal yet',
    badge,
    isCurrentUser,
  };
}

function buildDummyRows(now) {
  const slot = Math.floor(now.getTime() / REFRESH_INTERVAL_MS);

  return DUMMY_WITHDRAWAL_LEADERS.map((leader, index) => {
    const momentum = (slot + index * 7) % 96;
    const burst = ((slot + index * 3) % 5) * 11.35;
    const lastWithdrawalOffsetMinutes =
      1 + ((leader.lastWithdrawalOffsetMinutes + slot * (index + 2)) % 110);
    const totalWithdrawnUsd =
      leader.baseWithdrawnUsd + momentum * leader.growthUsd + burst;
    const biggestWithdrawalUsd =
      leader.biggestWithdrawalUsd + ((slot + index) % 6) * 24.5;

    return buildWithdrawalRow({
      ...leader,
      source: 'seeded',
      sourceUserId: '',
      totalWithdrawnUsd,
      biggestWithdrawalUsd,
      withdrawalCount: leader.withdrawalCount + Math.floor(momentum / 18),
      lastWithdrawalAt: new Date(
        now.getTime() - lastWithdrawalOffsetMinutes * 60 * 1000
      ),
    });
  })
    .sort((left, right) => right.totalWithdrawnUsd - left.totalWithdrawnUsd)
    .slice(0, SEEDED_ROTATION_LIMIT);
}

function rankRows(rows) {
  const rankedRows = rows
    .sort((left, right) => {
      if (right.totalWithdrawnUsd !== left.totalWithdrawnUsd) {
        return right.totalWithdrawnUsd - left.totalWithdrawnUsd;
      }

      if (right.biggestWithdrawalUsd !== left.biggestWithdrawalUsd) {
        return right.biggestWithdrawalUsd - left.biggestWithdrawalUsd;
      }

      return right.withdrawalCount - left.withdrawalCount;
    })
    .map((row, index) => ({
      ...row,
      rank: index + 1,
    }));
  const topRows = rankedRows.slice(0, 10);

  if (topRows.some((row) => row.isCurrentUser)) {
    return topRows;
  }

  const currentUserRow = rankedRows.find((row) => row.isCurrentUser);
  if (!currentUserRow) {
    return topRows;
  }

  return [...topRows.slice(0, 9), currentUserRow];
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const withdrawalRows = await WithdrawalRequest.aggregate([
      {
        $match: {
          status: 'approved',
          amount: { $gt: 0 },
          userId: { $exists: true, $ne: null },
        },
      },
      {
        $group: {
          _id: '$userId',
          totalWithdrawnUsd: { $sum: '$amount' },
          withdrawalCount: { $sum: 1 },
          biggestWithdrawalUsd: { $max: '$amount' },
          lastWithdrawalAt: {
            $max: {
              $ifNull: ['$processedAt', '$requestedAt'],
            },
          },
        },
      },
      {
        $match: {
          totalWithdrawnUsd: { $gte: MIN_LEADERBOARD_WITHDRAW_USD },
        },
      },
      {
        $sort: {
          totalWithdrawnUsd: -1,
          biggestWithdrawalUsd: -1,
          withdrawalCount: -1,
        },
      },
      { $limit: 50 },
    ]);

    const userIds = withdrawalRows.map((row) => row._id);
    if (!userIds.some((id) => String(id) === String(req.user._id))) {
      userIds.push(req.user._id);
    }

    const users = await User.find({ _id: { $in: userIds } })
      .select('name tier')
      .lean();
    const userById = new Map(users.map((user) => [String(user._id), user]));

    const realRows = withdrawalRows
      .map((row) => {
        const userId = String(row._id);
        const user = userById.get(userId);

        if (!user) {
          return null;
        }

        const isCurrentUser = userId === String(req.user._id);

        return buildWithdrawalRow({
          id: `user-${userId}`,
          source: 'live',
          sourceUserId: userId,
          name: isCurrentUser ? `${user.name || 'You'} (You)` : user.name || 'Rising Star Member',
          country: 'Live member',
          tier: user.tier || 'Tier 1',
          totalWithdrawnUsd: row.totalWithdrawnUsd,
          withdrawalCount: row.withdrawalCount,
          biggestWithdrawalUsd: row.biggestWithdrawalUsd,
          lastWithdrawalAt: row.lastWithdrawalAt,
          badge: isCurrentUser ? 'Your Cashouts' : 'Live Cashout',
          isCurrentUser,
        });
      })
      .filter(Boolean);

    const rows = rankRows([...realRows, ...buildDummyRows(now)]);
    const currentUserRankedRow = rows.find((row) => row.isCurrentUser) || null;
    const liveRows = realRows.filter((row) => row.totalWithdrawnUsd > 0);
    const liveTotalWithdrawnUsd = toUsd(
      liveRows.reduce((total, row) => total + row.totalWithdrawnUsd, 0)
    );
    const highestWithdrawalUsd = toUsd(
      rows.reduce((highest, row) => Math.max(highest, row.biggestWithdrawalUsd), 0)
    );

    return res.json({
      updatedAt: now.toISOString(),
      refreshIntervalMs: REFRESH_INTERVAL_MS,
      stats: {
        rankedUsers: rows.length,
        liveUsers: liveRows.length,
        liveTotalWithdrawnUsd,
        highestWithdrawalUsd,
        minimumWithdrawalUsd: MIN_LEADERBOARD_WITHDRAW_USD,
        currentUserEligible: Boolean(currentUserRankedRow),
        currentUserRank: currentUserRankedRow ? currentUserRankedRow.rank : null,
        currentUserWithdrawnUsd: currentUserRankedRow
          ? toUsd(currentUserRankedRow.totalWithdrawnUsd)
          : 0,
      },
      entries: rows,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
