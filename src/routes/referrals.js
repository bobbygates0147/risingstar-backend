const express = require('express');

const { requireAuth } = require('../middleware/auth');
const User = require('../models/User');
const { ensureUserReferralCode } = require('../services/auth-service');
const { isRegistrationApproved } = require('../services/registration-state');

const router = express.Router();

function parseEnvInteger(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

const REWARD_TIERS = [
  {
    id: 'tier1',
    label: 'Tier 1',
    target: parseEnvInteger('REFERRAL_TIER1_TARGET', 5, 1, 100000),
    priceRange: 'Low-cost / everyday',
    giftItems: [
      'Fast charger',
      'USB cable',
      'Phone case',
      'Earphones (wired)',
      'Ring light mini',
      'Pop socket',
      'Phone stand',
      'Car charger',
      'Power adapter',
      'Bluetooth selfie button',
      'Mini torch light',
      'Wallet',
      'Face cap',
      'Water bottle',
      'Key holder',
      'Portable fan mini',
      'Socks pack',
      'Screen protector',
      'Mouse pad',
      'Rechargeable lighter',
      'Small backpack',
      'Hand sanitizer pack',
      'Notebook + pen set',
      'Umbrella',
      'Mini speaker basic',
    ],
    cashBonusUsd: 10,
    badge: 'Starter Gadget',
  },
  {
    id: 'tier2',
    label: 'Tier 2',
    target: parseEnvInteger('REFERRAL_TIER2_TARGET', 10, 1, 100000),
    priceRange: 'Mid-value / lifestyle',
    giftItems: [
      'Wireless earpiece',
      'Power bank (10,000mAh)',
      'Bluetooth speaker',
      'Smartwatch basic',
      'Quality headset',
      'Hair clipper',
      'Standing fan mini rechargeable',
      'Tripod stand',
      'Gaming mouse',
      'Backpack premium',
      'Sneakers basic',
      'Perfume',
      'Electric kettle',
      'Blender mini',
      'LED room lights',
      'Car phone holder',
      'Hair dryer',
      'Pressing iron',
      'Phone pouch premium',
      'USB flash drive 64GB',
      'Mini fridge cosmetic type',
      'Portable radio',
      'Rechargeable lamp',
      'Wireless keyboard',
      'Sports bag',
    ],
    cashBonusUsd: 35,
    badge: 'Power Circle',
  },
  {
    id: 'tier3',
    label: 'Tier 3',
    target: parseEnvInteger('REFERRAL_TIER3_TARGET', 20, 1, 100000),
    priceRange: 'High-value / premium',
    giftItems: [
      'Air fryer',
      '32-inch TV',
      'Generator small',
      'Soundbar speaker',
      'iPad clone tablet',
      'Laptop basic',
      'PS4 used',
      'Premium smartwatch',
      'Office chair',
      'Microwave',
      'Gas cooker',
      'Washing machine small',
      'Home theater system',
      'Bicycle',
      'Infinix / Tecno phone',
      '50,000mAh power station',
      'Camera basic',
      'Refrigerator small',
      'Mattress',
      'Gold plated wristwatch',
      'VIP dinner voucher',
      'Weekend hotel stay',
      'Electric scooter basic',
      'Smart home camera set',
      'Designer shoes',
    ],
    cashBonusUsd: 75,
    badge: 'Elite Crew',
  },
  {
    id: 'tier4',
    label: 'Tier 4',
    target: parseEnvInteger('REFERRAL_TIER4_TARGET', 50, 1, 100000),
    priceRange: 'Luxury / flagship',
    giftItems: [
      'iPhone used flagship',
      'Samsung Galaxy flagship',
      'MacBook used',
      'HP EliteBook laptop',
      'iPad original used',
      'PS5 digital edition',
      'Xbox Series S',
      '55-inch smart TV',
      'Inverter generator',
      'Solar power kit',
      'Premium electric scooter',
      'Home office setup',
      'DSLR camera starter kit',
      'Premium sound system',
      'Smart home bundle',
      'Deep freezer',
      'Large refrigerator',
      'Washing machine full-size',
      'Luxury wristwatch',
      'Designer travel luggage',
      'Weekend resort package',
      'VIP event package',
      'Professional creator kit',
      'Gaming console bundle',
      'Premium smartphone bundle',
    ],
    cashBonusUsd: 150,
    badge: 'Star Partner',
  },
];

function toUsd(value) {
  return Number(Number(value || 0).toFixed(2));
}

function hashString(value) {
  return String(value || '').split('').reduce((hash, character) => {
    return (hash * 31 + character.charCodeAt(0)) >>> 0;
  }, 2166136261);
}

function selectGiftItem(tier, user) {
  const giftItems = Array.isArray(tier.giftItems) ? tier.giftItems : [];

  if (giftItems.length === 0) {
    return 'Referral gift item';
  }

  const seed = `${user?._id || ''}:${user?.email || ''}:${tier.id}`;
  return giftItems[hashString(seed) % giftItems.length];
}

function formatTimeLabel(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Recently';
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

function getEarnedRewardTiers(qualifiedCount) {
  return REWARD_TIERS.filter((tier) => qualifiedCount >= tier.target);
}

function getNextRewardTier(qualifiedCount) {
  return REWARD_TIERS.find((tier) => qualifiedCount < tier.target) || null;
}

function estimateReferralCashoutUsd(qualifiedCount) {
  const referralCashout = qualifiedCount * 4.75;
  const milestoneCashout = getEarnedRewardTiers(qualifiedCount).reduce(
    (total, tier) => total + tier.cashBonusUsd,
    0
  );

  return toUsd(referralCashout + milestoneCashout);
}

function buildRewards(qualifiedCount, user) {
  const nextReward = getNextRewardTier(qualifiedCount);

  return REWARD_TIERS.map((tier) => {
    const { giftItems, ...publicTier } = tier;
    const remaining = Math.max(0, tier.target - qualifiedCount);
    const progress = Math.min(100, Math.round((qualifiedCount / tier.target) * 100));
    const status =
      qualifiedCount >= tier.target
        ? 'unlocked'
        : nextReward && nextReward.id === tier.id
          ? 'active'
          : 'locked';

    return {
      ...publicTier,
      giftItem: selectGiftItem(tier, user),
      progress,
      remaining,
      status,
    };
  });
}

function mapReferralUser(user) {
  return {
    id: String(user._id),
    name: user.name || 'Rising Star Member',
    tier: user.tier || 'Tier 1',
    joinedAt: user.createdAt || user.referredAt || null,
    joinedLabel: formatTimeLabel(user.createdAt || user.referredAt),
    status: user.isActive && isRegistrationApproved(user) ? 'Qualified' : 'Pending',
  };
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const referralCode = await ensureUserReferralCode(req.user);
    const referralFilter = { referredBy: req.user._id };
    const referredUsers = await User.find(referralFilter)
      .sort({ createdAt: -1 })
      .select('name tier createdAt referredAt isActive registrationPaidAt registrationVerificationStatus')
      .lean();

    const totalReferrals = referredUsers.length;
    const qualifiedReferrals = referredUsers.filter(
      (user) => user.isActive && isRegistrationApproved(user)
    ).length;
    const recentReferrals = referredUsers.slice(0, 8);

    const rewards = buildRewards(qualifiedReferrals, req.user);
    const nextReward = rewards.find((reward) => reward.status === 'active') || null;

    return res.json({
      code: referralCode,
      stats: {
        totalReferrals,
        qualifiedReferrals,
        earnedRewards: rewards.filter((reward) => reward.status === 'unlocked').length,
        nextMilestoneTarget: nextReward ? nextReward.target : null,
        nextMilestoneRemaining: nextReward
          ? Math.max(0, nextReward.target - qualifiedReferrals)
          : 0,
        nextRewardLabel: nextReward ? nextReward.giftItem : 'All rewards unlocked',
        projectedCashoutUsd: estimateReferralCashoutUsd(qualifiedReferrals),
      },
      rewards,
      referrals: recentReferrals.map(mapReferralUser),
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
