const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/User');
const {
  getSignupPricingConfig,
  isSupportedPaymentMethod,
  normalizePaymentMethod,
  resolveTier,
  toUsd,
} = require('../config/pricing');

const SALT_ROUNDS = 10;

function getJwtSecret() {
  return process.env.JWT_SECRET || 'risingstar-dev-secret-change-me';
}

function getJwtExpiry() {
  return process.env.JWT_EXPIRES_IN || '7d';
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeTimeZone(timezone) {
  const value = String(timezone || '').trim();

  if (!value) {
    return 'Africa/Lagos';
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return 'Africa/Lagos';
  }
}

function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    country: user.country || '',
    bio: user.bio || '',
    language: user.language || 'English',
    timezone: user.timezone || 'Africa/Lagos',
    avatarUrl: user.avatarUrl || '',
    notificationSettings: {
      taskAlerts:
        typeof user.notificationSettings?.taskAlerts === 'boolean'
          ? user.notificationSettings.taskAlerts
          : true,
      securityAlerts:
        typeof user.notificationSettings?.securityAlerts === 'boolean'
          ? user.notificationSettings.securityAlerts
          : true,
      payoutAlerts:
        typeof user.notificationSettings?.payoutAlerts === 'boolean'
          ? user.notificationSettings.payoutAlerts
          : true,
      marketing:
        typeof user.notificationSettings?.marketing === 'boolean'
          ? user.notificationSettings.marketing
          : false,
    },
    role: user.role,
    walletBalance: Number(user.walletBalance || 0),
    withdrawableBalance: Number(user.withdrawableBalance || 0),
    depositTotalUsd: Number(user.depositTotalUsd || 0),
    extraTaskSlots: Math.max(0, Number.parseInt(String(user.extraTaskSlots || 0), 10) || 0),
    lastDepositAt: user.lastDepositAt || null,
    tier: user.tier || 'Tier 1',
    streak: Number(user.streak || 0),
    registrationFeeUsd: Number(user.registrationFeeUsd || 0),
    registrationPaymentMethod: user.registrationPaymentMethod || '',
    registrationPaymentReference: user.registrationPaymentReference || '',
    registrationPaymentAmountUsd: Number(user.registrationPaymentAmountUsd || 0),
    registrationPaidAt: user.registrationPaidAt || null,
    tierUpgradedAt: user.tierUpgradedAt || null,
    tierUpgradePaymentMethod: user.tierUpgradePaymentMethod || '',
    tierUpgradePaymentReference: user.tierUpgradePaymentReference || '',
    tierUpgradePaymentAmountUsd: Number(user.tierUpgradePaymentAmountUsd || 0),
    aiBotFeeUsd: Number(user.aiBotFeeUsd || 0),
    aiBotEnabled: Boolean(user.aiBotEnabled),
    aiBotPaymentMethod: user.aiBotPaymentMethod || '',
    aiBotPaymentReference: user.aiBotPaymentReference || '',
    aiBotActivatedAt: user.aiBotActivatedAt || null,
    aiBotExpiresAt: user.aiBotExpiresAt || null,
    aiBotSubscriptionMonths: Number(user.aiBotSubscriptionMonths || 1),
    aiBotLastCheckpointAt: user.aiBotLastCheckpointAt || null,
    aiBotNextCheckpointAt: user.aiBotNextCheckpointAt || null,
    aiBotDailyRunsDate: user.aiBotDailyRunsDate || '',
    aiBotDailyRunsCount: Number(user.aiBotDailyRunsCount || 0),
    createdAt: user.createdAt || null,
    updatedAt: user.updatedAt || null,
  };
}

function createToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      email: user.email,
    },
    getJwtSecret(),
    { expiresIn: getJwtExpiry() }
  );
}

function createAuthResponse(user) {
  return {
    token: createToken(user),
    user: toPublicUser(user),
  };
}

async function ensureAdminUser() {
  const adminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
  const adminPassword = String(process.env.ADMIN_PASSWORD || '').trim();

  if (!adminEmail || !adminPassword) {
    return null;
  }

  let admin = await User.findOne({ email: adminEmail });
  const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);

  if (!admin) {
    admin = await User.create({
      name: 'Platform Admin',
      email: adminEmail,
      phone: '',
      country: '',
      bio: '',
      language: 'English',
      timezone: 'Africa/Lagos',
      avatarUrl: '',
      notificationSettings: {
        taskAlerts: true,
        securityAlerts: true,
        payoutAlerts: true,
        marketing: false,
      },
      passwordHash,
      role: 'admin',
      walletBalance: 0,
      withdrawableBalance: 0,
      depositTotalUsd: 0,
      extraTaskSlots: 0,
      lastDepositAt: null,
      tier: 'Admin',
      streak: 0,
      registrationFeeUsd: 0,
      registrationPaymentMethod: null,
      registrationPaymentReference: '',
      registrationPaymentAmountUsd: 0,
      registrationPaidAt: null,
      tierUpgradedAt: null,
      tierUpgradePaymentMethod: null,
      tierUpgradePaymentReference: '',
      tierUpgradePaymentAmountUsd: 0,
      aiBotFeeUsd: 0,
      aiBotEnabled: false,
      aiBotPaymentMethod: null,
      aiBotPaymentReference: '',
      aiBotActivatedAt: null,
      aiBotExpiresAt: null,
      aiBotSubscriptionMonths: 1,
      aiBotLastCheckpointAt: null,
      aiBotNextCheckpointAt: null,
      aiBotDailyRunsDate: '',
      aiBotDailyRunsCount: 0,
      isActive: true,
    });

    return admin;
  }

  let changed = false;

  if (admin.role !== 'admin') {
    admin.role = 'admin';
    changed = true;
  }

  if (admin.name !== 'Platform Admin') {
    admin.name = 'Platform Admin';
    changed = true;
  }

  const isCurrentPassword = await bcrypt.compare(adminPassword, admin.passwordHash);
  if (!isCurrentPassword) {
    admin.passwordHash = passwordHash;
    changed = true;
  }

  if (changed) {
    await admin.save();
  }

  return admin;
}

async function registerUser({
  name,
  email,
  password,
  tier,
  paymentMethod,
  paymentReference,
  paymentAmountUsd,
  timezone,
}) {
  const cleanName = String(name || '').trim();
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '').trim();
  const tierConfig = resolveTier(tier);
  const paymentMethodRaw = paymentMethod;
  const cleanPaymentReference = String(paymentReference || '').trim();
  const cleanTimeZone = normalizeTimeZone(timezone);
  const paymentAmount = Number(paymentAmountUsd);
  const signupPricing = getSignupPricingConfig();

  if (!cleanName || cleanName.length < 2) {
    throw new Error('Name should be at least 2 characters');
  }

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Valid email is required');
  }

  if (cleanPassword.length < 4) {
    throw new Error('Password should be at least 4 characters');
  }

  if (!tierConfig) {
    throw new Error('Valid registration tier is required');
  }

  if (!isSupportedPaymentMethod(paymentMethodRaw)) {
    throw new Error('Valid payment method is required');
  }

  if (!cleanPaymentReference || cleanPaymentReference.length < 3) {
    throw new Error('Payment reference should be at least 3 characters');
  }

  if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
    throw new Error('Payment amount is required');
  }

  const expectedAmount = toUsd(tierConfig.feeUsd);
  const providedAmount = toUsd(paymentAmount);

  if (Math.abs(expectedAmount - providedAmount) > 0.01) {
    throw new Error(`Payment amount must match ${expectedAmount.toFixed(2)} USD for ${tierConfig.label}`);
  }

  const existing = await User.findOne({ email: cleanEmail });
  if (existing) {
    throw new Error('Email already registered');
  }

  const passwordHash = await bcrypt.hash(cleanPassword, SALT_ROUNDS);

  const user = await User.create({
    name: cleanName,
    email: cleanEmail,
    phone: '',
    country: '',
    bio: '',
    language: 'English',
    timezone: cleanTimeZone,
    avatarUrl: '',
    notificationSettings: {
      taskAlerts: true,
      securityAlerts: true,
      payoutAlerts: true,
      marketing: false,
    },
    passwordHash,
    role: 'user',
    walletBalance: 0,
    withdrawableBalance: 0,
    depositTotalUsd: 0,
    extraTaskSlots: 0,
    lastDepositAt: null,
    tier: tierConfig.label,
    streak: 0,
    registrationFeeUsd: expectedAmount,
    registrationPaymentMethod: normalizePaymentMethod(paymentMethodRaw),
    registrationPaymentReference: cleanPaymentReference,
    registrationPaymentAmountUsd: providedAmount,
    registrationPaidAt: new Date(),
    tierUpgradedAt: null,
    tierUpgradePaymentMethod: null,
    tierUpgradePaymentReference: '',
    tierUpgradePaymentAmountUsd: 0,
    aiBotFeeUsd: signupPricing.aiBotFeeUsd,
    aiBotEnabled: false,
    aiBotPaymentMethod: null,
    aiBotPaymentReference: '',
    aiBotActivatedAt: null,
    aiBotExpiresAt: null,
    aiBotSubscriptionMonths: 1,
    aiBotLastCheckpointAt: null,
    aiBotNextCheckpointAt: null,
    aiBotDailyRunsDate: '',
    aiBotDailyRunsCount: 0,
    isActive: true,
  });

  return user;
}

async function loginUser({ email, password }) {
  const cleanEmail = normalizeEmail(email);
  const cleanPassword = String(password || '').trim();

  if (!cleanEmail || !cleanPassword) {
    throw new Error('Email and password are required');
  }

  const user = await User.findOne({ email: cleanEmail });
  if (!user || !user.isActive) {
    throw new Error('Invalid email or password');
  }

  const validPassword = await bcrypt.compare(cleanPassword, user.passwordHash);
  if (!validPassword) {
    throw new Error('Invalid email or password');
  }

  return user;
}

module.exports = {
  createAuthResponse,
  ensureAdminUser,
  getSignupPricingConfig,
  loginUser,
  registerUser,
  toPublicUser,
};
